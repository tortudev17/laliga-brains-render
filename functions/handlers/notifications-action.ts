import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { asBadRequest, json, run, bodyOf, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  const { uid } = await requireUser(event);
  const ref = firebaseDb.ref(`laligaBrains/notifications/${uid}`);
  if (event.httpMethod === "GET") {
    const snapshot = await ref.orderByChild("createdAt").limitToLast(100).get();
    const items: Array<Record<string, unknown> & { id: string; createdAt?: number; read?: boolean }> = Object.entries((snapshot.val() ?? {}) as Record<string, Record<string, unknown>>).map(([id, item]) => ({ ...item, id }));
    items.sort((a,b)=>Number(b.createdAt)-Number(a.createdAt));
    return json(200, { items, unread: items.filter((item) => item.read === false).length });
  }
  if (event.httpMethod !== "POST") return methodNotAllowed(["GET", "POST"]);
  const body = bodyOf(event);
  const notificationId = String(body.notificationId ?? "");
  if (!notificationId) throw asBadRequest("Indica la notificación que quieres marcar como leída.");
  const notificationRef = ref.child(notificationId);
  await notificationRef.transaction((current) => current ? { ...current, read: true, readAt: Date.now() } : undefined);
  return json(200, { read: true });
});
