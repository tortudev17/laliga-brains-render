import type { MatchRecord, TeamId, TeamStats } from "../types/domain";

const emptyStats = (): TeamStats => ({ played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, streak: "—", recentResults: [] });

export function calculateTeamStats(matches: MatchRecord[], team: TeamId): TeamStats {
  const ordered = [...matches].sort((a, b) => a.playedAt - b.playedAt || a.id.localeCompare(b.id));
  const stats = emptyStats();
  const results: Array<"W" | "D" | "L"> = [];
  for (const match of ordered) {
    const gf = team === "3ESO" ? match.score3ESO : match.score4ESO;
    const ga = team === "3ESO" ? match.score4ESO : match.score3ESO;
    stats.played += 1;
    stats.goalsFor += gf;
    stats.goalsAgainst += ga;
    if (gf > ga) { stats.wins += 1; stats.points += 3; results.push("W"); }
    else if (gf === ga) { stats.draws += 1; stats.points += 1; results.push("D"); }
    else { stats.losses += 1; results.push("L"); }
  }
  stats.goalDifference = stats.goalsFor - stats.goalsAgainst;
  stats.recentResults = results.slice(-5).reverse();
  if (results.length) {
    const latest = results.at(-1)!;
    let count = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === latest; i -= 1) count += 1;
    stats.streak = `${latest}${count}`;
  }
  return stats;
}

export function goalsByPlayer(matches: MatchRecord[]): Record<string, number> {
  return matches.reduce<Record<string, number>>((totals, match) => {
    for (const [playerId, goals] of Object.entries(match.goalscorers4ESO ?? {})) totals[playerId] = (totals[playerId] ?? 0) + goals;
    return totals;
  }, {});
}

export interface ManualGoalDelta { playerId: string; amount: number }
export interface PlayerGoalStats {
  totalGoals: number;
  goalsByMatch: Record<string, number>;
  recentGoals: number;
  manualGoals: number;
}

/** Combines match-attributed goals with audited Piero adjustments. Manual changes never create match contributions. */
export function calculatePlayerGoalStats(matches: MatchRecord[], adjustments: ManualGoalDelta[] = []): Record<string, PlayerGoalStats> {
  const result: Record<string, PlayerGoalStats> = {};
  const ordered = [...matches].sort((a, b) => a.playedAt - b.playedAt || a.id.localeCompare(b.id));
  for (const match of ordered) for (const [playerId, rawGoals] of Object.entries(match.goalscorers4ESO ?? {})) {
    const goals = Number(rawGoals);
    if (!Number.isSafeInteger(goals) || goals <= 0) continue;
    result[playerId] ??= { totalGoals: 0, goalsByMatch: {}, recentGoals: 0, manualGoals: 0 };
    result[playerId]!.totalGoals += goals;
    result[playerId]!.goalsByMatch[match.id] = (result[playerId]!.goalsByMatch[match.id] ?? 0) + goals;
  }
  for (const adjustment of adjustments) {
    if (!adjustment.playerId || !Number.isSafeInteger(adjustment.amount) || adjustment.amount === 0) continue;
    result[adjustment.playerId] ??= { totalGoals: 0, goalsByMatch: {}, recentGoals: 0, manualGoals: 0 };
    result[adjustment.playerId]!.totalGoals += adjustment.amount;
    result[adjustment.playerId]!.manualGoals += adjustment.amount;
  }
  for (const info of Object.values(result)) {
    info.recentGoals = Object.values(info.goalsByMatch).slice(-5).reduce((sum, goals) => sum + goals, 0);
    if (info.totalGoals < 0) throw new Error("Los goles totales de un jugador no pueden ser negativos.");
  }
  return result;
}

export function validateGoalAttribution(score4ESO: number, goals: number[]): boolean {
  return Number.isInteger(score4ESO) && score4ESO >= 0 && goals.length === score4ESO && goals.every((n) => Number.isInteger(n) && n > 0);
}

export function calculatePlayerValue(totalGoals: number, recentGoals: number, matchesPlayed: number, permanentInvestment = 0): number {
  const sampleWeight = Math.min(1, matchesPlayed / 8);
  const smoothedPerformance = 50 + sampleWeight * (totalGoals * 4 + recentGoals * 7);
  return Math.max(50, Math.round(smoothedPerformance + permanentInvestment));
}

export function getBuyoutPrice(marketValue: number): number { return Math.max(0, Math.round(marketValue) * 2); }
