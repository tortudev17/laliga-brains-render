import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { applyWalletDelta, mutateEconomy, type EconomyState } from "../lib/economy";
import { estimateProbability, expireOldRounds, retirePredictionEconomy } from "../lib/predictions";
import { isWeekday, madridDateKey, madridHour } from "../lib/time";
import { json, run } from "../lib/http";
import { reconcilePendingManualGoalAdjustments, reconcilePendingMatchActions } from "./piero-admin";

export const handler: Handler = async () => run(async () => {
  const now = new Date();
  const dateKey = madridDateKey(now);
  const hour = madridHour(now);
  let generated = false;
  if (isWeekday(now) && hour >= 8) generated = await generateRound(dateKey);
  await retirePredictionEconomy();
  const expiredRounds = await expireOldRounds(dateKey);
  const reconciled = await reconcilePendingOperations();
  const matchesReconciled = await reconcilePendingMatchActions();
  const manualGoalsReconciled = await reconcilePendingManualGoalAdjustments();
  await reconcileMatchRewards();
  return json(200, { ok: true, dateKey, generated, expiredRounds: expiredRounds.length, predictionsCancelled: expiredRounds.reduce((sum, item) => sum + item.cancelled, 0), reconciled, matchesReconciled, manualGoalsReconciled });
});

async function generateRound(dateKey: string) {
  const [calendar, teamStatsSnapshot, playersSnapshot, profilesSnapshot] = await Promise.all([
    firebaseDb.ref(`laligaBrains/config/schoolCalendar/closedDates/${dateKey}`).get(),
    firebaseDb.ref("laligaBrains/football/teamStats").get(),
    firebaseDb.ref("laligaBrains/football/playerStats").get(),
    firebaseDb.ref("laligaBrains/identity/playerProfiles").get(),
  ]);
  if (calendar.val() === true) return false;
  const teamStats = (teamStatsSnapshot.val() ?? {}) as Record<string, { played?: number; wins?: number; draws?: number; losses?: number }>;
  const played = Number(teamStats["3ESO"]?.played ?? 0);
  const winnerCounts = { "3 ESO": Number(teamStats["3ESO"]?.wins ?? 0), Empate: Number(teamStats["3ESO"]?.draws ?? 0), "4 ESO": Number(teamStats["3ESO"]?.losses ?? 0) };
  const winnerQuestion = {
    id: "winner", kind: "winner", question: "¿Quién ganará el próximo partido?",
    outcomes: Object.fromEntries(Object.entries(winnerCounts).map(([name, count]) => { const probability = estimateProbability(count, played, 1 / 3, 3); return [name, { probability }]; })),
  };
  const playerStats = (playersSnapshot.val() ?? {}) as Record<string, { totalGoals?: number; goalsByMatch?: Record<string, number> }>;
  const playerProfiles = (profilesSnapshot.val() ?? {}) as Record<string, { name?: string; uid?: string; ghost?: boolean }>;
  const questions: Record<string, Record<string, unknown>> = { winner: winnerQuestion };
  for (const [playerId, stats] of Object.entries(playerStats)) {
    const profile = playerProfiles[playerId];
    if (!profile) continue;
    const goalsByMatch = Object.values(stats.goalsByMatch ?? {}).map(Number);
    const appearances = Math.max(played, 0);
    const goals = Number(stats.totalGoals ?? 0);
    const recent = Number((stats as { recentGoals?: number }).recentGoals ?? goalsByMatch.slice(-5).reduce((sum, n) => sum + n, 0));
    const lambda = Math.max(0.12, (goals + 0.7 + recent * 0.35) / (appearances + 3.5));
    for (const threshold of [1, 2, 3]) {
      const cdf = threshold === 1 ? Math.exp(-lambda) : threshold === 2 ? Math.exp(-lambda) * (1 + lambda) : Math.exp(-lambda) * (1 + lambda + lambda * lambda / 2);
      const yesProbability = Math.min(0.9, Math.max(0.07, 1 - cdf));
      const noProbability = 1 - yesProbability;
      const id = `${playerId}_atleast_${threshold}`;
      questions[id] = { id, kind: "player_goals", playerId, threshold, question: `¿${profile.name ?? "Este jugador"} marcará ${threshold === 1 ? "al menos un gol" : `${threshold} o más goles`}?`, outcomes: { "Sí": { probability: yesProbability }, "No": { probability: noProbability } } };
    }
  }
  const round = { dateKey, status: "open", createdAt: Date.now(), closesAt: madridLocalEpoch(dateKey, 15), questions };
  const result = await mutateEconomy((state: EconomyState) => {
    if (state.predictionRounds[dateKey]) return false;
    state.predictionRounds[dateKey] = round;
    return true;
  });
  if (result) {
    await firebaseDb.ref(`laligaBrains/predictions/rounds/${dateKey}`).set(round);
    await firebaseDb.ref(`laligaBrains/predictions/questions/${dateKey}`).set(questions);
  }
  return result;
}

function madridLocalEpoch(dateKey: string, hour: number) {
  let timestamp = Date.parse(`${dateKey}T${String(hour).padStart(2, "0")}:00:00Z`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(timestamp);
    const local = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    timestamp += (hour - local) * 60 * 60 * 1000;
  }
  return timestamp;
}

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
          if (current.idempotency[`post:${id}`]) applyWalletDelta(current, uid, 5, "social_post_refund", null, `post-reconcile-refund:${id}`, String(live.postId));
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
