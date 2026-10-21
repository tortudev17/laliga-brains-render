import { randomUUID } from "node:crypto";
import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { json, run, methodNotAllowed } from "../lib/http";
import { socialFeedRank } from "../../src/utils/social-ranking";

type Post = { id: string; authorUid: string; createdAt: number; likeCount?: number; text: string; images?: string[]; promoted?: boolean; status?: string; recommendationPriority?: string };
type FeedItem = Post & { liked: boolean; feedScore: number; promotionId?: string; creditedViews?: number; targetViews?: number; placementToken?: string };

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const { uid } = await requireUser(event);
  const [postsSnap, likesSnap, promotionsSnap] = await Promise.all([
    firebaseDb.ref("laligaBrains/social/posts").orderByChild("createdAt").limitToLast(100).get(),
    firebaseDb.ref(`laligaBrains/social/likesByUser/${uid}`).get(),
    firebaseDb.ref("laligaBrains/social/promotions").orderByChild("createdAt").limitToLast(100).get(),
  ]);
  const posts = postsSnap.val() as Record<string, Post> | null;
  const liked = likesSnap.val() as Record<string, boolean> | null;
  const items: FeedItem[] = Object.entries(posts ?? {}).map(([id, post]) => ({
    ...post,
    id,
    liked: Boolean(liked?.[id]),
    feedScore: socialFeedRank(post),
  })).filter((post) => (!post.status || post.status === "published"));

  const promotions = (promotionsSnap.val() ?? {}) as Record<string, { id: string; postId: string; authorUid: string; status: string; creditedViews: number; targetViews: number; viewsByUid?: Record<string, number> }>;
  for (const promotion of Object.values(promotions)) {
    if (promotion.status !== "active" || promotion.authorUid === uid || promotion.viewsByUid?.[uid]) continue;
    let post = items.find((candidate) => candidate.id === promotion.postId);
    if (!post) {
      const postSnap = await firebaseDb.ref(`laligaBrains/social/posts/${promotion.postId}`).get();
      if (postSnap.exists()) {
        const promotedPost = postSnap.val() as Post;
        post = { ...promotedPost, id: promotion.postId, liked: Boolean(liked?.[promotion.postId]), feedScore: socialFeedRank(promotedPost, true) };
        if (!promotedPost.status || promotedPost.status === "published") items.push(post);
      }
    }
    if (!post || (post.status && post.status !== "published")) continue;
    const expires = Date.now() + 15 * 60 * 1000;
    const placementToken = randomUUID();
    await firebaseDb.ref(`laligaBrains/social/promotionPlacementTokens/${uid}/${promotion.id}`).set({ token: placementToken, postId: promotion.postId, expiresAt: expires });
    Object.assign(post, { promoted: true, promotionId: promotion.id, creditedViews: promotion.creditedViews, targetViews: promotion.targetViews, placementToken, feedScore: socialFeedRank(post, true) });
  }

  items.sort((a, b) => b.feedScore - a.feedScore || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const page = items.slice(0, 40).map((post) => {
    const { feedScore: _feedScore, likes: _likes, link: _link, poll: _poll, comments: _comments, ...visiblePost } = post as FeedItem & Record<string, unknown>;
    return visiblePost;
  });
  return json(200, { items: page, mode: "chronological" });
});
