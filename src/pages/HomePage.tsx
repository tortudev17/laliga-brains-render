import { useEffect, useMemo, useState } from "react";
import { endBefore, get, limitToLast, onValue, orderByChild, query, ref } from "firebase/database";
import { AlertCircle, CalendarDays, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { database, firebaseConfigured } from "../services/firebase/client";
import type { MatchRecord, TeamStats } from "../types/domain";

const MATCH_PAGE_SIZE = 8;

const emptyStats: TeamStats = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, streak: "—", recentResults: [] };

export function HomePage() {
  const [latestMatches, setLatestMatches] = useState<MatchRecord[]>([]);
  const [olderMatches, setOlderMatches] = useState<MatchRecord[]>([]);
  const [teamStats, setTeamStats] = useState<Record<string, TeamStats>>({});
  const [matchesLoading, setMatchesLoading] = useState(firebaseConfigured);
  const [statsLoading, setStatsLoading] = useState(firebaseConfigured);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderMatches, setHasOlderMatches] = useState(false);
  const [matchesError, setMatchesError] = useState("");
  const [statsError, setStatsError] = useState("");
  const [olderError, setOlderError] = useState("");
  const [retry, setRetry] = useState(0);
  const loading = matchesLoading || statsLoading;
  const error = matchesError || statsError;

  useEffect(() => {
    if (!firebaseConfigured || !database) { setMatchesLoading(false); setStatsLoading(false); return; }
    setMatchesLoading(true); setStatsLoading(true); setMatchesError(""); setStatsError("");
    const unsubscribeMatches = onValue(query(ref(database, "laligaBrains/football/matches"), orderByChild("playedAt"), limitToLast(MATCH_PAGE_SIZE)), (snapshot) => {
      const value = snapshot.val() as Record<string, Omit<MatchRecord, "id">> | null;
      const rows = value ? Object.entries(value).map(([id, match]) => ({ ...match, id })) : [];
      setLatestMatches(rows);
      setHasOlderMatches(rows.length === MATCH_PAGE_SIZE);
      setMatchesLoading(false);
      setMatchesError("");
    }, () => { setMatchesError("No se han podido cargar los resultados recientes."); setMatchesLoading(false); });
    const unsubscribeStats = onValue(ref(database, "laligaBrains/football/teamStats"), (snapshot) => {
      setTeamStats((snapshot.val() ?? {}) as Record<string, TeamStats>);
      setStatsLoading(false);
      setStatsError("");
    }, () => { setStatsError("No se han podido cargar las estadísticas de fútbol."); setStatsLoading(false); });
    return () => { unsubscribeMatches(); unsubscribeStats(); };
  }, [retry]);

  const stats3 = normalizeTeamStats(teamStats["3ESO"]);
  const stats4 = normalizeTeamStats(teamStats["4ESO"]);
  const matches = useMemo(() => {
    const byId = new Map([...olderMatches, ...latestMatches].map((match) => [match.id, match]));
    return [...byId.values()].sort((a, b) => a.playedAt - b.playedAt || a.id.localeCompare(b.id));
  }, [olderMatches, latestMatches]);
  const sortedMatches = useMemo(() => [...matches].reverse(), [matches]);
  const totalMatches = Math.max(stats3.played, stats4.played, matches.length);

  const loadOlderMatches = async () => {
    if (!database || !hasOlderMatches || loadingOlder || !matches.length) return;
    const oldest = matches[0];
    setLoadingOlder(true);
    try {
      const snapshot = await get(query(ref(database, "laligaBrains/football/matches"), orderByChild("playedAt"), endBefore(oldest.playedAt, oldest.id), limitToLast(MATCH_PAGE_SIZE)));
      const value = snapshot.val() as Record<string, Omit<MatchRecord, "id">> | null;
      const rows = value ? Object.entries(value).map(([id, match]) => ({ ...match, id })) : [];
      setOlderMatches((current) => {
        const byId = new Map([...rows, ...current].map((match) => [match.id, match]));
        return [...byId.values()].sort((a, b) => a.playedAt - b.playedAt || a.id.localeCompare(b.id));
      });
      setHasOlderMatches(rows.length === MATCH_PAGE_SIZE);
      setOlderError("");
    } catch {
      setOlderError("No se han podido cargar los partidos anteriores.");
    } finally {
      setLoadingOlder(false);
    }
  };

  return <>
    <div className="page-heading"><div><h1>LaLiga Brains</h1><p>La rivalidad de 3 ESO y 4 ESO, partido a partido.</p></div><Link to="/partidos" className="link-arrow">Historial completo <ChevronRight size={17} /></Link></div>
    {!firebaseConfigured && <div className="setup-notice"><AlertCircle size={18} /><span>Configura <code>VITE_FIREBASE_DATABASE_URL</code> para conectar los datos de tu proyecto Firebase.</span></div>}
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="button button-secondary button-small" onClick={()=>setRetry((value)=>value+1)}>Reintentar</button></div>}
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

    <section className="performance-section" aria-label="Totales de la rivalidad">
      <div className="section-heading"><div><h2>Totales de la rivalidad</h2><p>Balance acumulado de todos los partidos registrados</p></div></div>
      <div className="performance-grid">
        <AggregateChart threeValue={stats3.goalsFor} fourValue={stats4.goalsFor} title="Goles totales" unit="goles" loading={statsLoading} />
        <AggregateChart threeValue={stats3.points} fourValue={stats4.points} title="Puntos totales" unit="puntos" loading={statsLoading} />
      </div>
    </section>

    <section className="match-history-section">
      <div className="section-heading"><div><h2>Historial de partidos</h2><p>{totalMatches} {totalMatches === 1 ? "partido registrado" : "partidos registrados"} en total</p></div><Link to="/partidos" className="link-arrow">Ver partidos <ChevronRight size={17} /></Link></div>
      <div className="table-scroll match-history-scroll"><table className="match-table match-history-table"><thead><tr><th>Fecha</th><th className="match-team-column">Local</th><th className="center">Resultado</th><th className="match-team-column">Visitante</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={4} className="table-empty">Cargando resultados…</td></tr> : sortedMatches.length ? sortedMatches.map((match) => <tr key={match.id}><td>{formatDate(match.playedAt)}</td><td className="match-team-column">3 ESO</td><td className="score-cell"><span className="score-desktop">{match.score3ESO} — {match.score4ESO}</span><span className="score-mobile"><span>3 ESO <b>{match.score3ESO}</b></span><span>4 ESO <b>{match.score4ESO}</b></span></span></td><td className="match-team-column">4 ESO</td></tr>) : <tr><td colSpan={4} className="table-empty"><div className="empty-ball">⚽</div><strong>Aún no hay partidos disputados</strong><span>Cuando se juegue el primer partido, aparecerá aquí el historial completo.</span></td></tr>}</tbody>
      </table></div>
      {sortedMatches.length > 0 && <div className="table-footnote"><CalendarDays size={15} /> Mostrando {sortedMatches.length} de {totalMatches} {totalMatches === 1 ? "partido" : "partidos"} registrados</div>}
      {hasOlderMatches && <><button className="button button-secondary load-older-matches" disabled={loadingOlder} onClick={() => void loadOlderMatches()}>{loadingOlder ? "Cargando…" : "Cargar partidos anteriores"}</button>{olderError&&<p className="inline-error" role="alert">{olderError} <button className="text-button-dark" onClick={()=>void loadOlderMatches()}>Reintentar</button></p>}</>}
    </section>
  </>;
}

function AggregateChart({ threeValue, fourValue, title, unit, loading = false }: { threeValue: number; fourValue: number; title: string; unit: string; loading?: boolean }) {
  const maxValue = Math.max(threeValue, fourValue, 1);
  const teams = [{ name: "3 ESO", value: threeValue, className: "three" }, { name: "4 ESO", value: fourValue, className: "four" }];
  return <article className="performance-chart">
    <h3>{title}</h3>
    <div className="aggregate-chart" role="img" aria-label={loading?`${title}: cargando datos`:`${title}: 3 ESO ${threeValue} ${unit}, 4 ESO ${fourValue} ${unit}`}>
      {teams.map((team) => <div className="aggregate-chart-row" key={team.name}>
        <div className="aggregate-chart-label"><strong>{team.name}</strong><span>{loading?"—":`${team.value} ${unit}`}</span></div>
        <div className={`aggregate-chart-track${loading?" is-loading":""}`}><span className={`aggregate-chart-bar ${team.className}`} style={{ width: `${loading?0:team.value === 0 ? 0 : Math.max(4, team.value / maxValue * 100)}%` }} /></div>
      </div>)}
    </div>
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
