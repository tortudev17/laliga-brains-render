import { firebaseDb } from "./firebase-rest";
import { applyWalletDelta, calculateFantasyAssetValue, calculateNetWorth, emptyEconomy, type EconomyState } from "./economy-core";
export { applyWalletDelta, emptyEconomy } from "./economy-core";
export type { EconomyState } from "./economy-core";

export const REGISTRATION_BONUS = 120;

export async function mutateEconomy<T>(operation: (state: EconomyState) => T): Promise<T> {
  const ref = firebaseDb.ref("laligaBrains/economy/state");
  let output: T | undefined;
  const result = await ref.transaction((raw) => {
    const state = { ...emptyEconomy(), ...(raw ?? {}) } as EconomyState;
    output = operation(state);
    return state;
  }, undefined, false);
  if (!result.committed || output === undefined) throw new Error("La operación económica no se pudo confirmar.");
  // Materialized read views are repaired by the scheduled reconciler if this mirror fails.
  await mirrorEconomy(result.snapshot.val() as EconomyState).catch((error: unknown) => console.error("No se pudo actualizar una vista económica; se reconciliará:", error));
  return output;
}

async function mirrorEconomy(state: EconomyState) {
  const updates: Record<string, unknown> = {};
  const accountUids = new Set(Object.keys(state.wallets));
  for (const player of Object.values(state.fantasyPlayers ?? {})) if (typeof player.ownerUid === "string") accountUids.add(player.ownerUid);
  for (const uid of accountUids) {
    const balance = Number(state.wallets[uid] ?? 0);
    const assetValue = calculateFantasyAssetValue(state, uid);
    updates[`laligaBrains/economy/wallets/${uid}`] = { balance, updatedAt: Date.now() };
    updates[`laligaBrains/leaderboards/richest/${uid}`] = { balance, assetValue, netWorth: calculateNetWorth(balance, assetValue) };
  }
  for (const [id, transaction] of Object.entries(state.ledger)) for (const [ledgerId, item] of Object.entries(transaction)) {
    updates[`laligaBrains/economy/ledger/${id}/${ledgerId}`] = item;
    updates[`laligaBrains/economy/ledgerIndex/${ledgerId}`] = item;
  }
  for (const [id, player] of Object.entries(state.fantasyPlayers)) updates[`laligaBrains/fantasy/players/${id}`] = player;
  for (const [id, history] of Object.entries(state.valuationHistory ?? {})) updates[`laligaBrains/fantasy/valuationHistory/${id}`] = history;
  for (const [id, promotion] of Object.entries(state.promotions ?? {})) updates[`laligaBrains/social/promotions/${id}`] = promotion;
  for (const [id, offer] of Object.entries(state.offers ?? {})) updates[`laligaBrains/fantasy/offers/${id}`] = offer;
  for (const [playerId, historyValue] of Object.entries(state.ownershipHistory ?? {})) {
    const history = historyValue as Record<string, Record<string, unknown>>;
    for (const [transferId, transfer] of Object.entries(history ?? {})) updates[`laligaBrains/fantasy/transfers/${transferId}`] = { ...transfer, id: transferId, playerId };
  }
  for (const [uid, correct] of Object.entries(state.predictionCorrect ?? {})) updates[`laligaBrains/leaderboards/predictors/${uid}`] = { correct };
  if (Object.keys(updates).length) await firebaseDb.ref().update(updates);
}

export async function createWalletCredit(uid: string, amount: number, type: string, idempotencyKey: string) {
  return mutateEconomy((state) => applyWalletDelta(state, uid, amount, type, null, idempotencyKey));
}
