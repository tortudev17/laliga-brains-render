import { useEffect, useMemo, useState } from "react";
import { limitToLast, onValue, orderByChild, query, ref } from "firebase/database";
import { AlertCircle, CalendarDays, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { database, firebaseConfigured } from "../services/firebase/client";
import type { MatchRecord, TeamStats } from "../types/domain";
import { buildPerformanceSeries, type PerformanceMetric } from "../utils/performance-series";

const emptyStats: TeamStats = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, streak: "—", recentResults: [] };

export function HomePage() {
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [teamStats, setTeamStats] = useState<Record<string, TeamStats>>({});
  const [loading, setLoading] = useState(firebaseConfigured);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseConfigured || !database) { setLoading(false); return; }
    const unsubscribeMatches = onValue(query(ref(database, "laligaBrains/football/matches"), orderByChild("playedAt"), limitToLast(8)), (snapshot) => {
      const value = snapshot.val() as Record<string, Omit<MatchRecord, "id">> | null;
      setMatches(value ? Object.entries(value).map(([id, match]) => ({ ...match, id })) : []);
    }, () => { setError("No se han podido cargar los resultados recientes."); setLoading(false); });
    const unsubscribeStats = onValue(ref(database, "laligaBrains/football/teamStats"), (snapshot) => {
      setTeamStats((snapshot.val() ?? {}) as Record<string, TeamStats>);
      setLoading(false);
      setError("");
    }, () => { setError("No se han podido cargar las estadísticas de fútbol."); setLoading(false); });
    return () => { unsubscribeMatches(); unsubscribeStats(); };
  }, []);

  const stats3 = normalizeTeamStats(teamStats["3ESO"]);
  const stats4 = normalizeTeamStats(teamStats["4ESO"]);
  const sortedMatches = useMemo(() => [...matches].sort((a, b) => b.playedAt - a.playedAt), [matches]);
  const recentChronological = useMemo(() => [...matches].sort((a, b) => a.playedAt - b.playedAt), [matches]);

  return <>
    <div className="page-heading"><div><h1>LaLiga Brains</h1><p>La rivalidad de 3 ESO y 4 ESO, partido a partido.</p></div><Link to="/partidos" className="link-arrow">Historial completo <ChevronRight size={17} /></Link></div>
    {!firebaseConfigured && <div className="setup-notice"><AlertCircle size={18} /><span>Configura <code>VITE_FIREBASE_DATABASE_URL</code> para conectar los datos de tu proyecto Firebase.</span></div>}
    {error && <div className="error-banner" role="alert">{error} Se volverá a intentar en tiempo real.</div>}
    <section className="scoreboard" aria-label="Estadísticas de la rivalidad">
      <TeamPanel team="3 ESO" stats={stats3} side="left" />
      <div className="comparison">
        <div className="comparison-title"><span>Estadísticas</span><i /></div>
        <StatRow label="Partidos jugados" left={stats3.played} right={stats4.played} />
        <StatRow label="Victorias" left={stats3.wins} right={stats4.wins} />
        <StatRow label="Empates" left={stats3.draws} right={stats4.draws} />
        <StatRow label="Derrotas" left={stats3.losses} right={stats4.losses} />
        <StatRow label="Goles a favor" left={stats3.goalsFor} right={stats4.goalsFor} />
        <StatRow label="Goles en contra" left={stats3.goalsAgainst} right={stats4.goalsAgainst} />
        <StatRow label="Diferencia de goles" left={stats3.goalDifference} right={stats4.goalDifference} />
        <StatRow label="Puntos" left={stats3.points} right={stats4.points} strong />
        <StatRow label="Racha actual" left={stats3.streak} right={stats4.streak} />
        <div className="recent-row"><span className="recent-results">{resultDots(stats3.recentResults)}</span><span>Últimos resultados</span><span className="recent-results right-results">{resultDots(stats4.recentResults)}</span></div>
      </div>
      <TeamPanel team="4 ESO" stats={stats4} side="right" />
    </section>

    <section className="performance-section" aria-label="Evolución de la rivalidad">
      <div className="section-heading"><div><h2>Rendimiento reciente</h2><p>Puntos y goles en los últimos ocho partidos</p></div></div>
      <div className="performance-grid">
        <PerformanceChart matches={recentChronological} metric="points" title="Puntos por partido" />
        <PerformanceChart matches={recentChronological} metric="goals" title="Goles por partido" />
      </div>
    </section>

    <section className="match-history-section">
      <div className="section-heading"><div><h2>Historial de partidos</h2><p>Todos los resultados de la rivalidad</p></div><Link to="/partidos" className="link-arrow">Ver partidos <ChevronRight size={17} /></Link></div>
      <div className="table-scroll match-history-scroll"><table className="match-table match-history-table"><thead><tr><th>Fecha</th><th className="match-team-column">Local</th><th className="center">Resultado</th><th className="match-team-column">Visitante</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={4} className="table-empty">Cargando resultados…</td></tr> : sortedMatches.length ? sortedMatches.slice(0, 8).map((match) => <tr key={match.id}><td>{formatDate(match.playedAt)}</td><td className="match-team-column">3 ESO</td><td className="score-cell"><span className="score-desktop">{match.score3ESO} — {match.score4ESO}</span><span className="score-mobile"><span>3 ESO <b>{match.score3ESO}</b></span><span>4 ESO <b>{match.score4ESO}</b></span></span></td><td className="match-team-column">4 ESO</td></tr>) : <tr><td colSpan={4} className="table-empty"><div className="empty-ball">⚽</div><strong>Aún no hay partidos disputados</strong><span>Cuando se juegue el primer partido, aparecerá aquí el historial completo.</span></td></tr>}</tbody>
      </table></div>
      {sortedMatches.length > 0 && <div className="table-footnote"><CalendarDays size={15} /> {sortedMatches.length} {sortedMatches.length === 1 ? "partido registrado" : "partidos registrados"}</div>}
    </section>
  </>;
}

function PerformanceChart({ matches, metric, title }: { matches: MatchRecord[]; metric: PerformanceMetric; title: string }) {
  const points = buildPerformanceSeries(matches, metric);
  const maxValue = Math.max(metric === "points" ? 3 : 1, ...points.flatMap((point) => [point.threeEso, point.fourEso]));
  const plot = (key: "threeEso" | "fourEso") => points.map((point, index) => {
    const x = points.length < 2 ? 300 : 40 + index * (520 / (points.length - 1));
    const y = 155 - point[key] / maxValue * 125;
    return `${x},${y}`;
  }).join(" ");
  return <article className="performance-chart">
    <h3>{title}</h3>
    {points.length ? <>
      <div className="chart-legend"><span><i className="chart-dot three"/>3 ESO</span><span><i className="chart-dot four"/>4 ESO</span></div>
      <svg viewBox="0 0 600 190" role="img" aria-label={`${title}, comparativa de 3 ESO y 4 ESO`} preserveAspectRatio="none">
        {[0, 1, 2, 3].map((index) => <line key={index} x1="40" x2="560" y1={30 + index * 41.5} y2={30 + index * 41.5} className="chart-gridline" />)}
        <text x="12" y="34" className="chart-axis-label">{maxValue}</text><text x="22" y="159" className="chart-axis-label">0</text>
        <polyline points={plot("threeEso")} className="chart-line chart-line-three" />
        <polyline points={plot("fourEso")} className="chart-line chart-line-four" />
        {points.map((point, index) => {
          const x = points.length < 2 ? 300 : 40 + index * (520 / (points.length - 1));
          return <g key={point.matchId}>
            <circle cx={x} cy={155 - point.threeEso / maxValue * 125} r="4" className="chart-point-three"><title>{point.label}: 3 ESO, {point.threeEso}</title></circle>
            <circle cx={x} cy={155 - point.fourEso / maxValue * 125} r="4" className="chart-point-four"><title>{point.label}: 4 ESO, {point.fourEso}</title></circle>
          </g>;
        })}
      </svg>
      <div className="chart-end-labels"><span>{points[0].label}</span><span>{points[points.length - 1].label}</span></div>
    </> : <div className="chart-empty">El gráfico aparecerá cuando haya resultados.</div>}
  </article>;
}

function TeamPanel({ team, stats, side }: { team: string; stats: TeamStats; side: "left" | "right" }) {
  return <div className={`team-panel ${side}`}>
    <TeamCrest team={team} />
    <h2>{team}</h2>
    <div className="team-total"><strong>{stats.points}</strong><span>puntos</span></div>
    <div className="team-results" aria-label={`Últimos resultados de ${team}`}>
      {stats.recentResults.length ? stats.recentResults.map((result, index) => <span key={index} className={`result-mark result-${result.toLowerCase()}`}>{result}</span>) : <span className="no-results">Sin resultados</span>}
    </div>
  </div>;
}

function normalizeTeamStats(stats?: Partial<TeamStats>): TeamStats {
  return {
    ...emptyStats,
    ...stats,
    recentResults: Array.isArray(stats?.recentResults) ? stats.recentResults : [],
  };
}

function TeamCrest({ team }: { team: string }) {
  return <svg className="team-crest" viewBox="0 0 100 112" role="img" aria-label={`Escudo de ${team}`}><path d="M8 8h84v51c0 22-16 37-42 47C24 96 8 81 8 59V8Z" fill="#fff" stroke="currentColor" strokeWidth="4"/><path d="M15 15h70v43c0 18-13 31-35 40-22-9-35-22-35-40V15Z" fill="none" stroke="currentColor" strokeWidth="2"/><text x="50" y="42" textAnchor="middle" fontSize="16" fontWeight="800" fill="currentColor">{team}</text><circle cx="50" cy="70" r="15" fill="currentColor"/><path d="m50 60 5 4-2 6h-6l-2-6 5-4Zm-10 8 4 2 1 6-4 3-4-4 3-7Zm20 0 3 7-4 4-4-3 1-6 4-2ZM43 81l4-4h6l4 4-3 4h-8l-3-4Z" fill="#fff"/></svg>;
}

function StatRow({ label, left, right, strong = false }: { label: string; left: number | string; right: number | string; strong?: boolean }) {
  return <div className={`stat-row ${strong ? "stat-strong" : ""}`}><strong>{left}</strong><span>{label}</span><strong>{right}</strong></div>;
}

function resultDots(results: TeamStats["recentResults"]) {
  return results.length ? results.map((result, i) => <b key={i} className={`result-mark result-${result.toLowerCase()}`}>{result}</b>) : <span className="empty-dash">—</span>;
}

function formatDate(timestamp: number) { return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Madrid" }).format(new Date(timestamp)); }
