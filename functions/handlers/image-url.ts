import type { Handler } from "../lib/runtime-types";
import { adminBucket, firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { asBadRequest, asForbidden, json, run, bodyOf, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const { uid } = await requireUser(event);
  const { path, postId } = bodyOf(event) as { path?: string; postId?: string };
  if (!path) throw asBadRequest("La imagen no está disponible.");
  if (path.startsWith("profilePhotos/")) {
    const [, ownerUid] = path.split("/");
    const profile = (await firebaseDb.ref(`laligaBrains/identity/users/${ownerUid}`).get()).val() as { photoPath?: string; accountStatus?: string } | null;
    if (!ownerUid || profile?.accountStatus !== "active" || profile.photoPath !== path || uid !== ownerUid) throw asForbidden("No tienes permiso para ver esta foto.");
  } else {
    if (!postId || !path.startsWith("social-post-images/")) throw asBadRequest("La imagen no está disponible.");
    const post = (await firebaseDb.ref(`laligaBrains/social/posts/${postId}`).get()).val() as { images?: string[]; status?: string } | null;
    if (!post || post.status !== "published" || !post.images?.includes(path)) throw asForbidden("No tienes permiso para ver esta imagen.");
  }
  const [url] = await adminBucket.file(path).getSignedUrl({ action: "read", expires: Date.now() + 5 * 60 * 1000, version: "v4" });
  return json(200, { url, expiresIn: 300 });
});
