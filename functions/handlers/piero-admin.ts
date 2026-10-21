import { randomUUID } from "node:crypto";
import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requirePiero } from "../lib/authentication";
import { applyWalletDelta, mutateEconomy, type EconomyState } from "../lib/economy";
import { cancelSettledRound, settleRound, type MatchTarget } from "../lib/predictions";
import { asBadRequest, json, run, bodyOf, methodNotAllowed } from "../lib/http";
import type { MatchRecord, TeamId, TeamStats } from "../../src/types/domain";

type StoredMatch = MatchRecord & { dateKey?: string; ownershipSnapshot?: Record<string, string | null>; revision?: number };
interface MatchReward { id: string; uid: string; amount: number; idempotencyKey: string; matchId: string }
interface FootballAction {
  status: "pending" | "complete";
  action: string;
  actorUid: string;
  createdAt: number;
  completedAt?: number;
  result: { match: StoredMatch | null; before: StoredMatch | null; rewards: MatchReward[] };
}
interface FootballState { matches: Record<string, StoredMatch>; actions: Record<string, FootballAction>; audit: Record<string, unknown>; }

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const { user } = await requirePiero(event);
  const body = bodyOf(event);
  const action = String(body.action ?? "");
  let result: unknown;
  if (action === "createMatch" || action === "editMatch" || action === "deleteMatch") result = await manageMatch(action, body, user.uid);
  else if (action === "createGhostPlayer") result = await createGhostPlayer(body, user.uid);
  else if (action === "mergePlayer") result = await mergePlayer(body, user.uid);
  else if (action === "coinAdjust") result = await adjustCoins(body, user.uid);
  else if (action === "setEnhancedSecurity") result = await setEnhancedSecurity(body, user.uid);
  else if (action === "setPenaltyGameEnabled") result = await setPenaltyGameEnabled(body, user.uid);
  else if (action === "approveUser" || action === "rejectUser") result = await decideRegistration(action, body, user.uid);
  else if (action === "resetPassword") result = await resetPassword(body, user.uid);
  else if (action === "changeRole") result = await changeRole(body, user.uid);
  else if (action === "moderatePost") result = await moderatePost(body, user.uid);
  else if (action === "dismissReport") result = await dismissReport(body, user.uid);
  else if (action === "setPostingSuspension" || action === "setCommentSuspension" || action === "banUser" || action === "suspendUser") result = await moderateUser(action, body, user.uid);
  else if (action === "recommendationPriority") result = await recommendationPriority(body, user.uid);
  else throw asBadRequest("La acción administrativa no está disponible.");
  await firebaseDb.ref("laligaBrains/administration/auditLogs").push({ action, actorUid: user.uid, createdAt: Date.now(), targetId: String(body.uid ?? body.matchId ?? body.playerId ?? ""), summary: auditSummary(action, body) });
  return json(200, { result });
});

async function manageMatch(action: string, body: Record<string, unknown>, actorUid: string) {
  const idempotencyKey = String(body.idempotencyKey ?? "");
  if (!/^[a-f0-9-]{36}$/i.test(idempotencyKey)) throw asBadRequest("Falta la clave segura del cambio.");
  const stateRef = firebaseDb.ref("laligaBrains/football/state");
  if (!(await stateRef.get()).exists()) {
    const existing = (await firebaseDb.ref("laligaBrains/football/matches").get()).val() as Record<string, MatchRecord> | null;
    await stateRef.transaction((current) => current ?? { matches: existing ?? {}, actions: {}, audit: {} });
  }
  const matchId = action === "createMatch" ? randomUUID() : String(body.matchId ?? "");
  if (action !== "createMatch" && !matchId) throw asBadRequest("Indica el partido que quieres corregir.");
  const score3 = Number(body.score3ESO ?? 0);
  const score4 = Number(body.score4ESO ?? 0);
  const goalscorers = normalizeGoals(body.goalscorers4ESO);
  let goalscorerNames: Record<string, string> = {};
  const dateKey = String(body.date ?? "");
  const playedAt = dateKey ? localMadridEpoch(dateKey, 12) : Date.now();
  if (action !== "deleteMatch") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isFinite(playedAt)) throw asBadRequest("Indica una fecha válida para el partido.");
    if (!Number.isSafeInteger(score3) || score3 < 0 || score3 > 99 || !Number.isSafeInteger(score4) || score4 < 0 || score4 > 99) throw asBadRequest("Los goles deben ser números enteros entre 0 y 99.");
    if (Object.values(goalscorers).reduce((sum, count) => sum + count, 0) !== score4) throw asBadRequest("Asigna exactamente un goleador por cada gol de 4 ESO.");
    goalscorerNames = await validateScorers(goalscorers);
  }
  const key = `${action}:${idempotencyKey}`;
  const [oldMatchSnapshot, economySnapshot] = await Promise.all([
    action === "createMatch" ? Promise.resolve(null) : firebaseDb.ref(`laligaBrains/football/matches/${matchId}`).get(),
    firebaseDb.ref("laligaBrains/economy/state/fantasyPlayers").get(),
  ]);
  const previous = oldMatchSnapshot?.val() as StoredMatch | null;
  if (action !== "createMatch" && !previous) throw Object.assign(new Error("No se encontró el partido."), { statusCode: 404 });
  const ownerSnapshot = previous?.ownershipSnapshot ?? Object.fromEntries(Object.entries((economySnapshot.val() ?? {}) as Record<string, { ownerUid?: string }>).map(([id, player]) => [id, player.ownerUid ?? null]));
  const newRecord: MatchRecord & { dateKey: string; ownershipSnapshot: Record<string, string | null>; revision: number } = {
    id: matchId, playedAt, dateKey, score3ESO: score3, score4ESO: score4, goalscorers4ESO: goalscorers, goalscorerNames,
    createdAt: previous?.createdAt ?? Date.now(), createdBy: previous?.createdBy ?? actorUid,
    updatedAt: Date.now(), updatedBy: actorUid, ownershipSnapshot: ownerSnapshot, revision: Number(previous?.revision ?? 0) + 1,
  };
  let actionResult: { match: StoredMatch | null; before: StoredMatch | null; rewards: MatchReward[]; duplicate: boolean } | undefined;
  const tx = await stateRef.transaction((raw) => {
    const state = { matches: {}, actions: {}, audit: {}, ...(raw ?? {}) } as FootballState;
    const saved = state.actions[key];
    if (saved) { actionResult = { ...saved.result, rewards: saved.result.rewards ?? [], duplicate: true }; return state; }
    const before = state.matches[matchId] ?? null;
    if (action !== "createMatch" && !before) return;
    const next = action === "deleteMatch" ? null : newRecord;
    if (next) state.matches[matchId] = next;
    else delete state.matches[matchId];
    const rewards = rewardDeltas(before, next, key);
    const immutableAudit = { id: randomUUID(), actorUid, action, matchId, before, after: next, createdAt: Date.now(), idempotencyKey };
    state.audit[immutableAudit.id] = immutableAudit;
    const result = { match: next, before, rewards };
    state.actions[key] = { status: "pending", action, actorUid, createdAt: Date.now(), result };
    actionResult = { ...result, duplicate: false };
    return state;
  }, undefined, false);
  if (!tx.committed || !actionResult) throw Object.assign(new Error("No se pudo guardar el cambio del partido."), { statusCode: 409 });
  const actualMatchId = actionResult.match?.id ?? actionResult.before?.id ?? matchId;
  const stats = await processMatchAction(key);
  return { matchId: actualMatchId, deleted: !actionResult.match, duplicate: actionResult.duplicate, teamStats: stats };
}

async function processMatchAction(key: string) {
  const stateRef = firebaseDb.ref("laligaBrains/football/state");
  const stateSnapshot = await stateRef.get();
  const state = stateSnapshot.val() as FootballState | null;
  if (!state) throw new Error("No se encontró el estado de fútbol para reconciliar.");
  const operation = state?.actions?.[key];
  if (!operation) throw new Error("No se encontró la operación de partido pendiente.");
  const { match: currentMatch, before, rewards } = operation.result;
  const matchId = currentMatch?.id ?? before?.id;
  if (!matchId) throw new Error("La operación de partido no contiene un identificador.");
  const matches = state.matches;
  const stats = calculateTeamStats(Object.values(matches));
  const goalStats = calculatePlayerGoals(Object.values(matches));
  const profiles = (await firebaseDb.ref("laligaBrains/identity/playerProfiles").get()).val() as Record<string, Record<string, unknown>> | null;
  const playerStats = Object.fromEntries(Object.entries(goalStats).map(([playerId, info]) => [playerId, { ...info, ...(profiles?.[playerId] ?? {}) }]));
  const leaderboard = Object.fromEntries(Object.entries(goalStats).map(([playerId, info]) => [playerId, { totalGoals: info.totalGoals }]));
  const updates: Record<string, unknown> = {
    [`laligaBrains/football/matches/${matchId}`]: currentMatch,
    "laligaBrains/football/teamStats": stats,
    "laligaBrains/football/playerStats": playerStats,
    "laligaBrains/football/goalLeaderboard": leaderboard,
  };
  for (const reward of rewards) updates[`laligaBrains/football/pendingRewards/${reward.id}`] = reward;
  await firebaseDb.ref().update(updates);
  for (const reward of rewards) {
    await mutateEconomy((economy: EconomyState) => applyWalletDelta(economy, reward.uid, reward.amount, "fantasy_goal_adjustment", operation.actorUid, reward.idempotencyKey, matchId, reward.amount < 0));
    await firebaseDb.ref(`laligaBrains/football/pendingRewards/${reward.id}`).remove();
  }
  await recalculateMarketValues(Object.values(matches), goalStats, key);
  const targetDate = String(currentMatch?.dateKey ?? before?.dateKey ?? "");
  const previousDate = String(before?.dateKey ?? "");
  if (before && previousDate && (!currentMatch || previousDate !== targetDate)) await cancelSettledRound(previousDate, matchId);
  if (currentMatch && targetDate) await settleRound(targetDate, currentMatch as MatchTarget);
  if (operation.action === "createMatch" && currentMatch) await notifyMatchResult(matchId, currentMatch, operation.actorUid);
  await stateRef.child(`actions/${key}`).transaction((current) => current ? { ...current, status: "complete", completedAt: Date.now() } : current);
  return stats;
}

export async function reconcilePendingMatchActions() {
  const snapshot = await firebaseDb.ref("laligaBrains/football/state").get();
  const state = snapshot.val() as FootballState | null;
  const pending = Object.entries(state?.actions ?? {}).filter(([, action]) => action.status === "pending").slice(0, 20);
  for (const [key] of pending) await processMatchAction(key);
  return pending.length;
}

async function notifyMatchResult(matchId: string, match: StoredMatch, actorUid: string) {
  const users = await firebaseDb.ref("laligaBrains/identity/users").orderByChild("accountStatus").equalTo("active").limitToFirst(500).get();
  const date = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" }).format(match.playedAt);
  const updates: Record<string, unknown> = {};
  users.forEach((user) => {
    if (!user.key) return;
    updates[`laligaBrains/notifications/${user.key}/match-${matchId}`] = { type: "match_result", matchId, read: false, createdAt: Date.now(), title: "Nuevo resultado", message: `3 ESO ${match.score3ESO} — ${match.score4ESO} 4 ESO · ${date}`, actorUid };
  });
  if (Object.keys(updates).length) await firebaseDb.ref().update(updates);
}

function normalizeGoals(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const count = Number(raw);
    if (!/^[a-zA-Z0-9_-]{3,128}$/.test(id) || !Number.isSafeInteger(count) || count <= 0) throw asBadRequest("La lista de goleadores no es válida.");
    result[id] = count;
  }
  return result;
}

async function validateScorers(goals: Record<string, number>) {
  const profiles = await firebaseDb.ref("laligaBrains/identity/playerProfiles").get();
  const profileMap = profiles.val() as Record<string, { team?: TeamId; name?: string }> | null;
  const names: Record<string, string> = {};
  for (const playerId of Object.keys(goals)) {
    const player = profileMap?.[playerId];
    if (!player || player.team !== "4ESO") throw asBadRequest("Solo pueden marcar jugadores registrados o fantasmas de 4 ESO.");
    names[playerId] = String(player.name ?? "Jugador");
  }
  return names;
}

function calculateTeamStats(matches: MatchRecord[]) {
  const result = (team: "3ESO" | "4ESO"): TeamStats => {
    const stats: TeamStats = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, streak: "—", recentResults: [] };
    const ordered = [...matches].sort((a, b) => a.playedAt - b.playedAt || a.id.localeCompare(b.id));
    const results: Array<"W" | "D" | "L"> = [];
    for (const match of ordered) {
      const gf = team === "3ESO" ? match.score3ESO : match.score4ESO;
      const ga = team === "3ESO" ? match.score4ESO : match.score3ESO;
      stats.played++; stats.goalsFor += gf; stats.goalsAgainst += ga;
      if (gf > ga) { stats.wins++; stats.points += 3; results.push("W"); }
      else if (gf === ga) { stats.draws++; stats.points++; results.push("D"); }
      else { stats.losses++; results.push("L"); }
    }
    stats.goalDifference = stats.goalsFor - stats.goalsAgainst;
    stats.recentResults = results.slice(-5).reverse();
    if (results.length) { let count = 0; const last = results.at(-1)!; for (let i=results.length-1;i>=0&&results[i]===last;i--) count++; stats.streak = `${last}${count}`; }
    return stats;
  };
  return { "3ESO": result("3ESO"), "4ESO": result("4ESO") };
}

function calculatePlayerGoals(matches: MatchRecord[]) {
  const result: Record<string, { totalGoals: number; goalsByMatch: Record<string, number>; recentGoals: number }> = {};
  const ordered = [...matches].sort((a, b) => a.playedAt - b.playedAt || a.id.localeCompare(b.id));
  for (const match of ordered) for (const [playerId, goals] of Object.entries(match.goalscorers4ESO ?? {})) {
    result[playerId] ??= { totalGoals: 0, goalsByMatch: {}, recentGoals: 0 };
    result[playerId]!.totalGoals += Number(goals);
    result[playerId]!.goalsByMatch[match.id] = Number(goals);
  }
  for (const info of Object.values(result)) info.recentGoals = Object.values(info.goalsByMatch).slice(-5).reduce((sum, goals) => sum + Number(goals), 0);
  return result;
}

function rewardDeltas(before: MatchRecord | null, after: MatchRecord | null, actionKey: string) {
  const ids = new Set([...Object.keys(before?.goalscorers4ESO ?? {}), ...Object.keys(after?.goalscorers4ESO ?? {})]);
  const result: Array<{ id: string; uid: string; amount: number; idempotencyKey: string; matchId: string }> = [];
  for (const playerId of ids) {
    const delta = (Number(after?.goalscorers4ESO?.[playerId] ?? 0) - Number(before?.goalscorers4ESO?.[playerId] ?? 0)) * 10;
    const snapshot = (before as (MatchRecord & { ownershipSnapshot?: Record<string, string | null> }) | null)?.ownershipSnapshot ?? (after as (MatchRecord & { ownershipSnapshot?: Record<string, string | null> }) | null)?.ownershipSnapshot;
    const uid = snapshot?.[playerId];
    if (delta && uid) result.push({ id: randomUUID(), uid, amount: delta, idempotencyKey: `match-reward:${actionKey}:${playerId}`, matchId: after?.id ?? before!.id });
  }
  return result;
}

async function createGhostPlayer(body: Record<string, unknown>, actorUid: string) {
  const name = String(body.name ?? "").trim();
  if (!name || name.length > 60) throw asBadRequest("Indica un nombre de jugador válido.");
  const id = randomUUID();
  const now = Date.now();
  const profile = { id, name, team: "4ESO", ghost: true, createdAt: now, createdBy: actorUid };
  await firebaseDb.ref().update({
    [`laligaBrains/identity/playerProfiles/${id}`]: profile,
    [`laligaBrains/identity/ghostPlayers/${id}`]: profile,
  });
  await mutateEconomy((state) => { state.fantasyPlayers[id] ??= { id, name, value: 50, permanentInvestment: 0, ownerUid: null, ghost: true, createdAt: now }; return true; });
  return { playerId: id, value: 50 };
}

async function mergePlayer(body: Record<string, unknown>, actorUid: string) {
  const playerId = String(body.playerId ?? "");
  const uid = String(body.uid ?? "");
  const [ghostSnapshot, userSnapshot] = await Promise.all([
    firebaseDb.ref(`laligaBrains/identity/playerProfiles/${playerId}`).get(),
    firebaseDb.ref(`laligaBrains/identity/users/${uid}`).get(),
  ]);
  const ghost = ghostSnapshot.val() as { team?: string; uid?: string; name?: string; ghost?: boolean } | null;
  const user = userSnapshot.val() as { role?: string; playerId?: string } | null;
  if (!ghost?.ghost || ghost.team !== "4ESO" || user?.role !== "player_4eso") throw asBadRequest("El perfil y la cuenta no se pueden combinar.");
  if (user.playerId && user.playerId !== playerId) throw Object.assign(new Error("La cuenta ya está asociada a otro perfil de jugador."), { statusCode: 409 });
  const updates: Record<string, unknown> = {
    [`laligaBrains/identity/playerProfiles/${playerId}/uid`]: uid,
    [`laligaBrains/identity/playerProfiles/${playerId}/ghost`]: false,
    [`laligaBrains/identity/playerProfiles/${playerId}/mergedAt`]: Date.now(),
    [`laligaBrains/identity/playerProfiles/${playerId}/mergedBy`]: actorUid,
    [`laligaBrains/identity/users/${uid}/playerId`]: playerId,
  };
  await firebaseDb.ref().update(updates);
  await mutateEconomy((state) => { if (state.fantasyPlayers[playerId]) { state.fantasyPlayers[playerId]!.ghost = false; state.fantasyPlayers[playerId]!.uid = uid; } return true; });
  return { playerId, uid };
}

async function recalculateMarketValues(matches: MatchRecord[], goalStats: Record<string, { totalGoals: number; goalsByMatch: Record<string, number> }>, revisionKey: string) {
  const ordered = [...matches].sort((a, b) => a.playedAt - b.playedAt || a.id.localeCompare(b.id));
  await mutateEconomy((state) => {
    for (const [playerId, player] of Object.entries(state.fantasyPlayers)) {
      const totalGoals = Number(goalStats[playerId]?.totalGoals ?? 0);
      const recentGoals = ordered.slice(-5).reduce((sum, match) => sum + Number(match.goalscorers4ESO?.[playerId] ?? 0), 0);
      const sampleWeight = Math.min(1, ordered.length / 8);
      const permanentInvestment = Number(player.permanentInvestment ?? 0);
      const value = Math.max(50 + permanentInvestment, Math.round(50 + sampleWeight * (totalGoals * 4 + recentGoals * 7)) + permanentInvestment);
      const oldValue = Number(player.value ?? 50);
      if (value === oldValue) continue;
      player.value = value;
      player.performanceValue = value - permanentInvestment;
      player.updatedAt = Date.now();
      state.valuationHistory[playerId] ??= {};
      state.valuationHistory[playerId]![revisionKey] = { previousValue: oldValue, value, totalGoals, recentGoals, matchesPlayed: ordered.length, permanentInvestment, updatedAt: Date.now() };
    }
    return true;
  });
}

async function adjustCoins(body: Record<string, unknown>, actorUid: string) {
  const uid = String(body.uid ?? "");
  const amount = Number(body.amount);
  const reason = String(body.reason ?? "").trim();
  if (!uid || !Number.isSafeInteger(amount) || amount === 0 || !reason || reason.length > 300) throw asBadRequest("Indica usuario, importe entero y motivo.");
  const result = await mutateEconomy((state) => {
    const previousBalance = state.wallets[uid] ?? 0;
    const adjustment = applyWalletDelta(state, uid, amount, "piero_adjustment", actorUid, `piero-adjust:${randomUUID()}`, undefined, true);
    return { ...adjustment, previousBalance, updatedBalance: adjustment.balance };
  });
  await firebaseDb.ref("laligaBrains/administration/coinAdjustments").push({ actorUid, uid, amount, reason, previousBalance: result.previousBalance, updatedBalance: result.updatedBalance, createdAt: Date.now() });
  return result;
}

async function setEnhancedSecurity(body: Record<string, unknown>, actorUid: string) {
  if (typeof body.enabled !== "boolean") throw asBadRequest("Indica si Seguridad mejorada debe estar activa.");
  await firebaseDb.ref("laligaBrains/config/siteSettings/enhancedSecurity").set(body.enabled);
  return { enabled: body.enabled, updatedBy: actorUid };
}

async function setPenaltyGameEnabled(body: Record<string, unknown>, actorUid: string) {
  if (typeof body.enabled !== "boolean") throw asBadRequest("Indica si el minijuego de penaltis debe estar activo.");
  await firebaseDb.ref("laligaBrains/config/siteSettings/penaltyGameEnabled").set(body.enabled);
  return { enabled: body.enabled, updatedBy: actorUid };
}

async function decideRegistration(action: string, body: Record<string, unknown>, actorUid: string) {
  const uid = String(body.uid ?? "");
  const userRef = firebaseDb.ref(`laligaBrains/identity/users/${uid}`);
  const profile = (await userRef.get()).val() as { username?: string; role?: string; accountStatus?: string } | null;
  if (!profile || profile.accountStatus !== "pending_approval" || !["player_3eso", "player_4eso"].includes(String(profile.role))) throw asBadRequest("No hay una solicitud pendiente para esta cuenta.");
  const approve = action === "approveUser";
  await userRef.update({ accountStatus: approve ? "active" : "rejected", reviewedAt: Date.now(), reviewedBy: actorUid });
  await firebaseDb.ref(`laligaBrains/identity/registrationApprovals/${uid}`).update({ status: approve ? "approved" : "rejected", reviewedAt: Date.now(), reviewedBy: actorUid });
  if (approve) {
    if (profile.role === "player_4eso") await ensureRegisteredPlayer(uid, profile.username ?? "Jugador");
    await mutateEconomy((state) => applyWalletDelta(state, uid, 100, "registration_bonus", null, `registration:${uid}`));
    await firebaseDb.ref(`laligaBrains/notifications/${uid}`).push({ type: "account_approved", read: false, createdAt: Date.now() });
  }
  return { uid, status: approve ? "active" : "rejected" };
}

async function resetPassword(body: Record<string, unknown>, actorUid: string) {
  void body;
  void actorUid;
  throw Object.assign(new Error("El cambio de contraseña de otra cuenta debe hacerse desde Firebase Authentication."), { statusCode: 501 });
}

async function changeRole(body: Record<string, unknown>, actorUid: string) {
  const uid = String(body.uid ?? "");
  const role = String(body.role ?? "");
  if (!uid || !["player_3eso", "player_4eso", "spectator"].includes(role)) throw asBadRequest("La clasificación de usuario no es válida.");
  const userRef = firebaseDb.ref(`laligaBrains/identity/users/${uid}`);
  const user = (await userRef.get()).val() as { playerId?: string; username?: string } | null;
  if (!user) throw asBadRequest("No se encontró la cuenta.");
  await userRef.update({ role, updatedAt: Date.now(), updatedBy: actorUid });
  if (role === "player_4eso") await ensureRegisteredPlayer(uid, user.username ?? "Jugador", user.playerId);
  return { uid, role };
}

async function moderatePost(body: Record<string, unknown>, actorUid: string) {
  const postId = String(body.postId ?? "");
  const action = String(body.moderationAction ?? "");
  if (!postId || !["delete", "restore"].includes(action)) throw asBadRequest("La acción de moderación no es válida.");
  const postRef = firebaseDb.ref(`laligaBrains/social/posts/${postId}`);
  const post = await postRef.get();
  if (!post.exists()) throw asBadRequest("No se encontró la publicación.");
  if (action === "delete") {
    await firebaseDb.ref(`laligaBrains/administration/moderation/hiddenContent/posts/${postId}`).set({ ...post.val(), status: "hidden", moderatedAt: Date.now(), moderatedBy: actorUid });
    await firebaseDb.ref(`laligaBrains/social/posts/${postId}`).remove();
    const comments = await firebaseDb.ref(`laligaBrains/social/comments/${postId}`).get();
    if (comments.exists()) {
      await firebaseDb.ref(`laligaBrains/administration/moderation/hiddenContent/comments/${postId}`).set(comments.val());
      const updates: Record<string, null> = { [`laligaBrains/social/comments/${postId}`]: null };
      comments.forEach((comment) => { if (comment.key && comment.child("authorUid").val()) updates[`laligaBrains/social/commentsByUser/${String(comment.child("authorUid").val())}/${postId}/${comment.key}`] = null; });
      await firebaseDb.ref().update(updates);
    }
  } else {
    const archived = await firebaseDb.ref(`laligaBrains/administration/moderation/hiddenContent/posts/${postId}`).get();
    if (!archived.exists()) throw asBadRequest("No hay contenido archivado para restaurar.");
    await firebaseDb.ref(`laligaBrains/social/posts/${postId}`).set({ ...archived.val(), status: "published", moderatedAt: Date.now(), moderatedBy: actorUid });
    await firebaseDb.ref(`laligaBrains/administration/moderation/hiddenContent/posts/${postId}`).remove();
  }
  return { postId, status: action === "delete" ? "deleted" : "published" };
}

async function recommendationPriority(body: Record<string, unknown>, actorUid: string) {
  const uid = String(body.uid ?? "");
  const priority = String(body.priority ?? "");
  if (!uid || !["low", "normal", "high"].includes(priority)) throw asBadRequest("La prioridad de recomendación no es válida.");
  await firebaseDb.ref(`laligaBrains/identity/users/${uid}/recommendationPriority`).set(priority);
  const posts = await firebaseDb.ref("laligaBrains/social/posts").orderByChild("authorUid").equalTo(uid).get();
  const updates: Record<string, unknown> = {};
  posts.forEach((post) => { updates[`laligaBrains/social/posts/${post.key}/recommendationPriority`] = priority; });
  if (Object.keys(updates).length) await firebaseDb.ref().update(updates);
  return { uid, priority, updatedBy: actorUid };
}

async function dismissReport(body: Record<string, unknown>, actorUid: string) {
  const reportId = String(body.reportId ?? "");
  if (!reportId) throw asBadRequest("Indica el informe que quieres descartar.");
  const reportRef = firebaseDb.ref(`laligaBrains/social/reports/${reportId}`);
  if (!(await reportRef.get()).exists()) throw asBadRequest("No se encontró el informe.");
  await reportRef.update({ status: "dismissed", reviewedAt: Date.now(), reviewedBy: actorUid });
  return { reportId, status: "dismissed" };
}

async function moderateUser(action: string, body: Record<string, unknown>, actorUid: string) {
  const uid = String(body.uid ?? "");
  if (!uid || uid === actorUid) throw asBadRequest("No se puede aplicar esta acción a esa cuenta.");
  const userRef = firebaseDb.ref(`laligaBrains/identity/users/${uid}`);
  const now = Date.now();
  if (action === "banUser") {
    const user = (await userRef.get()).val() as { accountStatus?: string } | null;
    if (!user) throw asBadRequest("No se encontró la cuenta.");
    await userRef.update({ accountStatus: "banned", bannedAt: now, bannedBy: actorUid, banReason: String(body.reason ?? "") });
    await hideUserSocialContent(uid, actorUid);
    return { uid, accountStatus: "banned" };
  }
  if (action === "suspendUser") {
    const active = body.suspended === false;
    await userRef.update({ accountStatus: active ? "active" : "suspended", updatedAt: now, updatedBy: actorUid });
    return { uid, accountStatus: active ? "active" : "suspended" };
  }
  const field = action === "setPostingSuspension" ? "postingSuspendedUntil" : "commentingSuspendedUntil";
  const until = Number(body.until ?? 0);
  if (!Number.isSafeInteger(until) || until < 0) throw asBadRequest("La fecha de suspensión no es válida.");
  await userRef.child(`restrictions/${field}`).set(until || null);
  return { uid, [field]: until };
}

async function ensureRegisteredPlayer(uid: string, username: string, existingId?: string) {
  const playerId = existingId ?? randomUUID();
  const profileRef = firebaseDb.ref(`laligaBrains/identity/playerProfiles/${playerId}`);
  if (!(await profileRef.get()).exists()) {
    const now = Date.now();
    await firebaseDb.ref().update({
      [`laligaBrains/identity/playerProfiles/${playerId}`]: { id: playerId, uid, name: username, team: "4ESO", ghost: false, createdAt: now },
      [`laligaBrains/football/playerStats/${playerId}`]: { totalGoals: 0, goalsByMatch: {} },
      [`laligaBrains/identity/users/${uid}/playerId`]: playerId,
    });
  }
  await mutateEconomy((state) => { state.fantasyPlayers[playerId] ??= { id: playerId, uid, name: username, value: 50, permanentInvestment: 0, ownerUid: null, ghost: false, createdAt: Date.now() }; return true; });
  return playerId;
}

async function hideUserSocialContent(uid: string, actorUid: string) {
  const posts = await firebaseDb.ref("laligaBrains/social/posts").orderByChild("authorUid").equalTo(uid).get();
  const updates: Record<string, unknown> = {};
  posts.forEach((post) => {
    updates[`laligaBrains/administration/moderation/hiddenContent/posts/${post.key}`] = { ...post.val(), status: "hidden", hiddenAt: Date.now(), hiddenBy: actorUid };
    updates[`laligaBrains/social/posts/${post.key}`] = null;
  });
  const commentIndex = (await firebaseDb.ref(`laligaBrains/social/commentsByUser/${uid}`).get()).val() as Record<string, Record<string, boolean>> | null;
  for (const [postId, indexedIds] of Object.entries(commentIndex ?? {})) {
    const comments = await Promise.all(Object.keys(indexedIds).map(async (commentId) => [commentId, await firebaseDb.ref(`laligaBrains/social/comments/${postId}/${commentId}`).get()] as const));
    for (const [commentId, snapshot] of comments) {
      const comment = snapshot.val() as Record<string, unknown> | null;
      if (!comment || comment.authorUid !== uid) continue;
      updates[`laligaBrains/administration/moderation/hiddenContent/comments/${postId}/${commentId}`] = { ...comment, status: "hidden", hiddenAt: Date.now(), hiddenBy: actorUid };
      updates[`laligaBrains/social/comments/${postId}/${commentId}`] = null;
      updates[`laligaBrains/social/commentsByUser/${uid}/${postId}/${commentId}`] = null;
    }
  }
  if (Object.keys(updates).length) await firebaseDb.ref().update(updates);
}

function localMadridEpoch(dateKey: string, hour: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return Number.NaN;
  let timestamp = Date.parse(`${dateKey}T${String(hour).padStart(2, "0")}:00:00Z`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(timestamp);
    timestamp += (hour - Number(parts.find((part) => part.type === "hour")?.value ?? 0)) * 60 * 60 * 1000;
  }
  return timestamp;
}

function auditSummary(action: string, body: Record<string, unknown>) {
  if (action === "coinAdjust") return `Ajuste de ${String(body.amount)} monedas.`;
  if (action === "createMatch" || action === "editMatch") return `Resultado ${String(body.score3ESO)}–${String(body.score4ESO)}.`;
  if (action === "setEnhancedSecurity") return `Seguridad mejorada: ${String(body.enabled)}.`;
  return "Acción administrativa registrada.";
}
