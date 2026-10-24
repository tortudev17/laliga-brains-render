import type { EconomyState } from "./economy-core";

export interface PlayerIdentityMergeResult {
  sourcePlayerId: string;
  targetPlayerId: string;
  mergedInvestment: number;
  ownerUid: string | null;
  cancelledOffers: number;
}

/** Fold a registration-created player asset into the selected ghost asset. */
export function mergePlayerEconomyIdentity(
  state: EconomyState,
  sourcePlayerId: string,
  targetPlayerId: string,
  accountUid: string,
  now = Date.now(),
): PlayerIdentityMergeResult {
  const operationKey = `player-identity-merge:${sourcePlayerId}:${targetPlayerId}:${accountUid}`;
  const previous = state.idempotency[operationKey]?.result as PlayerIdentityMergeResult | undefined;
  if (previous) return previous;

  const source = state.fantasyPlayers[sourcePlayerId];
  const target = state.fantasyPlayers[targetPlayerId];
  if (!target) throw Object.assign(new Error("No se encontró el jugador fantasma en el mercado Fantasy."), { statusCode: 409 });
  if (sourcePlayerId === targetPlayerId) {
    target.uid = accountUid;
    target.ghost = false;
    target.updatedAt = now;
    const result = { sourcePlayerId, targetPlayerId, mergedInvestment: Number(target.permanentInvestment ?? 0), ownerUid: String(target.ownerUid ?? "") || null, cancelledOffers: 0 };
    state.idempotency[operationKey] = { result };
    return result;
  }

  const sourceOwner = String(source?.ownerUid ?? "") || null;
  const targetOwner = String(target.ownerUid ?? "") || null;
  if (sourceOwner && targetOwner && sourceOwner !== targetOwner) {
    throw Object.assign(new Error("Los dos perfiles tienen mánagers Fantasy distintos. Libera uno de los activos antes de unirlos."), { statusCode: 409 });
  }
  if (source?.uid && source.uid !== accountUid) {
    throw Object.assign(new Error("El activo Fantasy de origen pertenece a otra cuenta."), { statusCode: 409 });
  }

  const sourceInvestment = Number(source?.permanentInvestment ?? 0);
  const targetInvestment = Number(target.permanentInvestment ?? 0);
  const sourceValue = Number(source?.value ?? 50);
  const targetValue = Number(target.value ?? 50);
  const sourcePerformance = Number(source?.performanceValue ?? Math.max(50, sourceValue - sourceInvestment));
  const targetPerformance = Number(target.performanceValue ?? Math.max(50, targetValue - targetInvestment));
  if (![sourceInvestment, targetInvestment, sourceValue, targetValue, sourcePerformance, targetPerformance].every(Number.isSafeInteger)
    || sourceInvestment < 0 || targetInvestment < 0 || sourceValue < 0 || targetValue < 0) {
    throw Object.assign(new Error("El valor Fantasy de uno de los perfiles no es válido; no se ha combinado."), { statusCode: 409 });
  }

  const ownerUid = targetOwner ?? sourceOwner;
  const mergedInvestment = sourceInvestment + targetInvestment;
  const performanceValue = Math.max(50, sourcePerformance, targetPerformance);
  target.uid = accountUid;
  target.ghost = false;
  target.ownerUid = ownerUid;
  target.permanentInvestment = mergedInvestment;
  target.performanceValue = performanceValue;
  target.value = performanceValue + mergedInvestment;
  target.updatedAt = now;

  if (source) {
    const oldHistory = state.ownershipHistory[sourcePlayerId] as Record<string, unknown> | undefined;
    if (oldHistory) {
      state.ownershipHistory[targetPlayerId] = {
        ...(state.ownershipHistory[targetPlayerId] as Record<string, unknown> | undefined ?? {}),
        ...Object.fromEntries(Object.entries(oldHistory).map(([key, value]) => [`merged:${sourcePlayerId}:${key}`, value])),
      };
    }
    const sourceValuations = state.valuationHistory[sourcePlayerId];
    if (sourceValuations) {
      state.valuationHistory[targetPlayerId] ??= {};
      for (const [key, value] of Object.entries(sourceValuations)) state.valuationHistory[targetPlayerId]![`merged:${sourcePlayerId}:${key}`] = value;
    }
    delete state.fantasyPlayers[sourcePlayerId];
    delete state.valuationHistory[sourcePlayerId];
  }

  let cancelledOffers = 0;
  for (const [offerId, offer] of Object.entries(state.offers ?? {})) {
    if (offer.playerId !== sourcePlayerId || offer.status !== "pending") continue;
    state.offers[offerId] = { ...offer, status: "cancelled", cancellationReason: "player_identity_merged", updatedAt: now };
    cancelledOffers += 1;
  }

  const result = { sourcePlayerId, targetPlayerId, mergedInvestment, ownerUid, cancelledOffers };
  state.idempotency[operationKey] = { result };
  return result;
}
