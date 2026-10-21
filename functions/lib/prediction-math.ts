export type PredictionMatchSample = { id: string; score3ESO: number; score4ESO: number };

export function estimateProbability(successes: number, attempts: number, priorProbability = 0.5, priorStrength = 4) {
  const n = Math.max(0, attempts);
  const k = Math.min(n, Math.max(0, successes));
  return (k + priorProbability * priorStrength) / (n + priorStrength);
}

export function createWinnerQuestion(matches: PredictionMatchSample[]) {
  const counts = { "3 ESO": 0, Empate: 0, "4 ESO": 0 };
  for (const match of matches) {
    const winner = match.score3ESO > match.score4ESO ? "3 ESO" : match.score3ESO < match.score4ESO ? "4 ESO" : "Empate";
    counts[winner] += 1;
  }
  const probabilities = Object.fromEntries(Object.entries(counts).map(([name, count]) => [name, (count + 1) / (matches.length + 3)])) as Record<string, number>;
  return { id: "winner", kind: "winner", question: "¿Quién ganará el próximo partido?", outcomes: Object.fromEntries(Object.entries(probabilities).map(([name, probability]) => [name, { probability }])) };
}
