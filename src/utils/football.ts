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

export function validateGoalAttribution(score4ESO: number, goals: number[]): boolean {
  return Number.isInteger(score4ESO) && score4ESO >= 0 && goals.length === score4ESO && goals.every((n) => Number.isInteger(n) && n > 0);
}

export function calculatePlayerValue(totalGoals: number, recentGoals: number, matchesPlayed: number, permanentInvestment = 0): number {
  const sampleWeight = Math.min(1, matchesPlayed / 8);
  const smoothedPerformance = 50 + sampleWeight * (totalGoals * 4 + recentGoals * 7);
  return Math.max(50, Math.round(smoothedPerformance + permanentInvestment));
}

export function getBuyoutPrice(marketValue: number): number { return Math.max(0, Math.round(marketValue) * 2); }
