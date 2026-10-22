import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { mutateEconomy } from "../lib/economy";
import { asBadRequest, json, run, bodyOf, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const { uid, profile } = await requireUser(event);
  const body = bodyOf(event);
  const updates: Record<string, unknown> = { updatedAt: Date.now() };
  const displayName = Object.hasOwn(body, "displayName") ? String(body.displayName ?? "").trim() : undefined;
  const nickname = Object.hasOwn(body, "nickname") ? String(body.nickname ?? "").trim() : undefined;
  const photoPath = Object.hasOwn(body, "photoPath") ? String(body.photoPath ?? "").trim() : undefined;
  if (displayName !== undefined) {
    if (displayName.length < 2 || displayName.length > 40) throw asBadRequest("El nombre visible debe tener entre 2 y 40 caracteres.");
    updates.displayName = displayName;
  }
  if (nickname !== undefined) {
    if (nickname.length > 30) throw asBadRequest("El apodo no puede superar los 30 caracteres.");
    updates.nickname = nickname || null;
  }
  if (photoPath !== undefined) {
    if (photoPath && !new RegExp(`^profilePhotos/${uid}/[a-zA-Z0-9._-]{1,180}$`).test(photoPath)) throw asBadRequest("La foto de perfil no es válida.");
    updates.photoPath = photoPath || null;
  }
  if (Object.keys(updates).length === 1) throw asBadRequest("No hay cambios para guardar.");
  await firebaseDb.ref(`laligaBrains/identity/users/${uid}`).update(updates);
  const playerId = String(profile.playerId ?? "");
  if (playerId && displayName !== undefined) {
    await firebaseDb.ref(`laligaBrains/identity/playerProfiles/${playerId}/name`).set(displayName);
    await mutateEconomy((state) => { if (state.fantasyPlayers[playerId]) state.fantasyPlayers[playerId]!.name = displayName; return true; });
  }
  return json(200, { profile: { displayName: displayName ?? profile.displayName, nickname: nickname ?? profile.nickname, photoPath: photoPath ?? profile.photoPath } });
});
