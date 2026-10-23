import { AsyncLocalStorage } from "node:async_hooks";
import type { RuntimeEnv } from "./runtime-types";

const PROJECT_ID = "laliga-brains";
const DATABASE_URL = "https://laliga-brains-default-rtdb.europe-west1.firebasedatabase.app";
const TOKEN_ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export interface DecodedIdToken {
  uid: string;
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
  auth_time: number;
  email?: string;
  email_verified?: boolean;
  [claim: string]: unknown;
}

export interface FirebaseRuntimeContext {
  env: RuntimeEnv;
  databaseToken: string;
}

const runtimeContext = new AsyncLocalStorage<FirebaseRuntimeContext>();
export function withFirebaseRuntime<T>(context: FirebaseRuntimeContext, operation: () => Promise<T>): Promise<T> {
  return runtimeContext.run(context, operation);
}
export function currentFirebaseRuntime(): FirebaseRuntimeContext {
  const context = runtimeContext.getStore();
  if (!context) throw new Error("No hay un contexto Firebase asociado a esta solicitud.");
  return context;
}
export function currentRuntimeEnv(): RuntimeEnv { return currentFirebaseRuntime().env; }

export async function getPieroDatabaseToken(env: RuntimeEnv): Promise<string> {
  if (!env.PIERO_KV || !env.PIERO_TOKEN_ENCRYPTION_KEY) throw Object.assign(new Error("La conexión segura a Firebase no está configurada en Render."), { statusCode: 503 });
  const cached = await env.PIERO_KV.get("firebase:piero:access");
  if (cached) {
    try {
      const value = JSON.parse(await decryptSecret(cached, env.PIERO_TOKEN_ENCRYPTION_KEY)) as { idToken: string; expiresAt: number };
      if (value.expiresAt > Date.now() + 60_000) return value.idToken;
    } catch { /* replace a malformed cache entry */ }
  }
  const encryptedRefreshToken = await env.PIERO_KV.get("firebase:piero:refresh");
  if (!encryptedRefreshToken) throw Object.assign(new Error("Piero debe iniciar sesión una vez para conectar las funciones con Firebase."), { statusCode: 503 });
  const refreshToken = await decryptSecret(encryptedRefreshToken, env.PIERO_TOKEN_ENCRYPTION_KEY);
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const tokens = await response.json() as { id_token?: string; refresh_token?: string; user_id?: string; expires_in?: string; error?: { message?: string } };
  if (!response.ok || !tokens.id_token || !tokens.refresh_token) throw Object.assign(new Error("La sesión técnica de Piero ha caducado. Vuelve a desbloquear Modo Piero."), { statusCode: 503 });
  const claims = await verifyFirebaseIdToken(tokens.id_token);
  if (claims.email?.toLowerCase() !== env.PIERO_EMAIL.toLowerCase()) throw new Error("La identidad Firebase configurada para Piero no coincide con el correo autorizado.");
  const ttl = Math.max(60, Number(tokens.expires_in ?? 3600));
  await Promise.all([
    encryptSecret(tokens.refresh_token, env.PIERO_TOKEN_ENCRYPTION_KEY).then((value) => env.PIERO_KV.put("firebase:piero:refresh", value)),
    encryptSecret(JSON.stringify({ idToken: tokens.id_token, expiresAt: Date.now() + ttl * 1000 }), env.PIERO_TOKEN_ENCRYPTION_KEY).then((value) => env.PIERO_KV.put("firebase:piero:access", value, { expirationTtl: ttl })),
  ]);
  return tokens.id_token;
}

export async function encryptSecret(value: string, keyValue: string) {
  const keyBytes = decodeBase64Url(keyValue);
  if (keyBytes.length !== 32) throw new Error("PIERO_TOKEN_ENCRYPTION_KEY debe codificar 32 bytes en Base64URL.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return JSON.stringify({ iv: toBase64Url(iv), ciphertext: toBase64Url(new Uint8Array(encrypted)) });
}

export async function decryptSecret(value: string, keyValue: string) {
  const parsed = JSON.parse(value) as { iv?: string; ciphertext?: string };
  if (!parsed.iv || !parsed.ciphertext) throw new Error("El valor cifrado almacenado no es válido.");
  const key = await crypto.subtle.importKey("raw", decodeBase64Url(keyValue), { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64Url(parsed.iv) }, key, decodeBase64Url(parsed.ciphertext));
  return new TextDecoder().decode(plaintext);
}

function toBase64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

let jwksCache: { expiresAt: number; keys: JsonWebKey[] } | undefined;
async function getJwks(): Promise<JsonWebKey[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(JWKS_URL, { cf: { cacheTtl: 1800, cacheEverything: true } } as RequestInit);
  if (!response.ok) throw new Error("No se pudieron verificar las claves de Firebase Authentication.");
  const data = await response.json() as { keys: JsonWebKey[] };
  jwksCache = { keys: data.keys, expiresAt: Date.now() + 30 * 60 * 1000 };
  return data.keys;
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function verifyFirebaseIdToken(token: string, env?: RuntimeEnv): Promise<DecodedIdToken> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token Firebase no válido.");
  const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]!))) as { alg?: string; kid?: string };
  const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]!))) as DecodedIdToken;
  if (header.alg !== "RS256" || !header.kid) throw new Error("Token Firebase no válido.");
  if (claims.aud !== PROJECT_ID || claims.iss !== TOKEN_ISSUER || claims.sub !== claims.uid && claims.uid !== undefined) throw new Error("El token no pertenece a laliga-brains.");
  if (!claims.sub || claims.sub.length > 128 || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("La sesión de Firebase ha caducado.");
  if (!Number.isFinite(claims.iat) || claims.iat > Math.floor(Date.now() / 1000) + 60 || !Number.isFinite(claims.auth_time) || claims.auth_time > Math.floor(Date.now() / 1000) + 60) throw new Error("El token Firebase no es válido.");
  const jwk = (await getJwks()).find((key) => (key as JsonWebKey & { kid?: string }).kid === header.kid);
  if (!jwk) throw new Error("La firma del token Firebase no es válida.");
  const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, decodeBase64Url(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new Error("La firma del token Firebase no es válida.");
  claims.uid = claims.sub;
  if (env && env.FIREBASE_API_KEY) await verifyNotDisabled(token, env);
  return claims;
}

async function verifyNotDisabled(idToken: string, env: RuntimeEnv) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }),
  });
  if (!response.ok) throw new Error("La sesión Firebase no está activa.");
  const result = await response.json() as { users?: Array<{ disabled?: boolean }> };
  if (!result.users?.length || result.users[0]?.disabled) throw new Error("La cuenta Firebase está deshabilitada.");
}

interface QueryOptions { orderBy?: string; limitToFirst?: number; limitToLast?: number; equalTo?: string | number | boolean }
interface SnapshotLike {
  key: string | null;
  val(): any;
  exists(): boolean;
  forEach(callback: (child: SnapshotLike) => boolean | void): boolean;
  child(path: string): SnapshotLike;
}
class Snapshot implements SnapshotLike {
  constructor(readonly key: string | null, private readonly value: any) {}
  val() { return this.value; }
  exists() { return this.value !== null && this.value !== undefined; }
  child(path: string) {
    let value = this.value;
    for (const segment of path.split("/").filter(Boolean)) value = value?.[segment];
    return new Snapshot(path.split("/").filter(Boolean).at(-1) ?? null, value ?? null);
  }
  forEach(callback: (child: SnapshotLike) => boolean | void) {
    if (!this.value || typeof this.value !== "object" || Array.isArray(this.value)) return false;
    for (const [key, value] of Object.entries(this.value as Record<string, unknown>)) if (callback(new Snapshot(key, value)) === true) return true;
    return false;
  }
}

class DatabaseReference {
  readonly key: string | null;
  constructor(readonly path: string, private readonly queryOptions: QueryOptions = {}) { this.key = path.split("/").filter(Boolean).at(-1) ?? null; }
  child(childPath: string) { return new DatabaseReference([this.path, childPath].filter(Boolean).join("/"), this.queryOptions); }
  orderByChild(child: string) { return this.withQuery({ orderBy: JSON.stringify(child) }); }
  orderByKey() { return this.withQuery({ orderBy: JSON.stringify("$key") }); }
  limitToFirst(count: number) { return this.withQuery({ limitToFirst: count }); }
  limitToLast(count: number) { return this.withQuery({ limitToLast: count }); }
  // Realtime Database expects query constraints as JSON primitives. In
  // particular, string values must be quoted (e.g. equalTo="active").
  equalTo(value: string | number | boolean) { return this.withQuery({ equalTo: JSON.stringify(value) }); }
  private withQuery(values: QueryOptions) { return new DatabaseReference(this.path, { ...this.queryOptions, ...values }); }
  async get(): Promise<SnapshotLike> { return this.request("GET"); }
  async once(_event: "value"): Promise<SnapshotLike> { return this.get(); }
  async set(value: any) { await this.request(value === null ? "DELETE" : "PUT", value); }
  async update(values: Record<string, any>) { await this.request("PATCH", values); }
  async remove() { await this.request("DELETE"); }
  async transaction(updateValue: (current: any) => any, _completion?: unknown, _applyLocally?: boolean) {
    currentFirebaseRuntime();
    const url = this.url();
    for (let attempt = 0; attempt < 12; attempt++) {
      const auth = this.requestAuthentication(url);
      const response = await fetch(auth.url, { headers: { ...auth.headers, "X-Firebase-ETag": "true" } });
      const current = response.ok ? await response.json() : null;
      if (!response.ok && response.status !== 404) throw await databaseError(response);
      const etag = response.headers.get("ETag");
      const next = updateValue(current);
      if (next === undefined) return { committed: false, snapshot: new Snapshot(this.key, current) };
      const write = await fetch(auth.url, { method: next === null ? "DELETE" : "PUT", headers: { ...auth.headers, "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) }, body: next === null ? undefined : JSON.stringify(next) });
      if (write.status === 412) continue;
      if (!write.ok) throw await databaseError(write);
      return { committed: true, snapshot: new Snapshot(this.key, next) };
    }
    throw Object.assign(new Error("La base de datos está ocupada. Vuelve a intentarlo."), { statusCode: 409 });
  }
  push(value?: any) {
    const child = this.child(crypto.randomUUID());
    if (arguments.length) return child.set(value).then(() => child);
    return child;
  }
  private async request(method: string, value?: any): Promise<SnapshotLike> {
    const auth = this.requestAuthentication(this.url());
    const response = await fetch(auth.url, {
      method,
      headers: { ...auth.headers, ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
      ...(method !== "GET" && method !== "DELETE" ? { body: JSON.stringify(value) } : {}),
    });
    if (!response.ok) throw await databaseError(response);
    if (method === "DELETE") return new Snapshot(this.key, null);
    const data = await response.json().catch(() => null);
    return new Snapshot(this.key, data);
  }
  private url() {
    const configuredUrl = currentFirebaseRuntime().env.FIREBASE_DATABASE_URL.replace(/\/$/, "");
    if (configuredUrl !== DATABASE_URL) throw new Error("La función solo puede conectarse a la Realtime Database existente de laliga-brains en europe-west1.");
    const path = this.path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const url = new URL(`${DATABASE_URL}/${path}.json`);
    for (const [key, value] of Object.entries(this.queryOptions)) if (value !== undefined) url.searchParams.set(key, String(value));
    return url;
  }
  private requestAuthentication(url: URL): { url: URL; headers: Record<string, string> } {
    const requestUrl = new URL(url);
    const { databaseToken } = currentFirebaseRuntime();
    requestUrl.searchParams.delete("auth");
    requestUrl.searchParams.delete("access_token");
    if (databaseToken) requestUrl.searchParams.set("auth", databaseToken);
    return { url: requestUrl, headers: {} };
  }
}

async function databaseError(response: Response): Promise<Error> {
  const message = await response.text().catch(() => "");
  if (response.status === 401 || response.status === 403) return Object.assign(new Error("Firebase Realtime Database ha rechazado esta operación. Revisa las reglas de acceso."), { statusCode: 403 });
  const safeMessage = /Index not defined/i.test(message)
    ? "La consulta necesita un índice de Firebase que no está configurado."
    : `Firebase Realtime Database respondió con ${response.status}.`;
  return Object.assign(new Error(safeMessage), { statusCode: response.status >= 500 ? 503 : 400 });
}

export const firebaseDb = {
  ref(path = "") { return new DatabaseReference(path); },
};

export const firebaseAuth = {
  verifyIdToken(token: string, _checkRevoked?: boolean) { return verifyFirebaseIdToken(token, currentRuntimeEnv()); },
  async createUser() { throw new Error("Las cuentas se crean mediante Firebase Authentication REST."); },
  async deleteUser() { throw new Error("Firebase Auth Admin no está configurado; elimina la cuenta desde Firebase Console."); },
  async updateUser() { throw new Error("Las contraseñas de otras cuentas solo se pueden cambiar desde Firebase Console."); },
  async getUser() { throw new Error("La consulta de cuentas administrativas no está disponible sin Firebase Admin SDK."); },
  async setCustomUserClaims() { throw new Error("Las cuentas se autorizan mediante el perfil y las reglas de Realtime Database."); },
  async createCustomToken() { throw new Error("Los inicios de sesión usan Firebase Authentication REST."); },
  async revokeRefreshTokens() { throw new Error("La revocación administrativa requiere Firebase Admin SDK."); },
};

export const adminBucket = {
  file(_path: string) {
    return {
      async delete(_options?: unknown) { return undefined; },
      async getSignedUrl(_options?: unknown): Promise<[string]> { throw new Error("Las URLs firmadas requieren Firebase Storage Admin; usa getDownloadURL de Firebase Storage."); },
    };
  },
};

export type DataSnapshot = SnapshotLike;
export type Reference = DatabaseReference;
