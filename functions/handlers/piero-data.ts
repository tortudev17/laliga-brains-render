import type { Handler } from "../lib/runtime-types";
import type { DataSnapshot } from "../lib/firebase-rest";
import { firebaseDb } from "../lib/firebase-rest";
import { requirePiero } from "../lib/authentication";
import { json, run, methodNotAllowed } from "../lib/http";
import { reconcilePendingMatchActions } from "./piero-admin";

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const { user } = await requirePiero(event);
  // Finish any match transaction left pending by an interrupted request before reading its public projections.
  await reconcilePendingMatchActions();
  const [users, approvals, matches, ledgers, transfers, players, fantasyPlayers, fantasyOffers, settings, manualGoalAdjustments, wallets] = await Promise.all([
    firebaseDb.ref("laligaBrains/identity/users").get(),
    firebaseDb.ref("laligaBrains/identity/registrationApprovals").orderByChild("createdAt").limitToLast(100).get(),
    firebaseDb.ref("laligaBrains/football/matches").orderByChild("playedAt").limitToLast(20).get(),
    firebaseDb.ref("laligaBrains/economy/ledgerIndex").orderByChild("createdAt").limitToLast(30).get(),
    firebaseDb.ref("laligaBrains/fantasy/transfers").orderByChild("createdAt").limitToLast(20).get(),
    firebaseDb.ref("laligaBrains/identity/playerProfiles").get(),
    firebaseDb.ref("laligaBrains/economy/state/fantasyPlayers").get(),
    firebaseDb.ref("laligaBrains/fantasy/offers").orderByChild("createdAt").limitToLast(50).get(),
    firebaseDb.ref("laligaBrains/config/siteSettings").get(),
    firebaseDb.ref("laligaBrains/football/state/manualGoalAdjustments").get(),
    firebaseDb.ref("laligaBrains/economy/state/wallets").get(),
  ]);
  const mapRows = (snapshot: DataSnapshot): Array<Record<string, unknown> & { id: string }> => Object.entries((snapshot.val() ?? {}) as Record<string, Record<string, unknown>>).map(([id, value]) => ({ id, ...value }));
  const walletBalances = (wallets.val() ?? {}) as Record<string, number>;
  const fantasyPlayerRows = mapRows(fantasyPlayers).filter((item) => item.archived !== true);
  const assetValues = new Map<string, number>();
  for (const player of fantasyPlayerRows) {
    if (typeof player.ownerUid !== "string") continue;
    const value = Number(player.value ?? 50);
    if (Number.isSafeInteger(value) && value > 0) assetValues.set(player.ownerUid, (assetValues.get(player.ownerUid) ?? 0) + value);
  }
  const people = mapRows(users).map((item) => {
    const walletBalance = Number(walletBalances[item.id] ?? 0);
    const assetValue = assetValues.get(item.id) ?? 0;
    return { uid: item.id, username: item.username, role: item.role, accountStatus: item.accountStatus, createdAt: item.createdAt, displayName: item.displayName, recommendationPriority: item.recommendationPriority, walletBalance, assetValue, netWorth: walletBalance + assetValue };
  }).sort((a, b) => String(a.username).localeCompare(String(b.username), "es-ES"));
  const fantasyOfferRows = mapRows(fantasyOffers).sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  const fantasyUserIds = new Set<string>();
  for (const player of fantasyPlayerRows) if (typeof player.ownerUid === "string") fantasyUserIds.add(player.ownerUid);
  for (const offer of fantasyOfferRows) {
    if (typeof offer.creatorUid === "string") fantasyUserIds.add(offer.creatorUid);
    if (typeof offer.recipientUid === "string") fantasyUserIds.add(offer.recipientUid);
  }
  const peopleByUid = new Map(people.map((person) => [String(person.uid), person]));
  const missingFantasyProfileIds = [...fantasyUserIds].filter((uid) => !peopleByUid.has(uid));
  const fantasyProfileRows = await Promise.all(missingFantasyProfileIds.map(async (uid) => [uid, (await firebaseDb.ref(`laligaBrains/identity/users/${uid}`).get()).val() as { username?: string; displayName?: string } | null] as const));
  const fantasyProfiles = new Map(fantasyProfileRows);
  const managerLabel = (uid: unknown) => {
    const profile = typeof uid === "string" ? fantasyProfiles.get(uid) ?? peopleByUid.get(uid) : null;
    return { name: String(profile?.displayName ?? profile?.username ?? "Mánager"), username: String(profile?.username ?? "") };
  };
  const fantasyPlayersWithOwners = fantasyPlayerRows.map((player) => ({
    ...player,
    ...(typeof player.ownerUid === "string" ? { ownerName: managerLabel(player.ownerUid).name, ownerUsername: managerLabel(player.ownerUid).username } : {}),
  }));
  const fantasyOffersWithNames = fantasyOfferRows.map((offer) => ({
    ...offer,
    creatorName: managerLabel(offer.creatorUid).name,
    creatorUsername: managerLabel(offer.creatorUid).username,
    recipientName: managerLabel(offer.recipientUid).name,
    recipientUsername: managerLabel(offer.recipientUid).username,
  }));
  return json(200, {
    adminUid: user.uid,
    users: people,
    pendingApprovals: mapRows(approvals).filter((item) => item.status === "pending"),
    matches: mapRows(matches).sort((a,b)=>Number(b.playedAt)-Number(a.playedAt)),
    recentCoinActivity: mapRows(ledgers).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt)),
    recentFantasyTransfers: mapRows(transfers).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt)),
    manualGoalAdjustments: mapRows(manualGoalAdjustments).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt)).slice(0,30),
    players: mapRows(players).filter((item) => item.archived !== true),
    archivedPlayers: mapRows(players).filter((item) => item.archived === true),
    fantasyPlayers: fantasyPlayersWithOwners,
    fantasyOffers: fantasyOffersWithNames,
    enhancedSecurity: Boolean((settings.val() as { enhancedSecurity?: boolean } | null)?.enhancedSecurity),
  });
});
