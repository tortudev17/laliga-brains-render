export interface MatchRewardRecord {
  id: string;
  uid: string;
  amount: number;
  idempotencyKey: string;
  matchId: string;
}

/** Realtime Database stores an empty array as null, so normalize that case on read. */
export function normalizeMatchRewards(value: unknown): MatchRewardRecord[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("La lista de recompensas del partido no es válida.");
  return value as MatchRewardRecord[];
}

/**
 * Repair a partially initialized football state from the public match index.
 * Existing state rows remain authoritative; missing rows are copied in.
 */
export function mergeMissingMatchRows<T>(stateMatches: Record<string, T> | null | undefined, publicMatches: Record<string, T> | null | undefined, deletedIds: Iterable<string> = []): Record<string, T> {
  const merged = { ...(stateMatches ?? {}) };
  const deleted = new Set(deletedIds);
  for (const [id, match] of Object.entries(publicMatches ?? {})) {
    if (merged[id] == null && !deleted.has(id)) merged[id] = match;
  }
  return merged;
}

/** A pending old action must project the latest match state, including deletions. */
export function currentMatchForProjection<T>(stateMatches: Record<string, T> | null | undefined, matchId: string): T | null {
  return stateMatches?.[matchId] ?? null;
}
