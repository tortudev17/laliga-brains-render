import type { HandlerEvent } from "./runtime-types";
import type { DecodedIdToken } from "./firebase-rest";
import { firebaseAuth, firebaseDb, currentRuntimeEnv } from "./firebase-rest";
import { asForbidden, asUnauthorized } from "./http";

export interface VerifiedUser { uid: string; claims: DecodedIdToken; profile: Record<string, unknown> }

export async function requireUser(event: HandlerEvent, options: { allowForcedPasswordChange?: boolean } = {}): Promise<VerifiedUser> {
  const header = event.headers.authorization ?? event.headers.Authorization;
  if (!header?.startsWith("Bearer ")) throw asUnauthorized("Inicia sesión para continuar.");
  let claims: DecodedIdToken;
  try { claims = await firebaseAuth.verifyIdToken(header.slice(7), true); }
  catch { throw asUnauthorized("La sesión ha caducado. Inicia sesión de nuevo."); }
  const snapshot = await firebaseDb.ref(`laligaBrains/identity/users/${claims.uid}`).get();
  if (!snapshot.exists()) throw asUnauthorized("La cuenta no está activa.");
  const profile = snapshot.val() as Record<string, unknown>;
  if (profile.accountStatus !== "active") throw asForbidden(profile.accountStatus === "pending_approval" ? "La cuenta está pendiente de aprobación." : "La cuenta no está habilitada.");
  if (profile.mustChangePassword === true && !options.allowForcedPasswordChange) throw asForbidden("Debes cambiar tu contraseña antes de continuar.");
  return { uid: claims.uid, claims, profile };
}

export async function requirePiero(event: HandlerEvent): Promise<{ user: Pick<VerifiedUser, "uid" | "profile">; sessionId: string }> {
  const env = currentRuntimeEnv();
  const sessionToken = event.headers["x-piero-session"];
  if (!sessionToken || !/^[a-f0-9-]{36}$/i.test(sessionToken)) throw asForbidden("Desbloquea Modo Piero para continuar.");
  const sessionId = sessionToken;
  const rawSession = await env.PIERO_KV.get(`piero-session:${sessionId}`);
  const session = rawSession ? JSON.parse(rawSession) as { uid?: string; expiresAt?: number; lastActivity?: number } : null;
  const now = Date.now();
  if (!session || !session.uid || !session.expiresAt || session.expiresAt <= now || !session.lastActivity || now - session.lastActivity > 15 * 60 * 1000) {
    if (session) await env.PIERO_KV.delete(`piero-session:${sessionId}`);
    throw asForbidden("La sesión de Modo Piero ha caducado. Vuelve a introducir el PIN.");
  }
  const snapshot = await firebaseDb.ref(`laligaBrains/identity/users/${session.uid}`).get();
  if (!snapshot.exists()) {
    await env.PIERO_KV.delete(`piero-session:${sessionId}`);
    throw asForbidden("La cuenta de Piero no está activa.");
  }
  const profile = snapshot.val() as Record<string, unknown>;
  if (profile.accountStatus !== "active") {
    await env.PIERO_KV.delete(`piero-session:${sessionId}`);
    throw asForbidden("La cuenta de Piero no está activa.");
  }
  await env.PIERO_KV.put(`piero-session:${sessionId}`, JSON.stringify({ ...session, lastActivity: now, expiresAt: now + 15 * 60 * 1000 }), { expirationTtl: 15 * 60 });
  return { user: { uid: session.uid, profile }, sessionId };
}
