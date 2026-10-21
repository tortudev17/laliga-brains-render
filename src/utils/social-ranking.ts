export function socialFeedRank(post: { createdAt: number; likeCount?: number; recommendationPriority?: string }, promoted = false) {
  const priorityOffset = post.recommendationPriority === "high" ? 30_000 : post.recommendationPriority === "low" ? -30_000 : 0;
  const popularityOffset = Math.min(10, Math.max(0, Number(post.likeCount ?? 0))) * 3_000;
  return Number(post.createdAt) + priorityOffset + popularityOffset + (promoted ? 15_000 : 0);
}
