import { useEffect, useState } from "react";
import { endBefore, get, limitToLast, onValue, orderByChild, query, ref } from "firebase/database";
import { CalendarDays } from "lucide-react";
import { database, firebaseConfigured } from "../services/firebase/client";
import type { MatchRecord } from "../types/domain";

const pageSize = 30;

export function MatchesPage() {
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [loading, setLoading] = useState(firebaseConfigured);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    if (!firebaseConfigured || !database) return;
    return onValue(query(ref(database, "laligaBrains/football/matches"), orderByChild("playedAt"), limitToLast(pageSize)), (snapshot) => {
      const value = snapshot.val() as Record<string, Omit<MatchRecord, "id">> | null;
      const rows = value ? Object.entries(value).map(([id, item]) => ({ ...item, id })).sort((a, b) => b.playedAt - a.playedAt || b.id.localeCompare(a.id)) : [];
      setMatches(rows);
      setHasMore(rows.length === pageSize);
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  const loadOlder = async () => {
    if (!database || !matches.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const oldest = matches.reduce((previous, match) => match.playedAt < previous.playedAt || (match.playedAt === previous.playedAt && match.id < previous.id) ? match : previous);
      const snapshot = await get(query(ref(database, "laligaBrains/football/matches"), orderByChild("playedAt"), endBefore(oldest.playedAt, oldest.id), limitToLast(pageSize)));
      const value = snapshot.val() as Record<string, Omit<MatchRecord, "id">> | null;
      const older = Object.entries(value ?? {}).map(([id, item]) => ({ ...item, id }));
      setMatches((current) => [...current, ...older].sort((a, b) => b.playedAt - a.playedAt || b.id.localeCompare(a.id)));
      setHasMore(older.length === pageSize);
    } catch {
      setHasMore(false);
    } finally { setLoadingMore(false); }
  };

  return <>
    <div className="page-heading"><div><h1>Partidos</h1><p>Resultados y memoria de la rivalidad.</p></div></div>
    <div className="table-scroll match-history-scroll"><table className="match-table match-history-table match-list-table"><thead><tr><th>Fecha</th><th className="match-team-column">Local</th><th className="center">Resultado</th><th className="match-team-column">Visitante</th><th>Goleadores de 4 ESO</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={5} className="table-empty">Cargando partidos…</td></tr> : matches.length ? matches.map((match) => <tr key={match.id}><td>{new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" }).format(match.playedAt)}</td><td className="match-team-column">3 ESO</td><td className="score-cell"><span className="score-desktop">{match.score3ESO} — {match.score4ESO}</span><span className="score-mobile"><span>3 ESO <b>{match.score3ESO}</b></span><span>4 ESO <b>{match.score4ESO}</b></span></span></td><td className="match-team-column">4 ESO</td><td className="scorers-cell">{Object.entries(match.goalscorers4ESO ?? {}).map(([id, goals]) => `${match.goalscorerNames?.[id] ?? id} ×${goals}`).join(", ") || "—"}</td></tr>) : <tr><td colSpan={5} className="table-empty"><div className="empty-ball">⚽</div><strong>Aún no hay partidos</strong><span>Los resultados se publicarán aquí después de cada encuentro.</span></td></tr>}
    </tbody></table></div>
    {!loading && matches.length > 0 && hasMore && <div className="load-more-row"><button className="button button-secondary" disabled={loadingMore} onClick={() => void loadOlder()}>{loadingMore ? "Cargando…" : "Cargar partidos anteriores"}</button></div>}
    {!firebaseConfigured && <p className="muted-note"><CalendarDays size={15} /> La conexión a Firebase se activa al configurar el archivo de entorno.</p>}
  </>;
}
