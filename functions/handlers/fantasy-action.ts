import { randomUUID } from "node:crypto";
import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { applyWalletDelta, mutateEconomy, type EconomyState } from "../lib/economy";
import { asBadRequest, asForbidden, json, run, bodyOf, methodNotAllowed } from "../lib/http";

function idempotency(body: Record<string, unknown>) {
  const key = String(body.idempotencyKey ?? "");
  if (!/^[a-f0-9-]{36}$/i.test(key)) throw asBadRequest("Falta la clave segura de la operación. Inténtalo de nuevo.");
  return key;
}

function playerView(state: EconomyState) {
  return Object.entries(state.fantasyPlayers).map(([id, player]) => ({ id, name: String(player.name ?? "Jugador"), value: Number(player.value ?? 50), permanentInvestment: Number(player.permanentInvestment ?? 0), ownerUid: player.ownerUid as string | undefined, ghost: Boolean(player.ghost) }));
}

export const handler: Handler = async (event) => run(async () => {
  const { uid } = await requireUser(event);
  if (event.httpMethod === "GET") {
    const [players, state] = await Promise.all([
      firebaseDb.ref("laligaBrains/fantasy/players").get(),
      firebaseDb.ref("laligaBrains/economy/state").get(),
    ]);
    const vals = state.val() as EconomyState | null;
    const market = players.val() as Record<string, Record<string, unknown>> | null;
    const roster = vals?.fantasyPlayers ? playerView(vals).filter((player) => player.ownerUid === uid) : [];
    const offers = Object.values(vals?.offers ?? {})
      .filter((offer) => offer.buyerUid === uid || offer.sellerUid === uid)
      .sort((a, b) => Number(b.updatedAt ?? b.createdAt) - Number(a.updatedAt ?? a.createdAt))
      .slice(0, 50);
    const marketPlayers = market
      ? Object.entries(market).filter(([, player]) => player.archived !== true).map(([id, player]) => ({
        id,
        name: String(player.name ?? "Jugador"),
        value: Number(player.value ?? 50),
        ownerUid: player.ownerUid as string | undefined,
        ghost: Boolean(player.ghost),
      }))
      : [];
    const relatedUids = new Set<string>();
    for (const player of marketPlayers) if (player.ownerUid) relatedUids.add(player.ownerUid);
    for (const offer of offers) {
      if (typeof offer.buyerUid === "string") relatedUids.add(offer.buyerUid);
      if (typeof offer.sellerUid === "string") relatedUids.add(offer.sellerUid);
    }
    const profileEntries = await Promise.all([...relatedUids].map(async (profileUid) => {
      const value = (await firebaseDb.ref(`laligaBrains/identity/users/${profileUid}`).get()).val() as { displayName?: string; username?: string } | null;
      return [profileUid, value] as const;
    }));
    const profiles = new Map(profileEntries);
    const userLabel = (profileUid: string | undefined) => {
      const owner = profileUid ? profiles.get(profileUid) : null;
      return { name: String(owner?.displayName ?? owner?.username ?? "Mánager"), username: String(owner?.username ?? "") };
    };
    const playersWithOwner = marketPlayers.map((player) => ({
      ...player,
      ...(player.ownerUid ? {
        ownerName: userLabel(player.ownerUid).name,
        ownerUsername: userLabel(player.ownerUid).username,
        ownerFantasyCount: marketPlayers.filter((item) => item.ownerUid === player.ownerUid).length,
      } : {}),
    }));
    const offersWithNames = offers.map((offer) => ({
      ...offer,
      buyerName: userLabel(String(offer.buyerUid ?? "")).name,
      buyerUsername: userLabel(String(offer.buyerUid ?? "")).username,
      sellerName: userLabel(String(offer.sellerUid ?? "")).name,
      sellerUsername: userLabel(String(offer.sellerUid ?? "")).username,
      creatorName: userLabel(String(offer.creatorUid ?? "")).name,
      creatorUsername: userLabel(String(offer.creatorUid ?? "")).username,
      recipientName: userLabel(String(offer.recipientUid ?? "")).name,
      recipientUsername: userLabel(String(offer.recipientUid ?? "")).username,
    }));
    return json(200, { players: playersWithOwner, roster, offers: offersWithNames });
  }
  if (event.httpMethod !== "POST") return methodNotAllowed(["GET", "POST"]);
  const body = bodyOf(event);
  const action = String(body.action ?? "");
  const playerId = String(body.playerId ?? "");
  const key = idempotency(body);
  const now = Date.now();
  const result = await mutateEconomy((state) => {
    const prior = state.idempotency[key];
    if (prior) return prior.result;
    const player = state.fantasyPlayers[playerId];
    if (player?.archived === true) throw Object.assign(new Error("Este jugador ya no está disponible en el mercado."), { statusCode: 409 });
    const rosterCount = () => Object.values(state.fantasyPlayers).filter((item) => item.ownerUid === uid).length;
    const ensureSlot = () => { if (rosterCount() >= 5) throw Object.assign(new Error("Tu plantilla ya tiene cinco jugadores."), { statusCode: 409 }); };
    if (action === "buy") {
      if (!player || player.ownerUid) throw Object.assign(new Error("Este jugador ya no está disponible."), { statusCode: 409 });
      ensureSlot();
      const value = Number(player.value ?? 50);
      applyWalletDelta(state, uid, -value, "fantasy_purchase", uid, key, playerId);
      player.ownerUid = uid;
      player.updatedAt = now;
      state.ownershipHistory[playerId] = { ...(state.ownershipHistory[playerId] as object ?? {}), [randomUUID()]: { ownerUid: uid, action: "purchase", amount: value, createdAt: now } };
      return { playerId, ownerUid: uid, price: value };
    }
    if (action === "sell") {
      if (!player || player.ownerUid !== uid) throw asForbidden("No eres propietario de este jugador.");
      const value = Number(player.value ?? 50);
      applyWalletDelta(state, uid, value, "fantasy_sale", uid, key, playerId);
      player.ownerUid = null;
      player.updatedAt = now;
      state.ownershipHistory[playerId] = { ...(state.ownershipHistory[playerId] as object ?? {}), [randomUUID()]: { ownerUid: uid, action: "sale", amount: value, createdAt: now } };
      return { playerId, ownerUid: null, price: value };
    }
    if (action === "buyout") {
      const buyerUid = uid;
      const sellerUid = String(player?.ownerUid ?? "");
      if (!player || !sellerUid || sellerUid === buyerUid) throw Object.assign(new Error("El jugador no está disponible para un fichaje."), { statusCode: 409 });
      ensureSlot();
      const price = Math.round(Number(player.value ?? 50)) * 2;
      applyWalletDelta(state, buyerUid, -price, "fantasy_buyout", buyerUid, key, playerId);
      applyWalletDelta(state, sellerUid, price, "fantasy_buyout_received", buyerUid, `${key}:seller`, playerId);
      player.ownerUid = buyerUid;
      player.updatedAt = now;
      state.ownershipHistory[playerId] = { ...(state.ownershipHistory[playerId] as object ?? {}), [randomUUID()]: { previousOwnerUid: sellerUid, ownerUid: buyerUid, action: "buyout", amount: price, createdAt: now } };
      return { playerId, ownerUid: buyerUid, price };
    }
    if (action === "invest") {
      if (!player || player.ownerUid !== uid) throw asForbidden("Solo puedes invertir en jugadores de tu plantilla.");
      const amount = Number(body.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw asBadRequest("La inversión debe ser un número entero positivo.");
      applyWalletDelta(state, uid, -amount, "fantasy_investment", uid, key, playerId);
      player.permanentInvestment = Number(player.permanentInvestment ?? 0) + amount;
      player.value = Number(player.value ?? 50) + amount;
      player.updatedAt = now;
      return { playerId, value: player.value, investment: player.permanentInvestment };
    }
    if (action === "offer") {
      if (!player || player.ownerUid === uid) throw asBadRequest("El jugador no pertenece a otro mánager.");
      ensureSlot();
      const amount = Number(body.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw asBadRequest("La oferta debe ser un número entero positivo.");
      const offerId = randomUUID();
      state.offers[offerId] = { id: offerId, playerId, buyerUid: uid, sellerUid: String(player.ownerUid), creatorUid: uid, recipientUid: String(player.ownerUid), amount, status: "pending", createdAt: now, updatedAt: now };
      const offer = { offerId, amount };
      state.idempotency[key] = { result: offer };
      return offer;
    }
    if (action === "counterOffer") {
      const offerId = String(body.offerId ?? "");
      const previous = state.offers[offerId];
      if (!previous || previous.status !== "pending" || previous.recipientUid !== uid) throw asForbidden("Esta oferta ya no está disponible para negociar.");
      const amount = Number(body.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw asBadRequest("La contraoferta debe ser un número entero positivo.");
      const counterId = randomUUID();
      const counter = { id: counterId, playerId: previous.playerId, buyerUid: previous.buyerUid, sellerUid: previous.sellerUid, creatorUid: uid, recipientUid: previous.creatorUid, amount, status: "pending", parentOfferId: offerId, createdAt: now, updatedAt: now };
      previous.status = "countered"; previous.updatedAt = now;
      state.offers[counterId] = counter;
      const response = { offerId: counterId, amount, status: "pending" };
      state.idempotency[key] = { result: response };
      return response;
    }
    if (action === "cancelOffer") {
      const offerId = String(body.offerId ?? "");
      const offer = state.offers[offerId];
      if (!offer || offer.status !== "pending" || offer.creatorUid !== uid) throw asForbidden("No puedes cancelar esta oferta.");
      offer.status = "cancelled"; offer.updatedAt = now;
      const response = { offerId, status: "cancelled" };
      state.idempotency[key] = { result: response };
      return response;
    }
    if (action === "respondOffer") {
      const offerId = String(body.offerId ?? "");
      const offer = state.offers[offerId];
      if (!offer || offer.status !== "pending" || offer.recipientUid !== uid) throw asForbidden("La oferta ya no está disponible.");
      if (body.accept !== true) { offer.status = "rejected"; offer.updatedAt = now; return { offerId, status: "rejected" }; }
      const offeredPlayer = state.fantasyPlayers[String(offer.playerId)];
      if (!offeredPlayer || offeredPlayer.ownerUid !== uid) throw Object.assign(new Error("Ya no eres propietario de este jugador."), { statusCode: 409 });
      const buyerUid = String(offer.buyerUid);
      if (Object.values(state.fantasyPlayers).filter((item) => item.ownerUid === buyerUid).length >= 5) throw Object.assign(new Error("El comprador ya tiene cinco jugadores."), { statusCode: 409 });
      const amount = Number(offer.amount);
      applyWalletDelta(state, buyerUid, -amount, "fantasy_transfer", uid, `${key}:buyer`, String(offer.playerId));
      applyWalletDelta(state, uid, amount, "fantasy_transfer_received", uid, `${key}:seller`, String(offer.playerId));
      offeredPlayer.ownerUid = buyerUid;
      offeredPlayer.updatedAt = now;
      offer.status = "accepted"; offer.respondedAt = now;
      state.ownershipHistory[String(offer.playerId)] = { ...(state.ownershipHistory[String(offer.playerId)] as object ?? {}), [randomUUID()]: { previousOwnerUid: uid, ownerUid: buyerUid, action: "negotiated_transfer", amount, createdAt: now } };
      return { offerId, status: "accepted", playerId: offer.playerId, ownerUid: buyerUid };
    }
    throw asBadRequest("La operación de Fantasy no está disponible.");
  });
  return json(200, { result });
});
