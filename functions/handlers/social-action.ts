import { randomUUID } from "node:crypto";
import type { Handler } from "../lib/runtime-types";
import { adminBucket, firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { asBadRequest, asForbidden, json, run, bodyOf, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const { uid } = await requireUser(event);
  const body = bodyOf(event);
  const action = String(body.action ?? "");
  const now = Date.now();
  if (["like", "unlike"].includes(action)) {
    const postId = String(body.postId ?? "");
    const postRef = firebaseDb.ref(`laligaBrains/social/posts/${postId}`);
    let changed = false;
    const result = await postRef.transaction((post) => {
      if (!post || post.status === "deleted") return;
      post.likes ??= {};
      const hasLike = Boolean(post.likes[uid]);
      changed = false;
      if (action === "like" && !hasLike) { post.likes[uid] = true; post.likeCount = Number(post.likeCount ?? 0) + 1; changed = true; }
      if (action === "unlike" && hasLike) { delete post.likes[uid]; post.likeCount = Math.max(0, Number(post.likeCount ?? 0) - 1); changed = true; }
      return post;
    });
    if (!result.committed || !result.snapshot.exists()) throw asBadRequest("La publicación ya no está disponible.");
    const authorUid = String(result.snapshot.child("authorUid").val() ?? "");
    const liked = action === "like";
    await firebaseDb.ref(`laligaBrains/social/likesByUser/${uid}/${postId}`).set(liked ? true : null);
    if (changed && authorUid !== uid) {
      await firebaseDb.ref(`laligaBrains/leaderboards/popular/${authorUid}/likes`).transaction((count) => Math.max(0, Number(count ?? 0) + (liked ? 1 : -1)));
      if (liked) await firebaseDb.ref(`laligaBrains/notifications/${authorUid}`).push({ type: "like", actorUid: uid, postId, read: false, createdAt: now });
    }
    return json(200, { liked, likeCount: Number(result.snapshot.child("likeCount").val() ?? 0) });
  }
  if (action === "report") {
    const postId = String(body.postId ?? "");
    const reason = String(body.reason ?? "").trim();
    if (!reason || reason.length > 500) throw asBadRequest("Indica el motivo del informe.");
    const post = (await firebaseDb.ref(`laligaBrains/social/posts/${postId}`).get()).val();
    if (!post) throw asBadRequest("La publicación no está disponible.");
    const reportId = randomUUID();
    await firebaseDb.ref(`laligaBrains/social/reports/${reportId}`).set({ id: reportId, postId, reporterUid: uid, reason, status: "open", createdAt: now });
    return json(201, { reportId });
  }
  if (action === "editPost" || action === "deletePost") {
    const postId = String(body.postId ?? "");
    const postRef = firebaseDb.ref(`laligaBrains/social/posts/${postId}`);
    const snapshot = await postRef.get();
    const post = snapshot.val() as { authorUid?: string; images?: string[]; status?: string } | null;
    if (!post || post.authorUid !== uid) throw asForbidden("Solo puedes cambiar tus propias publicaciones.");
    if (action === "editPost") {
      const text = String(body.text ?? "").trim();
      if (!text || text.length > 1000) throw asBadRequest("La publicación debe tener entre 1 y 1.000 caracteres.");
      const profile = (await firebaseDb.ref(`laligaBrains/identity/users/${uid}`).get()).val() as { restrictions?: { postingSuspendedUntil?: number } } | null;
      if (Number(profile?.restrictions?.postingSuspendedUntil ?? 0) > now) throw asForbidden("Tu permiso para publicar está suspendido temporalmente.");
      await postRef.update({ text, updatedAt: now });
      return json(200, { postId, updatedAt: now });
    }
    await firebaseDb.ref(`laligaBrains/administration/moderation/hiddenContent/posts/${postId}`).set({ ...post, id: postId, status: "deleted_by_author", deletedAt: now, deletedBy: uid });
    const comments = await firebaseDb.ref(`laligaBrains/social/comments/${postId}`).get();
    if (comments.exists()) {
      await firebaseDb.ref(`laligaBrains/administration/moderation/hiddenContent/comments/${postId}`).set(comments.val());
      const updates: Record<string, null> = {};
      comments.forEach((item) => { if (item.key && item.child("authorUid").val()) updates[`laligaBrains/social/commentsByUser/${String(item.child("authorUid").val())}/${postId}/${item.key}`] = null; });
      if (Object.keys(updates).length) await firebaseDb.ref().update(updates);
    }
    const updates: Record<string, unknown> = { [`laligaBrains/social/posts/${postId}`]: null, [`laligaBrains/social/comments/${postId}`]: null, [`laligaBrains/social/polls/${postId}`]: null };
    await firebaseDb.ref().update(updates);
    for (const image of post.images ?? []) await adminBucket.file(image).delete({ ignoreNotFound: true }).catch(() => undefined);
    return json(200, { postId, deleted: true });
  }
  throw asBadRequest("La acción social no está disponible.");
});
