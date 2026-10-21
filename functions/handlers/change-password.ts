import type { Handler } from "../lib/runtime-types";
import { z } from "zod";
import { firebaseDb, currentRuntimeEnv } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { asBadRequest, json, run, bodyOf, methodNotAllowed } from "../lib/http";

const schema = z.object({ password: z.string().min(10).max(128) });
export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const { uid } = await requireUser(event, { allowForcedPasswordChange: true });
  const parsed = schema.safeParse(bodyOf(event));
  if (!parsed.success) throw asBadRequest("La contraseña debe tener al menos 10 caracteres.");
  const idToken = event.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!idToken) throw Object.assign(new Error("Inicia sesión otra vez para cambiar la contraseña."), { statusCode: 401 });
  const env = currentRuntimeEnv();
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken, password: parsed.data.password, returnSecureToken: true }),
  });
  if (!response.ok) throw Object.assign(new Error("Firebase no pudo actualizar la contraseña. Vuelve a iniciar sesión e inténtalo de nuevo."), { statusCode: 400 });
  await firebaseDb.ref(`laligaBrains/identity/users/${uid}`).update({ mustChangePassword: false, passwordChangedAt: Date.now() });
  return json(200, { changed: true });
});
