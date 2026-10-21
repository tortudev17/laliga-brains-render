import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Coins, Trophy, UserRound } from "lucide-react";
import { apiRequest } from "../services/api/client";

type PlayerData = {
  id: string; name: string; ghost: boolean; totalGoals: number; rank: number | null;
  fantasy: { value: number; permanentInvestment: number; performanceValue: number; ownerName: string | null } | null;
  matchContributions: Array<{ matchId: string; goals: number; playedAt: number; score3ESO: number; score4ESO: number }>;
};

export function PlayerProfilePage() {
  const { playerId = "" } = useParams();
  const [player, setPlayer] = useState<PlayerData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ player: PlayerData }>(`player-profile?id=${encodeURIComponent(playerId)}`, undefined, { method: "GET" })
      .then((result) => { if (!cancelled) setPlayer(result.player); })
      .catch((problem) => { if (!cancelled) setError(problem instanceof Error ? problem.message : "No se pudo cargar el perfil."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [playerId]);

  if (loading) return <section className="feature-page"><p className="muted-note">Cargando perfil…</p></section>;
  if (!player) return <section className="feature-page"><div className="page-heading"><div><h1>Perfil de jugador</h1><p>{error || "No se encontró este jugador."}</p></div></div><Link className="link-arrow" to="/goleadores"><ArrowLeft size={16}/> Volver a goleadores</Link></section>;

  return <section className="feature-page"><div className="page-heading"><div><h1>{player.name}</h1><p>Jugador de 4 ESO{player.ghost ? " · perfil fantasma" : ""}</p></div><Link className="link-arrow" to="/goleadores"><ArrowLeft size={16}/> Volver a goleadores</Link></div>
    <div className="player-profile-grid"><div className="player-profile-card"><span className="player-profile-icon"><UserRound size={23}/></span><div><small>Goles totales</small><strong>{player.totalGoals}</strong></div></div><div className="player-profile-card"><span className="player-profile-icon"><Trophy size={23}/></span><div><small>Posición goleadora</small><strong>{player.rank ? `#${player.rank}` : "—"}</strong></div></div><div className="player-profile-card"><span className="player-profile-icon"><Coins size={23}/></span><div><small>Valor Fantasy</small><strong>{player.fantasy ? `${player.fantasy.value} monedas` : "Sin perfil Fantasy"}</strong></div></div></div>
    {player.fantasy && <section className="player-fantasy-summary"><h2>Información Fantasy</h2><p>Inversión permanente: <strong>{player.fantasy.permanentInvestment} monedas</strong></p><p>Valor por rendimiento: <strong>{player.fantasy.performanceValue} monedas</strong></p><p>Propietario actual: <strong>{player.fantasy.ownerName ?? "Mercado"}</strong></p></section>}
    <section className="match-history-section player-match-history"><div className="section-heading"><div><h2>Goles por partido</h2><p>Contribuciones registradas de este jugador</p></div></div><div className="table-scroll"><table className="match-table"><thead><tr><th>Fecha</th><th>Resultado</th><th>Goles</th></tr></thead><tbody>{player.matchContributions.length ? player.matchContributions.map((item) => <tr key={item.matchId}><td>{new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" }).format(item.playedAt)}</td><td className="score-cell">{item.score3ESO} — {item.score4ESO}</td><td><strong>{item.goals}</strong></td></tr>) : <tr><td colSpan={3} className="table-empty">Todavía no hay goles registrados para este jugador.</td></tr>}</tbody></table></div></section>
  </section>;
}
