import type { Handler } from "../lib/runtime-types";
import type { DataSnapshot } from "../lib/firebase-rest";
import { firebaseDb } from "../lib/firebase-rest";
import { requirePiero } from "../lib/authentication";
import { json, run, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const { user } = await requirePiero(event);
  const [users, approvals, matches, reports, ledgers, transfers, rounds, players, fantasyPlayers, settings] = await Promise.all([
    firebaseDb.ref("laligaBrains/identity/users").orderByChild("createdAt").limitToLast(100).get(),
    firebaseDb.ref("laligaBrains/identity/registrationApprovals").orderByChild("createdAt").limitToLast(100).get(),
    firebaseDb.ref("laligaBrains/football/matches").orderByChild("playedAt").limitToLast(20).get(),
    firebaseDb.ref("laligaBrains/social/reports").orderByChild("createdAt").limitToLast(50).get(),
    firebaseDb.ref("laligaBrains/economy/ledgerIndex").orderByChild("createdAt").limitToLast(30).get(),
    firebaseDb.ref("laligaBrains/fantasy/transfers").orderByChild("createdAt").limitToLast(20).get(),
    firebaseDb.ref("laligaBrains/predictions/rounds").orderByKey().limitToLast(10).get(),
    firebaseDb.ref("laligaBrains/identity/playerProfiles").get(),
    firebaseDb.ref("laligaBrains/fantasy/players").get(),
    firebaseDb.ref("laligaBrains/config/siteSettings").get(),
  ]);
  const mapRows = (snapshot: DataSnapshot): Array<Record<string, unknown> & { id: string }> => Object.entries((snapshot.val() ?? {}) as Record<string, Record<string, unknown>>).map(([id, value]) => ({ id, ...value }));
  const people = mapRows(users).map((item) => ({ uid: item.id, username: item.username, role: item.role, accountStatus: item.accountStatus, createdAt: item.createdAt, displayName: item.displayName, recommendationPriority: item.recommendationPriority }));
  return json(200, {
    adminUid: user.uid,
    users: people,
    pendingApprovals: mapRows(approvals).filter((item) => item.status === "pending"),
    matches: mapRows(matches).sort((a,b)=>Number(b.playedAt)-Number(a.playedAt)),
    reports: mapRows(reports).filter((item) => item.status === "open"),
    recentCoinActivity: mapRows(ledgers).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt)),
    recentFantasyTransfers: mapRows(transfers).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt)),
    predictionStatuses: mapRows(rounds).sort((a,b)=>String(b.dateKey).localeCompare(String(a.dateKey))),
    players: mapRows(players),
    fantasyPlayers: mapRows(fantasyPlayers),
    enhancedSecurity: Boolean((settings.val() as { enhancedSecurity?: boolean } | null)?.enhancedSecurity),
    penaltyGameEnabled: Boolean((settings.val() as { penaltyGameEnabled?: boolean } | null)?.penaltyGameEnabled),
  });
});
