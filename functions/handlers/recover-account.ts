import type { Handler } from "../lib/runtime-types";
import { json, run, methodNotAllowed } from "../lib/http";

// Firebase password changes for a different account require the Admin SDK. This
// deployment intentionally has no service-account credential, so this endpoint
// refuses to pretend a recovery succeeded.
export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  return json(501, { error: "La recuperación de otra cuenta debe gestionarla Piero desde Firebase Authentication." });
});
