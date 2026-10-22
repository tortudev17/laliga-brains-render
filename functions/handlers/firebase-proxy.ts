import type { Handler } from "../lib/runtime-types";
import { firebaseAuth, firebaseDb } from "../lib/firebase-rest";
import { asBadRequest, asForbidden, asUnauthorized, json, methodNotAllowed, run } from "../lib/http";

const publicReadPaths = new Set([
  "laligaBrains/football/matches",
  "laligaBrains/football/teamStats",
  "laligaBrains/config/siteSettings/penaltyGameEnabled",
]);

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);

  const path = String(event.queryStringParameters?.path ?? "").replace(/^\/+|\/+$/g, "");
  if (!path || path.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    throw asBadRequest("La ruta de Firebase no es válida.");
  }

  if (!publicReadPaths.has(path)) {
    const header = event.headers.authorization ?? event.headers.Authorization;
    if (!header?.startsWith("Bearer ")) throw asUnauthorized("Inicia sesión para continuar.");
    let uid: string;
    try { uid = (await firebaseAuth.verifyIdToken(header.slice(7), true)).uid; }
    catch { throw asUnauthorized("La sesión ha caducado. Inicia sesión de nuevo."); }

    const ownProfilePath = `laligaBrains/identity/users/${uid}`;
    if (path !== ownProfilePath) throw asForbidden("Solo puedes consultar tu propio perfil.");
  }

  const snapshot = await firebaseDb.ref(path).get();
  return json(200, { value: snapshot.val() });
});
