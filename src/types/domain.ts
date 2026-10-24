export type TeamId = "3ESO" | "4ESO";
export type UserRole = "player_3eso" | "player_4eso" | "spectator";
export type AccountStatus = "active" | "pending_approval" | "suspended" | "banned" | "deleted";

export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  nickname?: string;
  photoURL?: string;
  photoPath?: string;
  role: UserRole;
  accountStatus: AccountStatus;
  createdAt: number;
  mustChangePassword?: boolean;
}

export interface MatchRecord {
  id: string;
  playedAt: number;
  score3ESO: number;
  score4ESO: number;
  goalscorers4ESO: Record<string, number>;
  goalscorerNames?: Record<string, string>;
  createdAt: number;
  createdBy: string;
  updatedAt?: number;
  updatedBy?: string;
}

export interface TeamStats {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  streak: string;
  recentResults: Array<"W" | "D" | "L">;
}

export interface PlayerProfile {
  id: string;
  name: string;
  uid?: string;
  ghost: boolean;
  unknown?: boolean;
  totalGoals: number;
  createdAt: number;
}

export interface ManualGoalAdjustment {
  id: string;
  playerId: string;
  playerName: string;
  amount: number;
  reason: string;
  actorUid: string;
  createdAt: number;
  idempotencyKey: string;
  status: "pending" | "complete";
}

export interface WalletView {
  balance: number;
  updatedAt: number;
}

export interface CoinTransaction {
  id: string;
  walletUid: string;
  actorUid: string | null;
  amount: number;
  type: string;
  relatedEntityId?: string;
  idempotencyKey: string;
  balanceAfter: number;
  createdAt: number;
}

export type PredictionStatus = "open" | "closed" | "settling" | "settled" | "cancelled" | "refunded";
