import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { applyWalletDelta, mutateEconomy, type EconomyState } from "../lib/economy";
import { ensureTodaysPredictionRound, expireOldRounds } from "../lib/predictions";
import { isWeekday, madridDateKey, madridHour } from "../lib/time";
import { json, run } from "../lib/http";
import { reconcilePendingManualGoalAdjustments, reconcilePendingMatchActions } from "./piero-admin";

export const handler: Handler = async () => run(async () => {
  const now = new Date();
  const predictionRoundsExpired = await expireOldRounds(madridDateKey(now));
  const predictionGeneration = isWeekday(now) && madridHour(now) === 8
    ? await ensureTodaysPredictionRound(now)
    : { created: false, reason: "outside_generation_hour" as const };
  const reconciled = await reconcilePendingOperations();
  const matchesReconciled = await reconcilePendingMatchActions();
  const manualGoalsReconciled = await reconcilePendingManualGoalAdjustments();
  await reconcileMatchRewards();
  return json(200, { ok: true, reconciled, matchesReconciled, manualGoalsReconciled, predictionGeneration, predictionRoundsExpired });
});

async function reconcilePendingOperations() {
  const snapshot = await firebaseDb.ref("laligaBrains/economy/state").get();
  const state = snapshot.val() as EconomyState | null;
  const pending = Object.entries(state?.operations ?? {}).filter(([, item]) => item.status === "pending");
  for (const [id, operation] of pending) {
    if (operation.kind === "create_post") {
      const post = await firebaseDb.ref(`laligaBrains/social/posts/${String(operation.postId)}`).get();
      await mutateEconomy((current) => {
        const live = current.operations[id];
        if (!live || live.status !== "pending") return false;
        if (post.exists()) live.status = "complete";
        else {
          const uid = String(live.uid);
          if (current.dailyPosts[uid]?.count) current.dailyPosts[uid].count -= 1;
          if (current.idempotency[`post:${id}`]) applyWalletDelta(current, uid, 5, "social_post_refund", null, `post-reconcile-refund:${id}`, String(live.postId), false, false, true);
          live.status = "rolled_back";
        }
        live.reconciledAt = Date.now();
        return true;
      });
    }
  }
  return pending.length;
}

async function reconcileMatchRewards() {
  const snapshot = await firebaseDb.ref("laligaBrains/football/pendingRewards").get();
  const rewards = snapshot.val() as Record<string, { uid: string; amount: number; idempotencyKey: string; matchId: string }> | null;
  if (!rewards) return;
  for (const [id, reward] of Object.entries(rewards)) {
    const { createWalletCredit } = await import("../lib/economy");
    await createWalletCredit(reward.uid, reward.amount, "fantasy_goal", reward.idempotencyKey);
    await firebaseDb.ref(`laligaBrains/football/pendingRewards/${id}`).remove();
  }
}
