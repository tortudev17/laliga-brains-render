import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Handler } from "../lib/runtime-types";
import { currentRuntimeEnv, firebaseDb } from "../lib/firebase-rest";
import { createWalletCredit } from "../lib/economy";
import { asBadRequest, json, run, bodyOf, methodNotAllowed } from "../lib/http";

const schema = z.object({ username: z.string().min(3).max(20), password: z.string().min(10).max(128), role: z.enum(["player_3eso", "player_4eso", "spectator"]) });
const reserved = new Set(["piero", "admin", "administrator", "root", "support", "staff", "soporte", "sistema", "system", "laligabrains"]);

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const input = schema.safeParse(bodyOf(event));
  if (!input.success) throw asBadRequest(input.error.issues[0]?.message ?? "Revisa los datos del formulario.");
  const username = input.data.username.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username) || reserved.has(username)) throw asBadRequest("Ese nombre de usuario no está disponible.");
  const env = currentRuntimeEnv();
  const reservationId = randomUUID();
  const claim = firebaseDb.ref(`laligaBrains/identity/usernames/${username}`);
  const reservation = await claim.transaction((current) => current === null ? { status: "reserved", reservationId, createdAt: Date.now() } : undefined, undefined, false);
  if (!reservation.committed) throw Object.assign(new Error("Ese nombre de usuario ya está en uso."), { statusCode: 409 });
  let uid = "";
  let idToken = "";
  try {
    const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${username}@laligabrains.com`, password: input.data.password, displayName: username, returnSecureToken: true }),
    });
    const authResult = await authResponse.json() as { localId?: string; idToken?: string; error?: { message?: string } };
    if (!authResponse.ok || !authResult.localId || !authResult.idToken) {
      if (authResult.error?.message === "EMAIL_EXISTS") throw Object.assign(new Error("Ese nombre de usuario ya está en uso."), { statusCode: 409 });
      throw Object.assign(new Error("Firebase Authentication no pudo crear la cuenta."), { statusCode: 400 });
    }
    uid = authResult.localId;
    idToken = authResult.idToken;
    const [enhancedSnapshot] = await Promise.all([
      firebaseDb.ref("laligaBrains/config/siteSettings/enhancedSecurity").get(),
    ]);
    const pending = Boolean(enhancedSnapshot.val()) && input.data.role !== "spectator";
    const now = Date.now();
    const playerId = input.data.role === "player_4eso" ? randomUUID() : undefined;
    const profile = { username, displayName: username, role: input.data.role, accountStatus: pending ? "pending_approval" : "active", createdAt: now, ...(playerId && !pending ? { playerId } : {}) };
    const claimCompletion = await claim.transaction((current) => current?.reservationId === reservationId ? { uid, status: "active", createdAt: now } : undefined, undefined, false);
    if (!claimCompletion.committed) throw Object.assign(new Error("No se pudo reservar el nombre de usuario. Vuelve a intentarlo."), { statusCode: 409 });
    const updates: Record<string, unknown> = { [`laligaBrains/identity/users/${uid}`]: profile };
    if (pending) updates[`laligaBrains/identity/registrationApprovals/${uid}`] = { uid, username, role: input.data.role, status: "pending", createdAt: now };
    if (playerId && !pending) {
      updates[`laligaBrains/identity/playerProfiles/${playerId}`] = { id: playerId, uid, name: username, team: "4ESO", ghost: false, createdAt: now };
      updates[`laligaBrains/football/playerStats/${playerId}`] = { totalGoals: 0, goalsByMatch: {} };
    }
    await firebaseDb.ref().update(updates);
    if (playerId && !pending) {
      const { mutateEconomy } = await import("../lib/economy");
      await mutateEconomy((state) => { state.fantasyPlayers[playerId] ??= { id: playerId, uid, name: username, value: 50, permanentInvestment: 0, ownerUid: null, ghost: false, createdAt: now }; return true; });
    }
    await createWalletCredit(uid, 100, "registration_bonus", `registration:${uid}`);
    return json(201, { pendingApproval: pending, message: pending ? "La solicitud de jugador queda pendiente de aprobación." : "Cuenta creada." });
  } catch (error) {
    if (uid && idToken) {
      await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) }).catch(() => undefined);
      await firebaseDb.ref(`laligaBrains/identity/users/${uid}`).remove().catch(() => undefined);
      await firebaseDb.ref(`laligaBrains/identity/registrationApprovals/${uid}`).remove().catch(() => undefined);
      await firebaseDb.ref(`laligaBrains/identity/usernames/${username}`).transaction((current) => current?.uid === uid ? null : current, undefined, false).catch(() => undefined);
    } else {
      await claim.transaction((current) => current?.reservationId === reservationId ? null : current, undefined, false).catch(() => undefined);
    }
    throw error;
  }
});
