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
  predictionEconomyRetired?: boolean;
  operations: Record<string, Record<string, unknown>>;
}

export function emptyEconomy(): EconomyState {
  return { wallets: {}, ledger: {}, idempotency: {}, fantasyPlayers: {}, valuationHistory: {}, ownershipHistory: {}, offers: {}, promotions: {}, dailyPosts: {}, predictionRounds: {}, predictionEntries: {}, predictionCorrect: {}, operations: {} };
}

export function applyWalletDelta(state: EconomyState, walletUid: string, amount: number, type: string, actorUid: string | null, idempotencyKey: string, relatedEntityId?: string, allowDebt = false) {
  if (!Number.isSafeInteger(amount) || amount === 0) throw Object.assign(new Error("El importe debe ser un número entero distinto de cero."), { statusCode: 400 });
  const existing = state.idempotency[idempotencyKey];
  if (existing) return existing.result as { balance: number; transactionId: string };
  const balance = state.wallets[walletUid] ?? 0;
  if (amount < 0 && !allowDebt && balance < Math.abs(amount)) throw Object.assign(new Error("No tienes monedas suficientes."), { statusCode: 409 });
  const balanceAfter = balance + amount;
  const transactionId = randomUUID();
  state.wallets[walletUid] = balanceAfter;
  state.ledger[walletUid] ??= {};
  state.ledger[walletUid][transactionId] = { id: transactionId, walletUid, actorUid, amount, type, relatedEntityId, idempotencyKey, balanceAfter, createdAt: Date.now() };
  const result = { balance: balanceAfter, transactionId };
  state.idempotency[idempotencyKey] = { result };
  return result;
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
