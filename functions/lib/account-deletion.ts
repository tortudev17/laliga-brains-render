import { applyWalletDelta, type EconomyState } from "./economy-core";

export interface AccountDeletionEconomyResult {
  uid: string;
  releasedPlayers: number;
  cancelledOffers: number;
  closedBalance: number;
}

/** Close a manager's economy while preserving its ledger and making owned players available again. */
export function closeAccountEconomy(state: EconomyState, uid: string, actorUid: string, now = Date.now()): AccountDeletionEconomyResult {
  const key = `piero-account-deletion:${uid}`;
  const previous = state.idempotency[key]?.result as AccountDeletionEconomyResult | undefined;
  // Do not deliver a queued reward to an account being deleted while paused.
  for (const [creditKey, credit] of Object.entries(state.deferredCredits ?? {})) {
    if (credit.walletUid === uid) delete state.deferredCredits![creditKey];
  }
  if (previous) return previous;

  let releasedPlayers = 0;
  for (const [playerId, player] of Object.entries(state.fantasyPlayers ?? {})) {
    if (player.ownerUid !== uid) continue;
    const value = Number(player.value ?? 50);
    if (!Number.isSafeInteger(value) || value < 0) throw Object.assign(new Error("Hay un valor Fantasy no válido; no se ha eliminado la cuenta."), { statusCode: 409 });
    if (value > 0) applyWalletDelta(state, uid, value, "account_deletion_player_release", actorUid, `${key}:release:${playerId}`, playerId, true, true);
    player.ownerUid = null;
    player.updatedAt = now;
    state.ownershipHistory[playerId] = {
      ...(state.ownershipHistory[playerId] as Record<string, unknown> | undefined ?? {}),
      [`${key}:release:${playerId}`]: { previousOwnerUid: uid, ownerUid: null, action: "account_deletion_release", amount: value, actorUid, createdAt: now },
    };
    releasedPlayers += 1;
  }

  let cancelledOffers = 0;
  for (const offer of Object.values(state.offers ?? {})) {
    if (offer.status !== "pending" || (offer.creatorUid !== uid && offer.recipientUid !== uid)) continue;
    offer.status = "cancelled";
    offer.cancellationReason = "account_deleted";
    offer.updatedAt = now;
    cancelledOffers += 1;
  }

  const balance = Number(state.wallets[uid] ?? 0);
  if (!Number.isSafeInteger(balance)) throw Object.assign(new Error("El monedero de esta cuenta no es válido; no se ha eliminado."), { statusCode: 409 });
  if (balance !== 0) applyWalletDelta(state, uid, -balance, "account_deletion_wallet_close", actorUid, `${key}:wallet-close`, undefined, true, true);

  const result = { uid, releasedPlayers, cancelledOffers, closedBalance: balance };
  state.idempotency[key] = { result };
  return result;
}
