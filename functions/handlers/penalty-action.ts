import { randomInt, randomUUID } from "node:crypto";
import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { createWalletCredit } from "../lib/economy";
import { asBadRequest, asForbidden, json, run, bodyOf, methodNotAllowed } from "../lib/http";

const rewards = { facil: 5, medio: 10, dificil: 20 } as const;
type Difficulty = keyof typeof rewards;
type Shot = { direction: string; power: number; goalkeeper: string; goal: boolean; createdAt: number };

export const handler: Handler = async (event) => run(async () => {
  const { uid } = await requireUser(event);
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const body = bodyOf(event);
  if (body.action === "start") {
    const difficulty = String(body.difficulty ?? "medio") as Difficulty;
    if (!(difficulty in rewards)) throw asBadRequest("Elige una dificultad válida.");
    const sessionId = randomUUID();
    const now = Date.now();
    await firebaseDb.ref(`laligaBrains/penalties/sessions/${sessionId}`).set({ id: sessionId, uid, difficulty, shots: [], createdAt: now, expiresAt: now + 20 * 60 * 1000, status: "active" });
    return json(201, { sessionId, shots: 5, reward: rewards[difficulty] });
  }
  if (body.action === "shot") {
    const sessionId = String(body.sessionId ?? "");
    const direction = String(body.direction ?? "");
    const power = Number(body.power);
    if (!sessionId || !["izquierda", "centro", "derecha"].includes(direction) || !Number.isInteger(power) || power < 25 || power > 100) throw asBadRequest("El disparo no es válido.");
    const sessionRef = firebaseDb.ref(`laligaBrains/penalties/sessions/${sessionId}`);
    let response: { shot: number; goal: boolean; completed: boolean; goals: number; difficulty: Difficulty } | undefined;
    const transaction = await sessionRef.transaction((session) => {
      if (!session || session.uid !== uid || session.status !== "active" || session.expiresAt < Date.now() || session.shots.length >= 5) return;
      const difficulty = session.difficulty as Difficulty;
      const goalkeeper = ["izquierda", "centro", "derecha"][randomInt(0, 3)]!;
      const base = difficulty === "facil" ? 0.86 : difficulty === "medio" ? 0.72 : 0.58;
      const powerPenalty = power > 90 ? 0.11 : power < 40 ? 0.08 : 0;
      const saveChance = direction === goalkeeper ? 0.83 : 1 - Math.max(0.08, base - powerPenalty);
      const goal = randomInt(0, 10000) / 10000 >= saveChance;
      const shots = [...(session.shots as Shot[]), { direction, power, goalkeeper, goal, createdAt: Date.now() }];
      const goals = shots.filter((shot) => shot.goal).length;
      const completed = shots.length === 5;
      session.shots = shots;
      if (completed) { session.status = "completed"; session.completedAt = Date.now(); session.goals = goals; }
      return session;
    }, undefined, false);
    if (!transaction.committed) throw asForbidden("La tanda ha terminado o ha caducado.");
    const session = transaction.snapshot.val() as { shots: Shot[]; status: string; goals?: number; difficulty: Difficulty };
    const latest = session.shots.at(-1)!;
    const completed = session.status === "completed";
    response = { shot: session.shots.length, goal: latest.goal, completed, goals: Number(session.goals ?? session.shots.filter((shot) => shot.goal).length), difficulty: session.difficulty };
    let reward: number | undefined;
    if (completed && response.goals >= 3) {
      reward = rewards[session.difficulty];
      await createWalletCredit(uid, reward, "penalty_win", `penalty:${sessionId}`);
      await firebaseDb.ref(`laligaBrains/penalties/results/${sessionId}`).transaction((current) => current ?? { uid, sessionId, goals: response!.goals, reward, settledAt: Date.now() });
    }
    return json(200, { shot: response.shot, goal: response.goal, completed, reward: reward ?? null, goals: response.goals, goalkeeper: latest.goalkeeper });
  }
  throw asBadRequest("La acción de penaltis no está disponible.");
});
