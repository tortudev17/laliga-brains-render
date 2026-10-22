import type { Handler } from "../lib/runtime-types";
import { firebaseDb } from "../lib/firebase-rest";
import { requireUser } from "../lib/authentication";
import { json, run, methodNotAllowed } from "../lib/http";

export const handler: Handler = async (event) => run(async () => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  await requireUser(event);
  const uid = event.queryStringParameters?.id ?? "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) return json(400, { error: "Perfil no válido." });

  const [profileSnapshot, playersSnapshot] = await Promise.all([
    firebaseDb.ref(`laligaBrains/identity/users/${uid}`).get(),
    firebaseDb.ref("laligaBrains/fantasy/players").get(),
  ]);
  const profile = profileSnapshot.val() as { username?: string; displayName?: string; nickname?: string; photoPath?: string; role?: string; accountStatus?: string } | null;
  if (!profile || profile.accountStatus !== "active") return json(404, { error: "No se encontró este perfil." });

  const players = Object.entries((playersSnapshot.val() ?? {}) as Record<string, { id?: string; name?: string; value?: number; ownerUid?: string | null; archived?: boolean }>)
    .filter(([, player]) => player.ownerUid === uid && player.archived !== true)
    .map(([id, player]) => ({ id, name: String(player.name ?? "Jugador"), value: Number(player.value ?? 50) }))
    .sort((a, b) => a.name.localeCompare(b.name, "es-ES"));

  return json(200, {
    profile: {
      uid,
      username: String(profile.username ?? ""),
      displayName: String(profile.displayName ?? profile.username ?? "Mánager"),
      nickname: String(profile.nickname ?? ""),
      photoPath: String(profile.photoPath ?? ""),
      role: String(profile.role ?? "spectator"),
      fantasyPlayerCount: players.length,
      fantasyPlayers: players,
    },
  });
});
