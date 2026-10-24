import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { json, run, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  await requireUser(event);
  const playerId = event.queryStringParameters?.id ?? "";
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(playerId)) return json(400, { error: "Jugador no válido." });
  const [profileSnapshot, statsSnapshot, fantasySnapshot, leaderboardSnapshot] = await Promise.all([
    firebaseDb.ref(`laligaBrains/identity/playerProfiles/${playerId}`).get(),
    firebaseDb.ref(`laligaBrains/football/playerStats/${playerId}`).get(),
    firebaseDb.ref(`laligaBrains/fantasy/players/${playerId}`).get(),
    firebaseDb.ref("laligaBrains/football/goalLeaderboard").orderByChild("totalGoals").limitToLast(50).get(),
  ]);
  if (!profileSnapshot.exists()) return json(404, { error: "No se encontró el perfil del jugador." });
  const profile = profileSnapshot.val() as { name?: string; uid?: string; team?: string; ghost?: boolean; unknown?: boolean; archived?: boolean };
  if (profile.archived) return json(404, { error: "No se encontró el perfil del jugador." });
  const stats = statsSnapshot.val() as { totalGoals?: number; manualGoals?: number; goalsByMatch?: Record<string, number> } | null;
  const fantasy = fantasySnapshot.val() as { value?: number; ownerUid?: string; permanentInvestment?: number; performanceValue?: number } | null;
  const entries = Object.entries(stats?.goalsByMatch ?? {}).slice(-30).reverse();
  const matches = await Promise.all(entries.map(async ([matchId, goals]) => {
    const match = (await firebaseDb.ref(`laligaBrains/football/matches/${matchId}`).get()).val() as { playedAt?: number; score3ESO?: number; score4ESO?: number } | null;
    return match ? { matchId, goals: Number(goals), playedAt: Number(match.playedAt ?? 0), score3ESO: Number(match.score3ESO ?? 0), score4ESO: Number(match.score4ESO ?? 0) } : null;
  }));
  const leaderboard = leaderboardSnapshot.val() as Record<string, { totalGoals?: number }> | null;
  const ranked = Object.entries(leaderboard ?? {}).sort((a, b) => Number(b[1].totalGoals ?? 0) - Number(a[1].totalGoals ?? 0) || a[0].localeCompare(b[0]));
  const goalRank = ranked.findIndex(([id]) => id === playerId);
  let ownerName: string | null = null;
  if (fantasy?.ownerUid) {
    const owner = (await firebaseDb.ref(`laligaBrains/identity/users/${fantasy.ownerUid}`).get()).val() as { displayName?: string; username?: string; accountStatus?: string } | null;
    if (owner?.accountStatus === "active") ownerName = owner.displayName ?? owner.username ?? null;
  }
  return json(200, {
    player: { id: playerId, name: profile.name ?? "Jugador", ghost: Boolean(profile.ghost), unknown: Boolean(profile.unknown), team: profile.team ?? "4ESO", totalGoals: Number(stats?.totalGoals ?? 0), manualGoals: Number(stats?.manualGoals ?? 0), rank: goalRank < 0 ? null : goalRank + 1,
      fantasy: fantasy ? { value: Number(fantasy.value ?? 50), permanentInvestment: Number(fantasy.permanentInvestment ?? 0), performanceValue: Number(fantasy.performanceValue ?? 50), ownerName } : null,
      matchContributions: matches.filter((match): match is NonNullable<typeof match> => Boolean(match)).sort((a, b) => b.playedAt - a.playedAt),
    },
  });
});
