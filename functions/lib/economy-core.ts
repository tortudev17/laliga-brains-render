import { randomUUID } from "node:crypto";

export interface EconomyState {
  wallets: Record<string, number>;
  ledger: Record<string, Record<string, unknown>>;
  idempotency: Record<string, { result: unknown }>;
  fantasyPlayers: Record<string, Record<string, unknown>>;
  valuationHistory: Record<string, Record<string, unknown>>;
  ownershipHistory: Record<string, unknown>;
  offers: Record<string, Record<string, unknown>>;
  promotions: Record<string, Record<string, unknown>>;
  dailyPosts: Record<string, { dateKey: string; count: number }>;
  predictionRounds: Record<string, Record<string, unknown>>;
  predictionEntries: Record<string, Record<string, unknown>>;
  predictionCorrect: Record<string, number>;
  quizSessions: Record<string, Record<string, unknown>>;
  /** When paused, debits are rejected and new credits wait here until resume. */
  economyPaused?: boolean;
  deferredCredits?: Record<string, { walletUid: string; amount: number; type: string; actorUid: string | null; idempotencyKey: string; relatedEntityId?: string; createdAt: number }>;
  /** Legacy field retained only so old records deserialize; roster limits ignore it. */
  fantasyExtraSlots?: Record<string, number>;
  predictionEconomyRetired?: boolean;
  operations: Record<string, Record<string, unknown>>;
}

export function emptyEconomy(): EconomyState {
  return { wallets: {}, ledger: {}, idempotency: {}, fantasyPlayers: {}, valuationHistory: {}, ownershipHistory: {}, offers: {}, promotions: {}, dailyPosts: {}, predictionRounds: {}, predictionEntries: {}, predictionCorrect: {}, quizSessions: {}, deferredCredits: {}, economyPaused: false, operations: {} };
}

export function fantasyRosterLimit(_state: EconomyState, _uid: string) {
  return 5;
}

export function calculateFantasyAssetValue(state: EconomyState, uid: string) {
  return Object.values(state.fantasyPlayers ?? {}).reduce((total, player) => {
    if (player.ownerUid !== uid || player.archived === true) return total;
    const value = Number(player.value ?? 50);
    return Number.isSafeInteger(value) && value > 0 ? total + value : total;
  }, 0);
}

export function calculateNetWorth(walletBalance: number, fantasyAssetValue: number) {
  return walletBalance + fantasyAssetValue;
}

export function withdrawFantasyInvestment(state: EconomyState, uid: string, playerId: string, amount: number, idempotencyKey: string) {
  const existing = state.idempotency[idempotencyKey];
  if (existing) return existing.result as { playerId: string; value: number; investment: number; balance: number };

  const player = state.fantasyPlayers[playerId];
  if (!player || player.ownerUid !== uid) throw Object.assign(new Error("Solo puedes retirar inversión de un jugador de tu plantilla."), { statusCode: 403 });
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Object.assign(new Error("La retirada debe ser un número entero positivo."), { statusCode: 400 });

  const investment = Number(player.permanentInvestment ?? 0);
  if (!Number.isSafeInteger(investment) || amount > investment) {
    throw Object.assign(new Error(`Solo puedes retirar hasta ${Math.max(0, investment)} monedas de inversión.`), { statusCode: 409 });
  }

  const currentValue = Number(player.value ?? 50);
  const performanceValue = Math.max(50, Number(player.performanceValue ?? currentValue - investment));
  const wallet = applyWalletDelta(state, uid, amount, "fantasy_investment_withdrawal", uid, idempotencyKey, playerId);
  player.permanentInvestment = investment - amount;
  player.performanceValue = performanceValue;
  player.value = Math.max(performanceValue, currentValue - amount);
  player.updatedAt = Date.now();

  const result = { playerId, value: player.value, investment: player.permanentInvestment, balance: wallet.balance };
  state.idempotency[idempotencyKey] = { result };
  return result;
}

export interface WalletDeltaResult { balance: number; transactionId: string; deferred?: boolean }

export function applyWalletDelta(state: EconomyState, walletUid: string, amount: number, type: string, actorUid: string | null, idempotencyKey: string, relatedEntityId?: string, allowDebt = false, bypassPause = false, deferWhilePaused = false): WalletDeltaResult {
  if (!Number.isSafeInteger(amount) || amount === 0) throw Object.assign(new Error("El importe debe ser un número entero distinto de cero."), { statusCode: 400 });
  const existing = state.idempotency[idempotencyKey];
  if (existing) return existing.result as WalletDeltaResult;
  state.deferredCredits ??= {};
  const alreadyDeferred = state.deferredCredits[idempotencyKey];
  if (alreadyDeferred && !bypassPause) return { balance: state.wallets[walletUid] ?? 0, transactionId: `pendiente:${idempotencyKey}`, deferred: true };
  if (alreadyDeferred && bypassPause) delete state.deferredCredits[idempotencyKey];
  if (state.economyPaused && !bypassPause) {
    if (amount < 0 || !deferWhilePaused) throw Object.assign(new Error("La economía está pausada: no se pueden realizar operaciones con monedas ahora."), { statusCode: 423 });
    state.deferredCredits[idempotencyKey] = { walletUid, amount, type, actorUid, idempotencyKey, ...(relatedEntityId ? { relatedEntityId } : {}), createdAt: Date.now() };
    return { balance: state.wallets[walletUid] ?? 0, transactionId: `pendiente:${idempotencyKey}`, deferred: true };
  }
  const balance = state.wallets[walletUid] ?? 0;
  if (amount < 0 && !allowDebt && balance < Math.abs(amount)) throw Object.assign(new Error(`Saldo insuficiente: se necesitan ${Math.abs(amount)} monedas y hay ${balance}.`), { statusCode: 409 });
  const balanceAfter = balance + amount;
  const transactionId = randomUUID();
  state.wallets[walletUid] = balanceAfter;
  state.ledger[walletUid] ??= {};
  state.ledger[walletUid][transactionId] = { id: transactionId, walletUid, actorUid, amount, type, relatedEntityId, idempotencyKey, balanceAfter, createdAt: Date.now() };
  const result = { balance: balanceAfter, transactionId, deferred: false };
  state.idempotency[idempotencyKey] = { result };
  return result;
}

/** Resume all queued rewards atomically with the pause flag and wallet ledger. */
export function setEconomyPaused(state: EconomyState, paused: boolean, actorUid: string) {
  state.deferredCredits ??= {};
  if (paused) {
    state.economyPaused = true;
    return { paused: true, releasedCredits: 0 };
  }
  state.economyPaused = false;
  const queued = Object.values(state.deferredCredits).sort((a, b) => a.createdAt - b.createdAt);
  for (const credit of queued) {
    applyWalletDelta(state, credit.walletUid, credit.amount, credit.type, credit.actorUid ?? actorUid, credit.idempotencyKey, credit.relatedEntityId, false, true);
    delete state.deferredCredits[credit.idempotencyKey];
  }
  return { paused: false, releasedCredits: queued.length };
}

export function retirePredictionEconomyState(state: EconomyState) {
  if (state.predictionEconomyRetired) return { alreadyRetired: true, adjustedAccounts: 0 };

  const netByUid: Record<string, number> = {};
  for (const [walletUid, transactions] of Object.entries(state.ledger ?? {})) {
    for (const transactionValue of Object.values(transactions ?? {})) {
      const transaction = transactionValue as { type?: unknown; amount?: unknown; walletUid?: unknown };
      if (typeof transaction.type !== "string" || !transaction.type.startsWith("prediction_")) continue;
      const uid = typeof transaction.walletUid === "string" ? transaction.walletUid : walletUid;
      const amount = Number(transaction.amount ?? 0);
      if (!Number.isSafeInteger(amount)) continue;
      netByUid[uid] = (netByUid[uid] ?? 0) + amount;
    }
  }

  let adjustedAccounts = 0;
  for (const [uid, net] of Object.entries(netByUid)) {
    if (!net) continue;
    applyWalletDelta(
      state,
      uid,
      -net,
      "prediction_retirement_reversal",
      null,
      `prediction-economy-retired-v1:${uid}`,
      "prediction-economy-retirement",
      true,
      true,
    );
    adjustedAccounts += 1;
  }

  for (const entries of Object.values(state.predictionEntries ?? {})) {
    for (const entryValue of Object.values(entries ?? {})) {
      const entry = entryValue as Record<string, unknown>;
      const stake = Number(entry.stake ?? 0);
      const payout = Number(entry.payout ?? 0);
      if (stake > 0) entry.legacyStake = stake;
      if (payout > 0) entry.legacyPayout = payout;
      delete entry.stake;
      delete entry.payout;
    }
  }

  state.predictionEconomyRetired = true;
  return { alreadyRetired: false, adjustedAccounts };
}
