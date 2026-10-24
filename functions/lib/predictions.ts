import { mutateEconomy, type EconomyState } from "./economy";
import { createPredictionQuestions, type PredictionPlayerSample, type PredictionMatchSample } from "./prediction-math";
import { isWeekday, madridDateKey, madridHour } from "./time";
import { firebaseDb } from "./firebase-rest";
export { estimateProbability, createWinnerQuestion, createPlayerQuestions, createPredictionQuestions } from "./prediction-math";

export type MatchTarget = { id: string; playedAt: number; score3ESO: number; score4ESO: number; goalscorers4ESO: Record<string, number> };

export async function settleRound(dateKey: string, match: MatchTarget) {
  return mutateEconomy((state) => {
    const round = state.predictionRounds[dateKey];
    if (!round || round.status === "refunded" || round.status === "cancelled") return { settled: false, status: round?.status ?? "missing" };
    if (round.matchId && round.matchId !== match.id) return { settled: false, status: round.status };

    round.matchId = match.id;
    round.status = "settling";
    const entries = state.predictionEntries[dateKey] ?? {};
    state.predictionCorrect ??= {};
    let count = 0;
    for (const entryValue of Object.values(entries)) {
      const entry = entryValue as Record<string, unknown>;
      if (!["active", "correct", "incorrect", "won", "lost"].includes(String(entry.status))) continue;
      const question = (round.questions as Record<string, Record<string, unknown>>)[String(entry.questionId)];
      if (!question) continue;
      const correct = String(entry.outcome) === outcomeFor(question, match);
      const wasCorrect = entry.correct === true;
      if (correct !== wasCorrect) {
        const uid = String(entry.uid);
        state.predictionCorrect[uid] = Math.max(0, Number(state.predictionCorrect[uid] ?? 0) + (correct ? 1 : -1));
      }
      entry.status = correct ? "correct" : "incorrect";
      entry.settledAt = Date.now();
      entry.matchId = match.id;
      entry.correct = correct;
      count += 1;
    }
    round.status = "settled";
    round.settledAt = Date.now();
    round.settlementRevision = Number(round.settlementRevision ?? 0) + 1;
    round.entriesSettled = count;
    return { settled: true, status: "settled", entries: count };
  }).then(async (result) => {
    await adminMirrorRound(dateKey);
    return result;
  });
}

export async function cancelSettledRound(dateKey: string, matchId: string) {
  return mutateEconomy((state) => {
    const round = state.predictionRounds[dateKey];
    if (!round || round.matchId !== matchId || round.status === "refunded" || round.status === "cancelled") return { cancelled: false, status: round?.status ?? "missing" };
    if (round.status !== "settled") return { cancelled: false, status: round.status };
    state.predictionCorrect ??= {};
    let cancelled = 0;
    for (const entryValue of Object.values(state.predictionEntries[dateKey] ?? {})) {
      const entry = entryValue as Record<string, unknown>;
      if (!["correct", "incorrect", "won", "lost"].includes(String(entry.status))) continue;
      const uid = String(entry.uid);
      if (entry.correct === true) state.predictionCorrect[uid] = Math.max(0, Number(state.predictionCorrect[uid] ?? 0) - 1);
      entry.status = "cancelled";
      entry.correct = false;
      entry.cancelledAt = Date.now();
      entry.reason = "match_deleted";
      cancelled += 1;
    }
    round.status = "cancelled";
    round.cancelledAt = Date.now();
    round.cancellationReason = "match_deleted";
    return { cancelled: true, entriesCancelled: cancelled };
  }).then(async (result) => { await adminMirrorRound(dateKey); return result; });
}

export async function expireOldRounds(todayKey: string) {
  const stateSnapshot = await (await import("./firebase-rest")).firebaseDb.ref("laligaBrains/economy/state").get();
  const before = stateSnapshot.val() as EconomyState | null;
  const dates = Object.keys(before?.predictionRounds ?? {}).filter((key) => key < todayKey);
  const results: Array<{ dateKey: string; cancelled: number }> = [];
  for (const dateKey of dates) {
    const result = await mutateEconomy((state) => {
      const round = state.predictionRounds[dateKey];
      if (!round || !["open", "closed", "settling"].includes(String(round.status)) || round.matchId) return { dateKey, cancelled: 0 };
      round.status = "cancelled";
      round.cancelledAt = Date.now();
      round.cancellationReason = "no_match_recorded";
      let count = 0;
      for (const entryValue of Object.values(state.predictionEntries[dateKey] ?? {})) {
        const entry = entryValue as Record<string, unknown>;
        if (entry.status !== "active") continue;
        entry.status = "cancelled";
        entry.cancelledAt = Date.now();
        entry.reason = "no_match_recorded";
        count += 1;
      }
      return { dateKey, cancelled: count };
    });
    results.push(result);
    await adminMirrorRound(dateKey);
  }
  return results;
}

/**
 * Publishes one free-pick round per school day. The hourly scheduler normally
 * calls this at 08:00 Europe/Madrid; the authenticated page also calls it as a
 * catch-up if a scheduled invocation was missed. Historical coin stakes are
 * never used by this free prediction feature.
 */
export async function ensureTodaysPredictionRound(now = new Date()) {
  const dateKey = madridDateKey(now);
  if (!isWeekday(now) || madridHour(now) >= 15) return { created: false, reason: "outside_window" as const };
  const existing = await firebaseDb.ref(`laligaBrains/economy/state/predictionRounds/${dateKey}`).get();
  if (existing.exists()) return { created: false, reason: "already_exists" as const };
  const closure = await firebaseDb.ref(`laligaBrains/config/schoolCalendar/closedDates/${dateKey}`).get();
  const closureValue = closure.val() as unknown;
  if (closureValue === true || (typeof closureValue === "object" && closureValue !== null && (closureValue as { closed?: unknown }).closed === true)) {
    return { created: false, reason: "school_closed" as const };
  }

  const [matchesSnapshot, playersSnapshot] = await Promise.all([
    firebaseDb.ref("laligaBrains/football/matches").orderByChild("playedAt").limitToLast(50).get(),
    firebaseDb.ref("laligaBrains/identity/playerProfiles").get(),
  ]);
  const matches = Object.entries((matchesSnapshot.val() ?? {}) as Record<string, Record<string, unknown>>)
    .map(([id, match]) => ({
      id,
      playedAt: Number(match.playedAt ?? 0),
      dateKey: String(match.dateKey ?? ""),
      score3ESO: Number(match.score3ESO ?? 0),
      score4ESO: Number(match.score4ESO ?? 0),
      goalscorers4ESO: (match.goalscorers4ESO ?? {}) as Record<string, number>,
    }))
    .filter((match) => Number.isSafeInteger(match.score3ESO) && Number.isSafeInteger(match.score4ESO) && (!match.dateKey || match.dateKey <= dateKey)) as PredictionMatchSample[];
  const players = Object.entries((playersSnapshot.val() ?? {}) as Record<string, Record<string, unknown>>)
    .map(([id, player]) => ({ id, name: String(player.name ?? "Jugador"), team: String(player.team ?? ""), archived: player.archived === true, unknown: player.unknown === true })) as PredictionPlayerSample[];
  const questions = createPredictionQuestions(matches, players);
  const round = { dateKey, status: "open", questions, createdAt: now.getTime(), closesAtLocal: "15:00", matchesAnalyzed: matches.length, target: "Primer partido registrado por Piero en esta fecha" };
  const result = await mutateEconomy((state) => {
    if (state.predictionRounds[dateKey]) return { created: false, round: state.predictionRounds[dateKey] };
    state.predictionRounds[dateKey] = round;
    return { created: true, round };
  });
  if (result.created) await adminMirrorRound(dateKey);
  return { created: result.created, reason: result.created ? "created" as const : "already_exists" as const, round: result.round };
}

async function adminMirrorRound(dateKey: string) {
  const { firebaseDb } = await import("./firebase-rest");
  const state = (await firebaseDb.ref("laligaBrains/economy/state").get()).val() as EconomyState | null;
  const round = state?.predictionRounds?.[dateKey];
  if (round) await firebaseDb.ref(`laligaBrains/predictions/rounds/${dateKey}`).set(round);
  const entries = state?.predictionEntries?.[dateKey];
  if (entries) await firebaseDb.ref(`laligaBrains/predictions/entries/${dateKey}`).set(entries);
}

function outcomeFor(question: Record<string, unknown>, match: MatchTarget): string {
  if (question.kind === "winner") return match.score3ESO > match.score4ESO ? "3 ESO" : match.score3ESO < match.score4ESO ? "4 ESO" : "Empate";
  const playerId = String(question.playerId ?? "");
  const goals = Number(match.goalscorers4ESO[playerId] ?? 0);
  const threshold = Number(question.threshold ?? 1);
  return goals >= threshold ? "Sí" : "No";
}
