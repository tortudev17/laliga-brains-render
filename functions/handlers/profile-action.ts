import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { mutateEconomy } from "../lib/economy";
import { asBadRequest, json, run, bodyOf, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const { uid, profile } = await requireUser(event);
  const body = bodyOf(event);
  const displayName = String(body.displayName ?? "").trim();
  const nickname = String(body.nickname ?? "").trim();
  const photoPath = String(body.photoPath ?? "").trim();
  if (displayName.length < 2 || displayName.length > 40) throw asBadRequest("El nombre visible debe tener entre 2 y 40 caracteres.");
  if (nickname.length > 30) throw asBadRequest("El apodo no puede superar los 30 caracteres.");
  if (photoPath && !new RegExp(`^profilePhotos/${uid}/[a-zA-Z0-9._-]{1,180}$`).test(photoPath)) throw asBadRequest("La foto de perfil no es válida.");
  const updates: Record<string, unknown> = { displayName, nickname: nickname || null, photoPath: photoPath || null, updatedAt: Date.now() };
  await firebaseDb.ref(`laligaBrains/identity/users/${uid}`).update(updates);
  const playerId = String(profile.playerId ?? "");
  if (playerId) {
    await firebaseDb.ref(`laligaBrains/identity/playerProfiles/${playerId}/name`).set(displayName);
    await mutateEconomy((state) => { if (state.fantasyPlayers[playerId]) state.fantasyPlayers[playerId]!.name = displayName; return true; });
  }
  return json(200, { profile: { displayName, nickname, photoPath } });
});
