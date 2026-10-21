import type { MatchRecord } from "../types/domain";

export type PerformanceMetric = "points" | "goals";
export interface PerformancePoint {
  matchId: string;
  label: string;
  threeEso: number;
  fourEso: number;
}

export function buildPerformanceSeries(matches: MatchRecord[], metric: PerformanceMetric): PerformancePoint[] {
  return [...matches]
    .sort((a, b) => a.playedAt - b.playedAt)
    .slice(-8)
    .map((match) => {
      const draw = match.score3ESO === match.score4ESO;
      const threeWon = match.score3ESO > match.score4ESO;
      return {
        matchId: match.id,
        label: new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", timeZone: "Europe/Madrid" }).format(match.playedAt),
        threeEso: metric === "goals" ? match.score3ESO : draw ? 1 : threeWon ? 3 : 0,
        fourEso: metric === "goals" ? match.score4ESO : draw ? 1 : threeWon ? 0 : 3,
      };
    });
}
