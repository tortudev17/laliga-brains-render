import type { HandlerEvent, HandlerResponse } from "./runtime-types";

export function json(statusCode: number, payload: unknown): HandlerResponse {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Authorization" }, body: JSON.stringify(payload) };
}

export function bodyOf(event: HandlerEvent): Record<string, unknown> {
  if (!event.body) return {};
  try {
    const value = JSON.parse(event.body);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw Object.assign(new Error("El cuerpo de la solicitud no es válido."), { statusCode: 400 }); }
}

export function errorResponse(error: unknown): HandlerResponse {
  const status = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 500;
  const message = status < 500 && error instanceof Error ? error.message : "No se pudo completar la operación. Inténtalo de nuevo más tarde.";
  if (status >= 500) console.error("Error de Cloudflare Function:", error);
  return json(status, { error: message });
}

export function methodNotAllowed(methods: string[]) { return json(405, { error: `Método no permitido. Usa ${methods.join(" o ")}.` }); }

export function asBadRequest(message: string) { return Object.assign(new Error(message), { statusCode: 400 }); }
export function asForbidden(message = "No tienes permiso para esta acción.") { return Object.assign(new Error(message), { statusCode: 403 }); }
export function asUnauthorized(message = "No autorizado.") { return Object.assign(new Error(message), { statusCode: 401 }); }

export async function run(handler: () => Promise<HandlerResponse>): Promise<HandlerResponse> {
  try { return await handler(); }
  catch (error) { return errorResponse(error); }
}
