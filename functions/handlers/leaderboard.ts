import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { json, run, methodNotAllowed } from "../lib/http";

const indexes = {
  goalLeaderboard: { path: "laligaBrains/football/goalLeaderboard", orderBy: "totalGoals" },
  richest: { path: "laligaBrains/leaderboards/richest", orderBy: "balance" },
  predictors: { path: "laligaBrains/leaderboards/predictors", orderBy: "correct" },
  popular: { path: "laligaBrains/leaderboards/popular", orderBy: "likes" },
} as const;

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  await requireUser(event);
  const kind = event.queryStringParameters?.kind ?? "goalLeaderboard";
  if (!(kind in indexes)) return json(400, { error: "Clasificación no disponible." });
  const index = indexes[kind as keyof typeof indexes];
  const snapshot = await firebaseDb.ref(index.path).orderByChild(index.orderBy).limitToLast(50).get();
  const raw = snapshot.val() as Record<string, Record<string, unknown>> | null;
  const items = await Promise.all(Object.entries(raw ?? {}).map(async ([id, value]) => {
    if (kind === "goalLeaderboard") {
      const profile = (await firebaseDb.ref(`laligaBrains/identity/playerProfiles/${id}`).get()).val() as { name?: string } | null;
      if (!profile) return null;
      return { uid: id, name: String(profile.name ?? "Jugador"), value: Number(value.totalGoals ?? 0) };
    }
    const profile = (await firebaseDb.ref(`laligaBrains/identity/users/${id}`).get()).val() as { displayName?: string; username?: string; accountStatus?: string } | null;
    if (!profile || profile.accountStatus !== "active") return null;
    const scoreField = kind === "richest" ? "balance" : kind === "predictors" ? "correct" : "likes";
    return { uid: id, name: String(profile.displayName ?? profile.username ?? "Usuario"), value: Number(value[scoreField] ?? 0) };
  }));
  const ranked = items.filter((item): item is NonNullable<typeof item> => Boolean(item));
  ranked.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "es") || a.uid.localeCompare(b.uid));
  return json(200, { items: ranked.slice(0, 50) });
});
