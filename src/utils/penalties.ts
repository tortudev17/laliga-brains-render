export function hasWonPenaltyGame(goals: number, shots = 5): boolean {
  return Number.isInteger(goals) && Number.isInteger(shots) && shots === 5 && goals >= 3 && goals <= shots;
}
