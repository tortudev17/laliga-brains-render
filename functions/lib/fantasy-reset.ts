import { applyWalletDelta, type EconomyState } from "./economy-core";

export const RESET_WALLET_BALANCE = 120;

export interface FantasyResetResult {
  resetId: string;
  usersReset: number;
  playersReleased: number;
  offersCancelled: number;
}

export interface FantasyRetirementResult {
  playerId: string;
  archived: boolean;
  duplicate: boolean;
  previousOwnerUid: string | null;
  refundAmount: number;
}

/** Retire a player account/profile while keeping its goals and football identity. */
export function retireFantasyPlayerState(
  state: EconomyState,
  playerId: string,
  actorUid: string,
  idempotencyKey: string,
  now = Date.now(),
): FantasyRetirementResult {
  const operationKey = `piero-player-retirement:${idempotencyKey}:${playerId}`;
  const previous = state.idempotency[operationKey]?.result as FantasyRetirementResult | undefined;
  if (previous) return { ...previous, duplicate: true };

  const player = state.fantasyPlayers[playerId];
  const previousOwnerUid = typeof player?.ownerUid === "string" ? player.ownerUid : null;
  if (player?.archived === true) {
    const result: FantasyRetirementResult = { playerId, archived: true, duplicate: true, previousOwnerUid: null, refundAmount: 0 };
    state.idempotency[operationKey] = { result };
    return result;
  }

  const refundAmount = previousOwnerUid ? Number(player?.value ?? 50) : 0;
  if (!Number.isSafeInteger(refundAmount) || refundAmount < 0) {
    throw Object.assign(new Error("El valor del jugador no es válido; no se ha retirado."), { statusCode: 409 });
  }
  if (previousOwnerUid && refundAmount > 0) {
    applyWalletDelta(state, previousOwnerUid, refundAmount, "piero_player_retirement", actorUid, operationKey, playerId, true);
  }
  if (player) {
    player.ownerUid = null;
    player.archived = true;
    player.archivedAt = now;
    player.archivedBy = actorUid;
    player.updatedAt = now;
  }
  if (previousOwnerUid) {
    const history = state.ownershipHistory[playerId] as Record<string, unknown> | undefined;
    state.ownershipHistory[playerId] = {
      ...(history ?? {}),
      [operationKey]: { previousOwnerUid, ownerUid: null, action: "piero_retirement", amount: refundAmount, actorUid, createdAt: now },
    };
  }
  for (const offer of Object.values(state.offers ?? {})) {
    if (offer.playerId !== playerId || offer.status !== "pending") continue;
    offer.status = "cancelled";
    offer.updatedAt = now;
    offer.cancellationReason = "piero_player_retirement";
  }
  const result: FantasyRetirementResult = { playerId, archived: true, duplicate: false, previousOwnerUid, refundAmount };
  state.idempotency[operationKey] = { result };
  return result;
}

/** Reset wallet balances and Fantasy ownership in one authoritative economy transaction. */
export function resetFantasyEconomyState(
  state: EconomyState,
  accountUids: string[],
  actorUid: string,
  idempotencyKey: string,
  now = Date.now(),
): FantasyResetResult {
  const operationKey = `piero-fantasy-reset:${idempotencyKey}`;
  const previous = state.idempotency[operationKey]?.result as FantasyResetResult | undefined;
  if (previous) return previous;

  const resetId = idempotencyKey;
  const uids = new Set([...Object.keys(state.wallets ?? {}), ...accountUids]);
  for (const uid of uids) {
    const previousBalance = Number(state.wallets[uid] ?? 0);
    if (!Number.isSafeInteger(previousBalance)) {
      throw Object.assign(new Error("Hay un saldo no válido; no se ha aplicado el reinicio."), { statusCode: 409 });
    }
    const adjustment = RESET_WALLET_BALANCE - previousBalance;
    if (adjustment !== 0) {
      applyWalletDelta(
        state,
        uid,
        adjustment,
        "piero_fantasy_reset",
        actorUid,
        `${operationKey}:wallet:${uid}`,
        resetId,
        true,
      );
    }
  }

  let playersReleased = 0;
  for (const [playerId, player] of Object.entries(state.fantasyPlayers ?? {})) {
    const previousOwnerUid = typeof player.ownerUid === "string" ? player.ownerUid : null;
    if (previousOwnerUid) {
      const history = state.ownershipHistory[playerId] as Record<string, unknown> | undefined;
      state.ownershipHistory[playerId] = {
        ...(history ?? {}),
        [`${resetId}:${playerId}`]: {
          previousOwnerUid,
          ownerUid: null,
          action: "piero_reset_release",
          amount: 0,
          createdAt: now,
          resetId,
        },
      };
    }
    player.ownerUid = null;
    player.value = 50;
    player.performanceValue = 50;
    player.permanentInvestment = 0;
    player.updatedAt = now;
    if (previousOwnerUid) playersReleased += 1;
  }

  let offersCancelled = 0;
  for (const offer of Object.values(state.offers ?? {})) {
    if (offer.status !== "pending") continue;
    offer.status = "cancelled";
    offer.updatedAt = now;
    offer.cancellationReason = "piero_fantasy_reset";
    offersCancelled += 1;
  }

  const result: FantasyResetResult = {
    resetId,
    usersReset: uids.size,
    playersReleased,
    offersCancelled,
  };
  state.idempotency[operationKey] = { result };
  return result;
}
