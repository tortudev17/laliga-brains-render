import type { Handler, RuntimeRequestContext } from "../lib/runtime-types";
import { withFirebaseRuntime, verifyFirebaseIdToken, getPieroDatabaseToken, firebaseDb, encryptSecret } from "../lib/firebase-rest";
import { handler as accountStatus } from "../handlers/account-status";
import { handler as changePassword } from "../handlers/change-password";
import { handler as createPost } from "../handlers/create-post";
import { handler as fantasyAction } from "../handlers/fantasy-action";
import { handler as imageUrl } from "../handlers/image-url";
import { handler as leaderboard } from "../handlers/leaderboard";
import { handler as managerProfile } from "../handlers/manager-profile";
import { handler as notificationsAction } from "../handlers/notifications-action";
import { handler as penaltyAction } from "../handlers/penalty-action";
import { handler as playerProfile } from "../handlers/player-profile";
import { handler as predictionAction } from "../handlers/prediction-action";
import { handler as quizAction } from "../handlers/quiz-action";
import { handler as profileAction } from "../handlers/profile-action";
import { handler as promotionAction } from "../handlers/promotion-action";
import { handler as recoverAccount } from "../handlers/recover-account";
import { handler as register } from "../handlers/register";
import { handler as schoolScheduler } from "../handlers/school-scheduler";
import { handler as socialAction } from "../handlers/social-action";
import { handler as socialFeed } from "../handlers/social-feed";
import { handler as storageProxy } from "../handlers/storage-proxy";
import { handler as walletAction } from "../handlers/wallet-action";
import { handler as firebaseProxy } from "../handlers/firebase-proxy";
import { handler as pieroData } from "../handlers/piero-data";
import { handler as pieroAdmin } from "../handlers/piero-admin";
import { randomUUID } from "node:crypto";

const routes: Record<string, Handler> = {
  "account-status": accountStatus,
  "change-password": changePassword,
  "create-post": createPost,
  "fantasy-action": fantasyAction,
  "image-url": imageUrl,
  leaderboard,
  "manager-profile": managerProfile,
  "notifications-action": notificationsAction,
  "penalty-action": penaltyAction,
  "player-profile": playerProfile,
  "prediction-action": predictionAction,
  "quiz-action": quizAction,
  "profile-action": profileAction,
  "promotion-action": promotionAction,
  "recover-account": recoverAccount,
  register,
  "school-scheduler": schoolScheduler,
  "social-action": socialAction,
  "social-feed": socialFeed,
  "storage-proxy": storageProxy,
  "wallet-action": walletAction,
  "firebase-proxy": firebaseProxy,
  "piero-data": pieroData,
  "piero-admin": pieroAdmin,
};

export const onRequest = async ({ request, env, params }: RuntimeRequestContext): Promise<Response> => {
  try {
    const pathValue = params.path;
    const path = Array.isArray(pathValue) ? pathValue.join("/") : String(pathValue ?? "");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (path === "piero-pin") return await beginPieroUnlock(request, env);
    if (path === "piero-login") return await finishPieroUnlock(request, env);
    if (path === "piero-lock") return await lockPiero(request, env);
    if (path === "school-scheduler" && !isCronAuthorized(request, env)) return jsonResponse(404, { error: "No se encontró el recurso." });

    const route = routes[path];
    if (!route || request.method === "HEAD") return jsonResponse(404, { error: "No se encontró el recurso." });
    // Match the source Cloudflare functions: Render proxies Firebase requests
    // with the configured backend Firebase session.
    const databaseToken = await getPieroDatabaseToken(env);
    const url = new URL(request.url);
    const event = await toHandlerEvent(request, url);
    const response = await withFirebaseRuntime({ env, databaseToken }, () => Promise.resolve(route(event)));
    const body = response.body instanceof Uint8Array ? new Blob([response.body]) : response.body ?? "";
    return new Response(body, { status: response.statusCode, headers: { ...corsHeaders(request), "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", ...response.headers } });
  } catch (error) {
    const status = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 500;
    const message = status < 500 && error instanceof Error ? error.message : status === 503 && error instanceof Error ? error.message : "No se pudo completar la operación. Inténtalo de nuevo más tarde.";
    if (status >= 500) console.error("Error del backend Render:", error);
    return jsonResponse(status, { error: message }, request);
  }
};

async function toHandlerEvent(request: Request, url: URL) {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  const rawBody = request.method === "GET" || request.method === "HEAD" ? undefined : new Uint8Array(await request.clone().arrayBuffer());
  const isJson = (request.headers.get("content-type") ?? "").toLowerCase().includes("application/json");
  return {
    httpMethod: request.method,
    headers,
    body: isJson && rawBody ? new TextDecoder().decode(rawBody) : null,
    rawBody,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
  } satisfies Parameters<Handler>[0];
}

function jsonResponse(status: number, data: unknown, request?: Request) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(request ? corsHeaders(request) : {}) } });
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  const requestOrigin = new URL(request.url).origin;
  return {
    "Access-Control-Allow-Origin": origin === requestOrigin ? requestOrigin : requestOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-piero-session, x-piero-pin-ticket",
    "Vary": "Origin",
  };
}

function readBody(request: Request) { return request.clone().json().catch(() => ({})) as Promise<Record<string, unknown>>; }
function isCronAuthorized(request: Request, env: RuntimeRequestContext["env"]) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(env.CRON_SECRET && token && constantTimeEqual(token, env.CRON_SECRET));
}

async function beginPieroUnlock(request: Request, env: RuntimeRequestContext["env"]) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Método no permitido." }, request);
  if (!/^[a-f0-9]{128}$/i.test(env.PIERO_PIN_SHA512) || !env.PIERO_TOKEN_ENCRYPTION_KEY) return jsonResponse(503, { error: "Modo Piero aún no está configurado en el servicio." }, request);
  const body = await readBody(request);
  const pin = String(body.pin ?? "");
  if (!/^\d{4}$/.test(pin)) return jsonResponse(400, { error: "Introduce un PIN de cuatro cifras." }, request);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const stateKey = `piero-pin-attempts:${ip}`;
  const now = Date.now();
  const current = JSON.parse(await env.PIERO_KV.get(stateKey) ?? "{}") as { failures?: number; lockedUntil?: number };
  if (Number(current.lockedUntil ?? 0) > now) return jsonResponse(429, { error: "PIN bloqueado durante 15 minutos. Vuelve a intentarlo más tarde." }, request);
  const pinDigest = await sha512Hex(pin);
  if (!constantTimeEqual(pinDigest, env.PIERO_PIN_SHA512.toLowerCase())) {
    const failures = Number(current.failures ?? 0) + 1;
    const lockedUntil = failures >= 5 ? now + 15 * 60 * 1000 : 0;
    await env.PIERO_KV.put(stateKey, JSON.stringify({ failures, lockedUntil }), { expirationTtl: 15 * 60 });
    return jsonResponse(failures >= 5 ? 429 : 401, { error: failures >= 5 ? "PIN bloqueado durante 15 minutos." : "El PIN no es correcto." }, request);
  }
  await env.PIERO_KV.delete(stateKey);
  const challengeId = randomUUID();
  await env.PIERO_KV.put(`piero-pin-ticket:${challengeId}`, JSON.stringify({ createdAt: now, clientIp: ip }), { expirationTtl: 300 });
  return jsonResponse(200, { challengeId, expiresIn: 300 }, request);
}

async function finishPieroUnlock(request: Request, env: RuntimeRequestContext["env"]) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Método no permitido." }, request);
  if (!env.PIERO_EMAIL || !env.PIERO_TOKEN_ENCRYPTION_KEY || !env.FIREBASE_API_KEY) return jsonResponse(503, { error: "Modo Piero no tiene configurada su conexión con Firebase en Render." }, request);
  const body = await readBody(request);
  const challengeId = String(body.challengeId ?? "");
  const ticketKey = `piero-pin-ticket:${challengeId}`;
  if (!/^[a-f0-9-]{36}$/i.test(challengeId)) return jsonResponse(401, { error: "La verificación del PIN ha caducado. Introdúcelo de nuevo." }, request);
  const ticketValue = await env.PIERO_KV.get(ticketKey);
  const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!ticketValue || (JSON.parse(ticketValue) as { clientIp?: string }).clientIp !== clientIp) return jsonResponse(401, { error: "La verificación del PIN ha caducado. Introdúcelo de nuevo." }, request);
  await env.PIERO_KV.delete(ticketKey);
  const password = String(body.password ?? "");
  if (password.length < 6 || password.length > 256) return jsonResponse(400, { error: "Introduce la contraseña de la cuenta de Piero." }, request);
  const authStateKey = `piero-password-attempts:${clientIp}`;
  const authState = JSON.parse(await env.PIERO_KV.get(authStateKey) ?? "{}") as { failures?: number; lockedUntil?: number };
  const attemptTime = Date.now();
  if (Number(authState.lockedUntil ?? 0) > attemptTime) return jsonResponse(429, { error: "Los intentos de contraseña están bloqueados durante 15 minutos." }, request);

  // Authenticate on the server through Firebase Identity Toolkit. The password
  // is never saved, returned to the browser, or written to logs.
  const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: env.PIERO_EMAIL, password, returnSecureToken: true }),
  });
  const authResult = await authResponse.json() as {
    localId?: string; idToken?: string; refreshToken?: string; expiresIn?: string;
    error?: { message?: string };
  };
  if (!authResponse.ok || !authResult.idToken || !authResult.refreshToken || !authResult.localId) {
    const code = authResult.error?.message ?? "";
    const failures = Number(authState.failures ?? 0) + 1;
    const lockedUntil = failures >= 5 ? attemptTime + 15 * 60 * 1000 : 0;
    await env.PIERO_KV.put(authStateKey, JSON.stringify({ failures, lockedUntil }), { expirationTtl: 15 * 60 });
    if (["EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS"].includes(code)) {
      return jsonResponse(lockedUntil ? 429 : 401, { error: lockedUntil ? "Demasiados intentos. La contraseña queda bloqueada durante 15 minutos." : "Firebase no ha aceptado esa contraseña para la cuenta de Piero. Comprueba que la cuenta existe en Firebase Authentication y que tiene esa contraseña." }, request);
    }
    if (code === "USER_DISABLED") return jsonResponse(403, { error: "La cuenta de Piero está deshabilitada en Firebase Authentication." }, request);
    if (code === "OPERATION_NOT_ALLOWED") return jsonResponse(503, { error: "Activa el proveedor Correo/contraseña en Firebase Authentication." }, request);
    if (code === "TOO_MANY_ATTEMPTS_TRY_LATER") return jsonResponse(429, { error: "Firebase ha limitado temporalmente los intentos. Espera antes de volver a probar." }, request);
    console.error("Firebase Piero sign-in rejected the request:", code || authResponse.status);
    return jsonResponse(503, { error: "Firebase no ha podido autenticar la cuenta de Piero. Revisa la configuración de Email/Password y vuelve a intentarlo." }, request);
  }

  let claims;
  try { claims = await verifyFirebaseIdToken(authResult.idToken, env); }
  catch {
    await env.PIERO_KV.put(authStateKey, JSON.stringify({ failures: Number(authState.failures ?? 0) + 1 }), { expirationTtl: 15 * 60 });
    return jsonResponse(503, { error: "Firebase inició sesión, pero no se pudo verificar la identidad de Piero." }, request);
  }
  if (claims.uid !== authResult.localId || claims.email?.toLowerCase() !== env.PIERO_EMAIL.toLowerCase()) return jsonResponse(403, { error: "La cuenta autenticada no coincide con la identidad de Piero." }, request);
  await env.PIERO_KV.delete(authStateKey);
  const now = Date.now();
  const sessionToken = randomUUID();
  const [encryptedRefreshToken, encryptedAccessToken] = await Promise.all([
    encryptSecret(authResult.refreshToken, env.PIERO_TOKEN_ENCRYPTION_KEY),
    encryptSecret(JSON.stringify({ idToken: authResult.idToken, expiresAt: now + Number(authResult.expiresIn ?? 3600) * 1000 }), env.PIERO_TOKEN_ENCRYPTION_KEY),
  ]);
  await withFirebaseRuntime({ env, databaseToken: authResult.idToken }, async () => {
    const profileRef = firebaseDb.ref(`laligaBrains/identity/users/${claims.uid}`);
    const existingProfile = (await profileRef.get()).val() as Record<string, unknown> | null;
    if (existingProfile && existingProfile.accountStatus !== "active") throw Object.assign(new Error("La cuenta de Piero está suspendida en la base de datos."), { statusCode: 403 });
    await profileRef.transaction((profile) => profile ?? { username: "piero", displayName: "Piero", role: "spectator", accountStatus: "active", createdAt: now });
    await firebaseDb.ref("laligaBrains/administration/auditLogs").push({ type: "piero_unlock", actorUid: claims.uid, createdAt: now });
  });
  await Promise.all([
    env.PIERO_KV.put("firebase:piero:refresh", encryptedRefreshToken),
    env.PIERO_KV.put("firebase:piero:access", encryptedAccessToken, { expirationTtl: Number(authResult.expiresIn ?? 3600) }),
    env.PIERO_KV.put(`piero-session:${sessionToken}`, JSON.stringify({ uid: claims.uid, createdAt: now, lastActivity: now, expiresAt: now + 15 * 60 * 1000 }), { expirationTtl: 15 * 60 }),
  ]);
  return jsonResponse(200, { sessionToken, expiresAt: now + 15 * 60 * 1000 }, request);
}

async function lockPiero(request: Request, env: RuntimeRequestContext["env"]) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Método no permitido." }, request);
  const token = request.headers.get("x-piero-session") ?? "";
  if (/^[a-f0-9-]{36}$/i.test(token)) await env.PIERO_KV.delete(`piero-session:${token}`);
  return jsonResponse(200, { locked: true }, request);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
async function sha512Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
