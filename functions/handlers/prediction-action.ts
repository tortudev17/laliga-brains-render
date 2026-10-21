import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { mutateEconomy } from "../lib/economy";
import { retirePredictionEconomy } from "../lib/predictions";
import { madridDateKey, madridDeadlinePassed } from "../lib/time";
import { asBadRequest, asForbidden, json, run, bodyOf, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  const { uid } = await requireUser(event);
  const today = madridDateKey();
  if (event.httpMethod === "GET") {
    await retirePredictionEconomy();
    const [snapshot, entriesSnapshot] = await Promise.all([
      firebaseDb.ref(`laligaBrains/economy/state/predictionRounds/${today}`).get(),
      firebaseDb.ref(`laligaBrains/economy/state/predictionEntries/${today}`).get(),
    ]);
    const round = snapshot.val() as Record<string, unknown> | null;
    const allEntries = (entriesSnapshot.val() ?? {}) as Record<string, { uid?: string; status?: string; questionId?: string; outcome?: string }>;
    const userEntries = Object.values(allEntries).filter((entry) => entry.uid === uid && entry.status === "active").map((entry) => ({ questionId: entry.questionId, outcome: entry.outcome, status: entry.status }));
    return json(200, { ...(round ?? { dateKey: today, status: "pending", questions: [] }), userEntries });
  }
  if (event.httpMethod !== "POST") return methodNotAllowed(["GET", "POST"]);
  const body = bodyOf(event);
  if (body.action !== "submit") throw asBadRequest("La acción del pronóstico no está disponible.");
  if (madridDeadlinePassed()) throw asForbidden("La jornada cerró a las 15:00 (hora peninsular). No se pueden cambiar pronósticos.");
  const questionId = String(body.questionId ?? "");
  const outcome = String(body.outcome ?? "");
  if (!questionId || !outcome) throw asBadRequest("Elige una pregunta y un resultado.");
  await retirePredictionEconomy();
  const result = await mutateEconomy<{ entryId: string; outcome: string; status: string }>((state) => {
    const round = state.predictionRounds[today];
    if (!round || round.status !== "open" || round.dateKey !== today) throw Object.assign(new Error("La jornada no está abierta."), { statusCode: 409 });
    const question = (round.questions as Record<string, { outcomes?: Record<string, unknown> }>)[questionId];
    if (!question || !question.outcomes || !(outcome in question.outcomes)) throw asBadRequest("El resultado elegido no pertenece a esta pregunta.");
    const entries = state.predictionEntries[today] ?? (state.predictionEntries[today] = {});
    const entryId = `${questionId}_${uid}`;
    const old = entries[entryId] as { status?: string; createdAt?: number } | undefined;
    if (old && old.status !== "active") throw Object.assign(new Error("Este pronóstico ya está cerrado."), { statusCode: 409 });
    const entry = { id: entryId, uid, questionId, outcome, status: "active", createdAt: old?.createdAt ?? Date.now(), updatedAt: Date.now() };
    entries[entryId] = entry;
    return { entryId, outcome, status: "active" };
  });
  await firebaseDb.ref(`laligaBrains/predictions/entries/${today}/${result.entryId}`).set({ ...result, uid, questionId, status: "active", updatedAt: Date.now() }).catch(() => undefined);
  return json(200, { result });
});
