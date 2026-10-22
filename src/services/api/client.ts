import type { Auth } from "firebase/auth";
import type { UserProfile } from "../../types/domain";
import { auth } from "../firebase/client";

interface ApiOptions { method?: string; headers?: HeadersInit; auth?: Auth | null }
const baseUrl = "/api/";

export async function apiRequest<T>(path: string, body?: unknown, options: ApiOptions = {}): Promise<T> {
  const [endpoint, search = ""] = path.split("?");
  const caller = options.auth === null ? null : options.auth ?? auth;
  const currentUser = caller?.currentUser;
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (currentUser && endpoint !== "piero-pin") headers.set("Authorization", `Bearer ${await currentUser.getIdToken()}`);
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  const url = `${baseUrl}${endpoint}${search ? `?${search}` : ""}`;
  const response = await fetch(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "No se pudo completar la solicitud.");
  return payload;
}

export function normalizeUsername(username: string) {
  return username.normalize("NFKC").trim().toLowerCase();
}

export async function registerAccount(username: string, password: string, role: UserProfile["role"]) {
  const normalized = normalizeUsername(username);
  const result = await apiRequest<{ pendingApproval: boolean }>("register", { username: normalized, password, role });
  return result;
}

