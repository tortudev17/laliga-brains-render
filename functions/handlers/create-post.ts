import { randomUUID } from "node:crypto";
import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { applyWalletDelta, mutateEconomy } from "../lib/economy";
import { madridDateKey } from "../lib/time";
import { asBadRequest, json, run, bodyOf, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  const { uid, profile } = await requireUser(event);
  if (event.httpMethod === "GET") {
    const day = madridDateKey();
    const current = (await firebaseDb.ref(`laligaBrains/economy/state/dailyPosts/${uid}`).get()).val() as { dateKey?: string; count?: number } | null;
    const count = current?.dateKey === day ? Number(current.count ?? 0) : 0;
    return json(200, { dailyFreePostsRemaining: Math.max(0, 3 - count), postsToday: count, dateKey: day });
  }
  if (event.httpMethod !== "POST") return methodNotAllowed(["GET", "POST"]);
  const restrictions = (profile.restrictions ?? {}) as { postingSuspendedUntil?: number };
  if (Number(restrictions.postingSuspendedUntil ?? 0) > Date.now()) throw Object.assign(new Error("Tu permiso para publicar está suspendido temporalmente."), { statusCode: 403 });
  const body = bodyOf(event);
  const text = String(body.text ?? "").trim();
  if (!text || text.length > 1000) throw asBadRequest("La publicación debe tener entre 1 y 1.000 caracteres.");
  const images = Array.isArray(body.images) ? body.images.map(String) : [];
  if (images.length > 4 || images.some((path) => !new RegExp(`^social-post-images/${uid}/[a-zA-Z0-9._-]{1,180}$`).test(path))) throw asBadRequest("Las imágenes no son válidas.");
  if (body.link || body.poll || body.sharedPostId) throw asBadRequest("Solo puedes publicar contenido propio: no se permiten enlaces compartidos, encuestas ni republicaciones.");
  const postId = randomUUID();
  const actionKey = String(body.idempotencyKey ?? "");
  if (!/^[a-f0-9-]{36}$/i.test(actionKey)) throw asBadRequest("No se pudo validar la publicación. Vuelve a intentarlo.");
  const day = madridDateKey();
  const billing = await mutateEconomy((state) => {
    if (state.idempotency[actionKey]) return state.idempotency[actionKey].result as { postId: string; dailyCount: number };
    const previous = state.dailyPosts[uid];
    const count = previous?.dateKey === day ? previous.count : 0;
    const nextCount = count + 1;
    if (nextCount > 3) applyWalletDelta(state, uid, -5, "extra_social_post", uid, `post:${actionKey}`, postId);
    state.dailyPosts[uid] = { dateKey: day, count: nextCount };
    const result = { postId, dailyCount: nextCount };
    state.idempotency[actionKey] = { result };
    state.operations[actionKey] = { id: actionKey, kind: "create_post", postId, uid, status: "pending", createdAt: Date.now() };
    return result;
  });
  try {
    const post = { id: billing.postId, authorUid: uid, authorName: String(profile.displayName ?? profile.username), text, images, createdAt: Date.now(), likeCount: 0, recommendationPriority: String(profile.recommendationPriority ?? "normal"), status: "published" };
    await firebaseDb.ref(`laligaBrains/social/posts/${billing.postId}`).set(post);
    await mutateEconomy((state) => { if (state.operations[actionKey]) state.operations[actionKey] = { ...state.operations[actionKey], status: "complete", completedAt: Date.now() }; return true; });
  } catch (error) {
    await mutateEconomy((state) => {
      const operation = state.operations[actionKey];
      if (operation?.status === "pending") {
        const idempotencyKey = `post-rollback:${actionKey}`;
        if ((state.dailyPosts[uid]?.count ?? 0) > 0) state.dailyPosts[uid].count -= 1;
        if (state.idempotency[`post:${actionKey}`]) applyWalletDelta(state, uid, 5, "social_post_refund", null, idempotencyKey, billing.postId);
        operation.status = "rolled_back";
      }
      return true;
    });
    throw error;
  }
  return json(201, { postId: billing.postId, dailyFreePostsRemaining: Math.max(0, 3 - billing.dailyCount) });
});
