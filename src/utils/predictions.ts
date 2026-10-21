export function estimateProbability(successes: number, attempts: number, priorProbability = 0.5, priorStrength = 4): number {
  const safeAttempts = Math.max(0, attempts);
  const safeSuccesses = Math.min(safeAttempts, Math.max(0, successes));
  return (safeSuccesses + priorProbability * priorStrength) / (safeAttempts + priorStrength);
}

export function madridDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function isPredictionOpen(date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  return hour < 15;
}
