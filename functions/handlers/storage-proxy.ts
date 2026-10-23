import type { Handler } from "../lib/runtime-types";
import { requireUser } from "../lib/authentication";
import { asBadRequest, asForbidden, json, methodNotAllowed, run } from "../lib/http";

const bucket = "laliga-brains.firebasestorage.app";
const maxFileSize = 5 * 1024 * 1024;

export const handler: Handler = async (event) => run(async () => {
  const { uid } = await requireUser(event);
  const path = String(event.queryStringParameters?.path ?? "");
  const segments = path.split("/");
  const [folder, ownerUid, filename] = segments;
  if (segments.length !== 3 || !["profilePhotos", "social-post-images"].includes(folder ?? "") || !/^[A-Za-z0-9_-]{1,128}$/.test(ownerUid ?? "") || !/^[a-f0-9-]{36}\.(jpg|png|webp)$/i.test(filename ?? "")) {
    throw asBadRequest("La ruta de almacenamiento no es válida.");
  }

  const objectUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}`;
  const token = event.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) throw asForbidden("Inicia sesión para acceder a las imágenes.");

  if (event.httpMethod === "GET") {
    const response = await fetch(`${objectUrl}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw storageError(response.status);
    return {
      statusCode: 200,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/octet-stream", "Cache-Control": "private, no-store" },
      body: new Uint8Array(await response.arrayBuffer()),
    };
  }

  if (ownerUid !== uid) throw asForbidden("Solo puedes cambiar tus propias imágenes.");

  if (event.httpMethod === "POST") {
    const contentType = String(event.headers["content-type"] ?? "").split(";")[0]?.toLowerCase();
    const extension = filename?.split(".").at(-1)?.toLowerCase();
    const validType = (extension === "jpg" && contentType === "image/jpeg") || (extension === "png" && contentType === "image/png") || (extension === "webp" && contentType === "image/webp");
    const bytes = event.rawBody;
    if (!validType || !bytes?.length || bytes.length > maxFileSize) throw asBadRequest("La imagen debe ser JPG, PNG o WebP y no superar 5 MB.");
    const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(path)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType! },
      body: bytes,
    });
    if (!response.ok) throw storageError(response.status);
    return json(201, { path });
  }

  if (event.httpMethod === "DELETE") {
    const response = await fetch(objectUrl, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok && response.status !== 404) throw storageError(response.status);
    return json(200, { deleted: true });
  }

  return methodNotAllowed(["GET", "POST", "DELETE"]);
});

function storageError(status: number) {
  if (status === 401 || status === 403) return asForbidden("Firebase Storage ha rechazado esta operación.");
  return Object.assign(new Error(`Firebase Storage respondió con ${status}.`), { statusCode: status >= 500 ? 503 : 400 });
}
