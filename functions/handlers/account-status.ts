import type { Handler } from "../lib/runtime-types";
import { requireUser } from "../lib/authentication";
import { json, run, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const { uid, profile, claims } = await requireUser(event);
  return json(200, { uid, accountStatus: profile.accountStatus, role: profile.role, admin: claims.admin === true });
});
