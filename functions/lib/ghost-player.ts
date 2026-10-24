export interface GhostArchiveProfile {
  team?: string;
  ghost?: boolean;
  uid?: string;
  unknown?: boolean;
}

export interface GhostArchiveFantasyPlayer {
  ownerUid?: string | null;
  permanentInvestment?: number;
}

export interface HistoricalGoalMatch {
  id: string;
  goalscorers4ESO?: Record<string, number>;
  goalscorerNames?: Record<string, string>;
}

export function accountPlayerMergeBlockReason(input: {
  accountUid: string;
  sourcePlayerId: string;
  targetPlayerId: string;
  sourceProfile: { uid?: string; team?: string; ghost?: boolean } | null;
  sourceFantasyPlayer: GhostArchiveFantasyPlayer | null;
  targetFantasyPlayer?: GhostArchiveFantasyPlayer | null;
  matches: HistoricalGoalMatch[];
  manualAdjustments: Array<{ playerId: string; amount: number }>;
  offers: Array<{ playerId: string; status: string }>;
}) {
  const { accountUid, sourcePlayerId, targetPlayerId, sourceProfile, sourceFantasyPlayer, targetFantasyPlayer } = input;
  if (sourcePlayerId === targetPlayerId) return null;
  if (sourceProfile && (sourceProfile.team !== "4ESO" || (sourceProfile.uid && sourceProfile.uid !== accountUid))) return "Ese perfil ya está vinculado a otra cuenta o no es de 4 ESO.";
  if (sourceFantasyPlayer?.ownerUid && targetFantasyPlayer?.ownerUid && sourceFantasyPlayer.ownerUid !== targetFantasyPlayer.ownerUid) {
    return "Los dos perfiles tienen mánagers Fantasy distintos. Libera uno de los activos antes de unirlos.";
  }
  return null;
}

export function remapDeletedGhostGoals<TAdjustment extends { playerId: string; playerName: string }>(
  matches: HistoricalGoalMatch[],
  adjustments: TAdjustment[],
  playerId: string,
  unknownPlayerId = "unknown_4eso",
  unknownPlayerName = "Desconocido",
) {
  let goalsMoved = 0;
  const nextMatches = matches.map((match) => {
    const goals = Number(match.goalscorers4ESO?.[playerId] ?? 0);
    if (!Number.isSafeInteger(goals) || goals <= 0) return match;
    goalsMoved += goals;
    const goalscorers4ESO = { ...(match.goalscorers4ESO ?? {}) };
    goalscorers4ESO[unknownPlayerId] = Number(goalscorers4ESO[unknownPlayerId] ?? 0) + goals;
    delete goalscorers4ESO[playerId];
    const goalscorerNames = { ...(match.goalscorerNames ?? {}) };
    goalscorerNames[unknownPlayerId] = unknownPlayerName;
    delete goalscorerNames[playerId];
    return { ...match, goalscorers4ESO, goalscorerNames };
  });
  const nextAdjustments = adjustments.map((adjustment) => adjustment.playerId === playerId
    ? { ...adjustment, playerId: unknownPlayerId, playerName: unknownPlayerName }
    : adjustment);
  return { matches: nextMatches, adjustments: nextAdjustments, goalsMoved };
}

export function ghostArchiveBlockReason(input: {
  playerId: string;
  profile: GhostArchiveProfile | null;
  fantasyPlayer: GhostArchiveFantasyPlayer | null;
  matches: Array<{ goalscorers4ESO?: Record<string, number> }>;
  manualAdjustments: Array<{ playerId: string; amount: number }>;
  offers: Array<{ playerId: string; status: string }>;
}): string | null {
  const { playerId, profile, fantasyPlayer } = input;
  if (!profile?.ghost || profile.team !== "4ESO" || profile.uid || profile.unknown) return "Solo se pueden archivar perfiles fantasma de 4 ESO sin cuenta asociada.";
  if (fantasyPlayer?.ownerUid) return "Este jugador tiene un mánager Fantasy. Libera o transfiere el activo antes de archivarlo.";
  if (Number(fantasyPlayer?.permanentInvestment ?? 0) > 0) return "Este jugador conserva una inversión permanente y no se puede archivar.";
  if (input.offers.some((offer) => offer.playerId === playerId && offer.status === "pending")) return "Este jugador tiene ofertas pendientes. Resuélvelas antes de archivarlo.";
  return null;
}
