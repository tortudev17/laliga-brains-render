import { randomUUID } from "node:crypto";
import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { applyWalletDelta, mutateEconomy, type EconomyState } from "../lib/economy";
import { QUIZ_QUESTIONS, pickQuizQuestions, publicQuizQuestion, secureRandomIndex } from "../lib/quiz-bank";
import { madridDateKey } from "../lib/time";
import { asBadRequest, asForbidden, json, run, bodyOf, methodNotAllowed } from "../lib/http";

const QUESTIONS_PER_GAME = 5;
const COINS_PER_CORRECT_ANSWER = 5;
const quizById = new Map(QUIZ_QUESTIONS.map((question) => [question.id, question]));

type QuizAnswer = { selected: string; correct: boolean; correctAnswer: string; reward: number; deferred?: boolean; answeredAt: number };
type QuizSession = {
  sessionId: string;
  startKey: string;
  questionIds: string[];
  answers: Record<string, QuizAnswer>;
  status: "open" | "completed";
  startedAt: number;
  completedAt?: number;
  score: number;
  earned: number;
};
type QuizDay = { sessions: QuizSession[] };

export const handler: Handler = async (event) => run(async () => {
  const { uid } = await requireUser(event);
  const dateKey = madridDateKey();
  if (event.httpMethod === "GET") {
    const snapshot = await firebaseDb.ref(`laligaBrains/economy/state`).get();
    const state = snapshot.val() as EconomyState | null;
    const day = (state?.quizSessions?.[uid]?.[dateKey] ?? { sessions: [] }) as QuizDay;
    return json(200, { dateKey, ...dayView(day, state?.wallets?.[uid] ?? 0, undefined, Boolean(state?.economyPaused)) });
  }
  if (event.httpMethod !== "POST") return methodNotAllowed(["GET", "POST"]);
  const body = bodyOf(event);
  if (body.action === "start") return json(200, { result: await startQuiz(uid, dateKey, String(body.startKey ?? "")) });
  if (body.action === "answer") return json(200, { result: await answerQuestion(uid, dateKey, body) });
  throw asBadRequest("La acción del quiz no está disponible.");
});

async function startQuiz(uid: string, dateKey: string, startKey: string) {
  if (!/^[a-f0-9-]{36}$/i.test(startKey)) throw asBadRequest("No se ha podido iniciar la partida. Vuelve a intentarlo.");
  const questionIds = pickQuizQuestions(QUIZ_QUESTIONS, secureRandomIndex, QUESTIONS_PER_GAME).map((question) => question.id);
  const proposed: QuizSession = {
    sessionId: randomUUID(), startKey, questionIds, answers: {}, status: "open", startedAt: Date.now(), score: 0, earned: 0,
  };
  return mutateEconomy((state) => {
    state.quizSessions ??= {};
    const byUser = state.quizSessions[uid] ?? (state.quizSessions[uid] = {});
    const day = (byUser[dateKey] ?? (byUser[dateKey] = { sessions: [] })) as QuizDay;
    day.sessions ??= [];
    const repeated = day.sessions.find((session) => session.startKey === startKey);
    if (repeated) return dayView(day, state.wallets[uid] ?? 0, repeated.sessionId, Boolean(state.economyPaused));
    const active = day.sessions.find((session) => session.status === "open");
    if (active) return dayView(day, state.wallets[uid] ?? 0, active.sessionId, Boolean(state.economyPaused));
    day.sessions.push(proposed);
    return dayView(day, state.wallets[uid] ?? 0, proposed.sessionId, Boolean(state.economyPaused));
  });
}

async function answerQuestion(uid: string, dateKey: string, body: Record<string, unknown>) {
  const sessionId = String(body.sessionId ?? "");
  const questionId = String(body.questionId ?? "");
  const selected = String(body.answer ?? "");
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) throw asBadRequest("La partida del quiz no es válida.");
  const question = quizById.get(questionId);
  if (!question || !question.options.includes(selected)) throw asBadRequest("Elige una de las respuestas disponibles.");
  return mutateEconomy((state) => {
    state.quizSessions ??= {};
    const day = state.quizSessions[uid]?.[dateKey] as QuizDay | undefined;
    const session = day?.sessions?.find((item) => item.sessionId === sessionId);
    if (!session) throw asForbidden("No se ha encontrado tu partida del quiz de hoy.");
    const existing = session.answers?.[questionId];
    if (existing) return { ...answerView(existing), duplicate: true, ...dayView(day!, state.wallets[uid] ?? 0, sessionId, Boolean(state.economyPaused)) };
    if (session.status !== "open") throw Object.assign(new Error("Esta partida ya ha terminado."), { statusCode: 409 });
    if (!session.questionIds.includes(questionId)) throw asForbidden("Esta pregunta no pertenece a tu intento.");

    const correct = selected === question.answer;
    const reward = correct ? COINS_PER_CORRECT_ANSWER : 0;
    const wallet = reward
      ? applyWalletDelta(state, uid, reward, "quiz_correct_answer", null, `quiz:${uid}:${dateKey}:${sessionId}:${questionId}`, questionId, false, false, true)
      : { balance: state.wallets[uid] ?? 0, deferred: false };
    const answer: QuizAnswer = { selected, correct, correctAnswer: question.answer, reward, deferred: Boolean(wallet.deferred), answeredAt: Date.now() };
    session.answers ??= {};
    session.answers[questionId] = answer;
    if (correct) { session.score = Number(session.score ?? 0) + 1; session.earned = Number(session.earned ?? 0) + reward; }
    if (Object.keys(session.answers).length >= session.questionIds.length) {
      session.status = "completed";
      session.completedAt = Date.now();
    }
    return { ...answerView(answer), duplicate: false, ...dayView(day!, wallet.balance, sessionId, Boolean(state.economyPaused)) };
  });
}

function dayView(day: QuizDay, walletBalance: number, preferredSessionId?: string, economyPaused = false) {
  const sessions = Array.isArray(day.sessions) ? day.sessions : [];
  const session = (preferredSessionId && sessions.find((item) => item.sessionId === preferredSessionId))
    ?? sessions.find((item) => item.status === "open")
    ?? sessions.at(-1);
  const totalEarnedToday = sessions.reduce((total, item) => total + Number(item.earned ?? 0), 0);
  return {
    gamesPlayed: sessions.length,
    totalEarnedToday,
    walletBalance,
    economyPaused,
    session: session ? {
      sessionId: session.sessionId,
      gameNumber: sessions.indexOf(session) + 1,
      status: session.status,
      score: Number(session.score ?? 0),
      earned: Number(session.earned ?? 0),
      questionIds: [...session.questionIds],
      questions: session.questionIds.map((id) => quizById.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item)).map(publicQuizQuestion),
      answers: session.answers ?? {},
    } : null,
  };
}

function answerView(answer: QuizAnswer) {
  return { correct: answer.correct, selected: answer.selected, correctAnswer: answer.correctAnswer, reward: answer.reward, deferred: Boolean(answer.deferred) };
}
