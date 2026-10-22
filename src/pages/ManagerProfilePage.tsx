import { useEffect, useState } from "react";
import { ArrowLeft, BadgeEuro, ShieldCheck, Users } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "../services/api/client";
import { UserAvatar } from "../components/UserAvatar";
import "../styles/manager-profile.css";

type ManagerProfile = {
  uid: string;
  username: string;
  displayName: string;
  nickname: string;
  photoPath: string;
  role: string;
  fantasyPlayerCount: number;
  fantasyRosterLimit: number;
  fantasyAssetValue: number;
  fantasyPlayers: Array<{ id: string; name: string; value: number }>;
};

export function ManagerProfilePage() {
  const { uid = "" } = useParams();
  const [profile, setProfile] = useState<ManagerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void apiRequest<{ profile: ManagerProfile }>(`manager-profile?id=${encodeURIComponent(uid)}`, undefined, { method: "GET" })
      .then((result) => { if (!cancelled) setProfile(result.profile); })
      .catch((problem) => { if (!cancelled) setError(problem instanceof Error ? problem.message : "No se pudo cargar el perfil."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uid]);

  if (loading) return <section className="feature-page manager-profile-page"><div className="manager-profile-skeleton" role="status">Cargando perfil…</div></section>;
  if (!profile) return <section className="feature-page manager-profile-page"><Link className="manager-back-link" to="/fantasy"><ArrowLeft size={16}/>Volver a Fantasy</Link><div className="manager-profile-empty"><h1>No se encuentra el perfil</h1><p>{error || "Este perfil ya no está disponible."}</p></div></section>;

  return <section className="feature-page manager-profile-page">
    <Link className="manager-back-link" to="/fantasy"><ArrowLeft size={16}/>Volver a Fantasy</Link>
    <header className="manager-profile-header">
      <UserAvatar photoPath={profile.photoPath} name={profile.displayName} size={78} className="manager-profile-avatar" />
      <div className="manager-profile-identity"><span className="manager-profile-kicker"><ShieldCheck size={14}/> PERFIL DE MÁNAGER</span><h1>{profile.displayName}</h1><p>@{profile.username}{profile.nickname ? ` · ${profile.nickname}` : ""}</p></div>
      <div className="manager-profile-role">{roleLabel(profile.role)}</div>
    </header>
    <section className="manager-profile-stat" aria-label="Resumen del equipo Fantasy">
      <span><Users size={20}/></span><div><small>Jugadores en plantilla</small><strong>{profile.fantasyPlayerCount}<em> / {profile.fantasyRosterLimit}</em></strong></div>
      <div className="manager-profile-progress"><i style={{ width: `${Math.min(100, profile.fantasyPlayerCount / Math.max(profile.fantasyRosterLimit, 1) * 100)}%` }}/></div>
      <div className="manager-profile-total"><small>Valor de la plantilla</small><strong>{profile.fantasyAssetValue.toLocaleString("es-ES")} <em>monedas</em></strong></div>
    </section>
    <section className="manager-profile-roster">
      <div className="manager-profile-section-heading"><div><span>PLANTILLA ACTUAL</span><h2>Jugadores Fantasy</h2></div><BadgeEuro size={20}/></div>
      {profile.fantasyPlayers.length ? <div className="manager-profile-player-list">{profile.fantasyPlayers.map((player, index) => <article className="manager-profile-player" key={player.id} style={{ animationDelay: `${index * 45}ms` }}>
        <div className="manager-profile-player-mark">{player.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toLocaleUpperCase("es-ES") || "J"}</div><strong>{player.name}</strong><span>{player.value.toLocaleString("es-ES")} <small>monedas</small></span>
      </article>)}</div> : <div className="manager-profile-no-players"><Users size={23}/><strong>Sin jugadores Fantasy</strong><p>Este mánager todavía no tiene jugadores en su plantilla.</p></div>}
    </section>
  </section>;
}

function roleLabel(role: string) { return role === "player_3eso" ? "Jugador de 3 ESO" : role === "player_4eso" ? "Jugador de 4 ESO" : "Espectador"; }
