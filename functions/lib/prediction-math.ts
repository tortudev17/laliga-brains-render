export type PredictionMatchSample = {
  id: string;
  playedAt?: number;
  dateKey?: string;
  score3ESO: number;
  score4ESO: number;
  goalscorers4ESO?: Record<string, number>;
};

export type PredictionPlayerSample = { id: string; name: string; team?: string; archived?: boolean; unknown?: boolean };
export type PredictionOutcome = { probability: number };
export type PredictionQuestion = {
  id: string;
  kind: "winner" | "player_goals";
  question: string;
  playerId?: string;
  playerName?: string;
  threshold?: number;
  outcomes: Record<string, PredictionOutcome>;
};

export function estimateProbability(successes: number, attempts: number, priorProbability = 0.5, priorStrength = 4) {
  const n = Math.max(0, attempts);
  const k = Math.min(n, Math.max(0, successes));
  return (k + priorProbability * priorStrength) / (n + priorStrength);
}

export function createWinnerQuestion(matches: PredictionMatchSample[]): PredictionQuestion {
  const ordered = [...matches].sort((a, b) => Number(a.playedAt ?? 0) - Number(b.playedAt ?? 0) || a.id.localeCompare(b.id));
  const counts: Record<string, number> = { "3 ESO": 1, Empate: 1, "4 ESO": 1 };
  ordered.forEach((match, index) => {
    const outcome = match.score3ESO > match.score4ESO ? "3 ESO" : match.score3ESO < match.score4ESO ? "4 ESO" : "Empate";
    // The latest five results have a modest extra weight, while the prior
    // keeps small and empty histories from producing overconfident estimates.
    counts[outcome] += index >= ordered.length - 5 ? 1.5 : 1;
  });
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    id: "winner",
    kind: "winner",
    question: "¿Quién ganará el próximo partido?",
    outcomes: Object.fromEntries(Object.entries(counts).map(([name, count]) => [name, { probability: count / total }])),
  };
}

export function createPlayerQuestions(
  matches: PredictionMatchSample[],
  players: PredictionPlayerSample[],
  maxPlayers = 3,
): PredictionQuestion[] {
  const ordered = [...matches].sort((a, b) => Number(a.playedAt ?? 0) - Number(b.playedAt ?? 0) || a.id.localeCompare(b.id));
  const goalTotals: Record<string, number> = {};
  for (const match of ordered) {
    for (const [playerId, rawGoals] of Object.entries(match.goalscorers4ESO ?? {})) {
      const goals = Number(rawGoals);
      if (Number.isSafeInteger(goals) && goals > 0) goalTotals[playerId] = (goalTotals[playerId] ?? 0) + goals;
    }
  }
  const candidates = players
    .filter((player) => player.team === "4ESO" && player.archived !== true && player.unknown !== true && (goalTotals[player.id] ?? 0) > 0)
    .sort((a, b) => (goalTotals[b.id] ?? 0) - (goalTotals[a.id] ?? 0) || a.name.localeCompare(b.name, "es-ES"))
    .slice(0, Math.max(0, maxPlayers));

  const questions: PredictionQuestion[] = [];
  for (const player of candidates) {
    for (const threshold of [1, 2, 3]) {
      let attempts = 0;
      let successes = 0;
      ordered.forEach((match, index) => {
        const weight = index >= ordered.length - 5 ? 1.5 : 1;
        const goals = Number(match.goalscorers4ESO?.[player.id] ?? 0);
        attempts += weight;
        if (goals >= threshold) successes += weight;
      });
      const prior = threshold === 1 ? 0.3 : threshold === 2 ? 0.08 : 0.025;
      const probability = estimateProbability(successes, attempts, prior, 4);
      const wording = threshold === 1 ? "al menos un gol" : `al menos ${threshold} goles`;
      questions.push({
        id: `player_${player.id}_${threshold}`,
        kind: "player_goals",
        question: `¿${player.name} marcará ${wording}?`,
        playerId: player.id,
        playerName: player.name,
        threshold,
        outcomes: { Sí: { probability }, No: { probability: 1 - probability } },
      });
    }
  }
  return questions;
}

export function createPredictionQuestions(matches: PredictionMatchSample[], players: PredictionPlayerSample[]): PredictionQuestion[] {
  return [createWinnerQuestion(matches), ...createPlayerQuestions(matches, players)];
}
