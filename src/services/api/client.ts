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

async function storageRequest(path: string, method: "GET" | "POST" | "DELETE", body?: File): Promise<Response> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Inicia sesión para acceder a las imágenes.");
  const params = new URLSearchParams({ path });
  const headers = new Headers({ Accept: method === "GET" ? "image/*" : "application/json" });
  headers.set("Authorization", `Bearer ${await currentUser.getIdToken()}`);
  if (body) headers.set("Content-Type", body.type);
  const response = await fetch(`${baseUrl}storage-proxy?${params.toString()}`, { method, headers, ...(body ? { body } : {}) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || "No se pudo completar la operación con la imagen.");
  }
  return response;
}

export async function uploadFirebaseFile(path: string, file: File) {
  await storageRequest(path, "POST", file);
}

export async function deleteFirebaseFile(path: string) {
  await storageRequest(path, "DELETE");
}

export async function downloadFirebaseFile(path: string): Promise<Blob> {
  return storageRequest(path, "GET").then((response) => response.blob());
}

export async function firebaseRead<T>(path: string): Promise<T | null> {
  const params = new URLSearchParams({ path });
  const result = await apiRequest<{ value: T | null }>(`firebase-proxy?${params.toString()}`, undefined, { method: "GET" });
  return result.value;
}

export function normalizeUsername(username: string) {
  return username.normalize("NFKC").trim().toLowerCase();
}

export async function registerAccount(username: string, password: string, role: UserProfile["role"]) {
  const normalized = normalizeUsername(username);
  const result = await apiRequest<{ pendingApproval: boolean }>("register", { username: normalized, password, role });
  return result;
}

