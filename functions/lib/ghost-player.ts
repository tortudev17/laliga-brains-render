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
  if (input.matches.some((match) => Number(match.goalscorers4ESO?.[playerId] ?? 0) > 0)
    || input.manualAdjustments.some((adjustment) => adjustment.playerId === playerId && adjustment.amount !== 0)) {
    return "Este jugador tiene historial de goles; consérvalo y combina o corrige el perfil.";
  }
  if (fantasyPlayer?.ownerUid) return "Este jugador tiene un mánager Fantasy. Libera o transfiere el activo antes de archivarlo.";
  if (Number(fantasyPlayer?.permanentInvestment ?? 0) > 0) return "Este jugador conserva una inversión permanente y no se puede archivar.";
  if (input.offers.some((offer) => offer.playerId === playerId && offer.status === "pending")) return "Este jugador tiene ofertas pendientes. Resuélvelas antes de archivarlo.";
  return null;
}
