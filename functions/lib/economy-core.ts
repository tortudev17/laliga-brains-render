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
  fantasyExtraSlots: Record<string, number>;
  predictionEconomyRetired?: boolean;
  operations: Record<string, Record<string, unknown>>;
}

export function emptyEconomy(): EconomyState {
  return { wallets: {}, ledger: {}, idempotency: {}, fantasyPlayers: {}, fantasyExtraSlots: {}, valuationHistory: {}, ownershipHistory: {}, offers: {}, promotions: {}, dailyPosts: {}, predictionRounds: {}, predictionEntries: {}, predictionCorrect: {}, operations: {} };
}

export function nextFantasySlotPrice(purchasedExtraSlots: number) {
  const count = Number.isSafeInteger(purchasedExtraSlots) ? Math.max(0, purchasedExtraSlots) : 0;
  return count === 0 ? 500 : count === 1 ? 5000 : 50000;
}

export function fantasyRosterLimit(state: EconomyState, uid: string) {
  const purchased = Number(state.fantasyExtraSlots?.[uid] ?? 0);
  return 5 + (Number.isSafeInteger(purchased) ? Math.max(0, purchased) : 0);
}

export function purchaseFantasySlot(state: EconomyState, uid: string, idempotencyKey: string) {
  const existing = state.idempotency[idempotencyKey];
  if (existing) return existing.result as { extraSlots: number; rosterLimit: number; price: number; balance: number };
  const previousCount = Number(state.fantasyExtraSlots?.[uid] ?? 0);
  const extraSlots = Number.isSafeInteger(previousCount) && previousCount >= 0 ? previousCount : 0;
  const price = nextFantasySlotPrice(extraSlots);
  const wallet = applyWalletDelta(state, uid, -price, "fantasy_roster_slot", uid, idempotencyKey);
  const updatedExtraSlots = extraSlots + 1;
  state.fantasyExtraSlots[uid] = updatedExtraSlots;
  const result = { extraSlots: updatedExtraSlots, rosterLimit: 5 + updatedExtraSlots, price, balance: wallet.balance };
  state.idempotency[idempotencyKey] = { result };
  return result;
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

export function applyWalletDelta(state: EconomyState, walletUid: string, amount: number, type: string, actorUid: string | null, idempotencyKey: string, relatedEntityId?: string, allowDebt = false) {
  if (!Number.isSafeInteger(amount) || amount === 0) throw Object.assign(new Error("El importe debe ser un número entero distinto de cero."), { statusCode: 400 });
  const existing = state.idempotency[idempotencyKey];
  if (existing) return existing.result as { balance: number; transactionId: string };
  const balance = state.wallets[walletUid] ?? 0;
  if (amount < 0 && !allowDebt && balance < Math.abs(amount)) throw Object.assign(new Error(`Saldo insuficiente: se necesitan ${Math.abs(amount)} monedas y hay ${balance}.`), { statusCode: 409 });
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
