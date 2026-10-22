import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { firebaseRead } from "../services/api/client";
import { firebaseConfigured } from "../services/firebase/client";
import type { MatchRecord } from "../types/domain";

const pageSize = 30;

export function MatchesPage() {
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [loading, setLoading] = useState(firebaseConfigured);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [olderError, setOlderError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!firebaseConfigured) { setLoading(false); return; }
    setLoading(true);
    setError("");
    let active = true;
    void firebaseRead<Record<string, Omit<MatchRecord, "id">>>("laligaBrains/football/matches").then((value) => {
      if (!active) return;
      const rows = Object.entries(value ?? {}).map(([id, item]) => ({ ...item, id }))
        .sort((a, b) => b.playedAt - a.playedAt || b.id.localeCompare(a.id));
      setMatches(rows.slice(0, pageSize));
      setHasMore(rows.length > pageSize);
    }).catch(() => {
      if (active) setError("No se han podido cargar los partidos. Comprueba la conexión y vuelve a intentarlo.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  const loadOlder = async () => {
    if (!matches.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const oldest = matches.reduce((previous, match) => match.playedAt < previous.playedAt || (match.playedAt === previous.playedAt && match.id < previous.id) ? match : previous);
      const value = await firebaseRead<Record<string, Omit<MatchRecord, "id">>>("laligaBrains/football/matches");
      const older = Object.entries(value ?? {}).map(([id, item]) => ({ ...item, id }))
        .filter((match) => match.playedAt < oldest.playedAt || (match.playedAt === oldest.playedAt && match.id < oldest.id));
      setMatches((current) => [...current, ...older].sort((a, b) => b.playedAt - a.playedAt || b.id.localeCompare(a.id)));
      setHasMore(false);
      setOlderError("");
    } catch {
      setOlderError("No se han podido cargar los partidos anteriores.");
    } finally { setLoadingMore(false); }
  };

  return <>
    <div className="page-heading"><div><h1>Partidos</h1><p>Resultados y memoria de la rivalidad.</p></div></div>
    <div className="table-scroll match-history-scroll"><table className="match-table match-history-table match-list-table"><thead><tr><th>Fecha</th><th className="match-team-column">Local</th><th className="center">Resultado</th><th className="match-team-column">Visitante</th><th>Goleadores de 4 ESO</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={5} className="table-empty"><span className="inline-loading"><i aria-hidden="true"/>Cargando partidos…</span></td></tr> : error ? <tr><td colSpan={5} className="table-empty"><div className="table-error"><strong>No se ha podido cargar el historial</strong><span>{error}</span><button className="button button-secondary button-small" onClick={()=>setRetry((value)=>value+1)}>Reintentar</button></div></td></tr> : matches.length ? matches.map((match) => <tr key={match.id}><td>{new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" }).format(match.playedAt)}</td><td className="match-team-column">3 ESO</td><td className="score-cell"><span className="score-desktop">{match.score3ESO} — {match.score4ESO}</span><span className="score-mobile"><span>3 ESO <b>{match.score3ESO}</b></span><span>4 ESO <b>{match.score4ESO}</b></span></span></td><td className="match-team-column">4 ESO</td><td className="scorers-cell">{Object.entries(match.goalscorers4ESO ?? {}).map(([id, goals]) => `${match.goalscorerNames?.[id] ?? id} ×${goals}`).join(", ") || "—"}</td></tr>) : <tr><td colSpan={5} className="table-empty"><div className="empty-ball">⚽</div><strong>Aún no hay partidos</strong><span>Los resultados se publicarán aquí después de cada encuentro.</span></td></tr>}
    </tbody></table></div>
    {!loading && !error && matches.length > 0 && hasMore && <div className="load-more-row"><button className="button button-secondary" disabled={loadingMore} onClick={() => void loadOlder()}>{loadingMore ? "Cargando…" : "Cargar partidos anteriores"}</button>{olderError&&<p className="inline-error" role="alert">{olderError} <button className="text-button-dark" onClick={()=>void loadOlder()}>Reintentar</button></p>}</div>}
    {!firebaseConfigured && <p className="muted-note"><CalendarDays size={15} /> La conexión a Firebase se activa al configurar el archivo de entorno.</p>}
  </>;
}
