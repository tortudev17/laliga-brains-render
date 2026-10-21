import { randomUUID } from "node:crypto";
import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { applyWalletDelta, mutateEconomy } from "../lib/economy";
import { asBadRequest, asForbidden, json, run, bodyOf, methodNotAllowed } from "../lib/http";

const packages = { pequena: { cost: 10, targetViews: 5 }, mediana: { cost: 25, targetViews: 15 }, grande: { cost: 50, targetViews: 30 } } as const;

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const { uid } = await requireUser(event);
  const body = bodyOf(event);
  if (body.action === "buy") {
    const postId = String(body.postId ?? "");
    const packageName = String(body.packageName ?? "") as keyof typeof packages;
    const key = String(body.idempotencyKey ?? "");
    if (!packages[packageName] || !/^[a-f0-9-]{36}$/i.test(key)) throw asBadRequest("El paquete promocional no es válido.");
    const post = (await firebaseDb.ref(`laligaBrains/social/posts/${postId}`).get()).val() as { authorUid?: string; status?: string } | null;
    if (!post || post.authorUid !== uid || post.status !== "published") throw asForbidden("Solo puedes promocionar tus propias publicaciones activas.");
    const promotionId = randomUUID();
    const pack = packages[packageName];
    const promotion = await mutateEconomy((state) => {
      if (state.idempotency[key]) return state.idempotency[key].result as { id: string; postId: string; status: string };
      applyWalletDelta(state, uid, -pack.cost, "post_promotion", uid, `promotion:${key}`, postId);
      const created = { id: promotionId, postId, authorUid: uid, packageName, cost: pack.cost, targetViews: pack.targetViews, creditedViews: 0, viewsByUid: {}, status: "active", createdAt: Date.now() };
      state.promotions[promotionId] = created;
      const result = { id: promotionId, postId, status: "active" };
      state.idempotency[key] = { result };
      return result;
    });
    await firebaseDb.ref(`laligaBrains/social/posts/${postId}/promoted`).set(true);
    return json(201, { promotion });
  }
  if (body.action === "view") {
    const promotionId = String(body.promotionId ?? "");
    const token = String(body.placementToken ?? "");
    if (!/^[a-f0-9-]{36}$/i.test(token) || !promotionId) throw asBadRequest("No se pudo validar la visualización.");
    const placementRef = firebaseDb.ref(`laligaBrains/social/promotionPlacementTokens/${uid}/${promotionId}`);
    const placement = (await placementRef.get()).val() as { token?: string; postId?: string; expiresAt?: number } | null;
    if (!placement || placement.token !== token || Number(placement.expiresAt ?? 0) < Date.now()) throw asForbidden("La visualización ya no está autorizada.");
    const tokenPost = placement.postId;
    const result = await mutateEconomy((state) => {
      const promotion = state.promotions[promotionId] as { id:string;postId:string;authorUid:string;status:string;targetViews:number;creditedViews:number;viewsByUid?:Record<string,number> } | undefined;
      if (!promotion || promotion.status !== "active" || promotion.authorUid === uid || promotion.postId !== tokenPost) return { credited:false, creditedViews:Number(promotion?.creditedViews??0) };
      promotion.viewsByUid ??= {};
      if (!promotion.viewsByUid[uid]) promotion.viewsByUid[uid] = Date.now();
      promotion.creditedViews = Object.keys(promotion.viewsByUid).length;
      if (promotion.creditedViews >= promotion.targetViews) promotion.status = "complete";
      state.promotions[promotionId] = promotion;
      return { credited:Boolean(promotion.viewsByUid[uid]),creditedViews:promotion.creditedViews };
    });
    await placementRef.transaction((current) => current?.token === token && Number(current.expiresAt ?? 0) >= Date.now() ? null : undefined);
    if (result.credited) await firebaseDb.ref(`laligaBrains/social/promotionViews/${promotionId}/${uid}`).set(Date.now()).catch(()=>undefined);
    return json(200, result);
  }
  throw asBadRequest("La acción promocional no está disponible.");
});
