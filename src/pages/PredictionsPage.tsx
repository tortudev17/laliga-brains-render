import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, Check, Clock3, RefreshCw, Sparkles, Target, Trophy } from "lucide-react";
import { apiRequest } from "../services/api/client";
import { isPredictionOpen } from "../utils/predictions";
import "../styles/predictions.css";

type PredictionQuestion = {
  id: string;
  kind: "winner" | "player_goals";
  question: string;
  playerId?: string;
  playerName?: string;
  threshold?: number;
  outcomes: Record<string, { probability: number }>;
};
type PredictionEntry = { questionId: string; outcome: string; status: string };
type PredictionRound = {
  dateKey: string;
  status: string;
  questions: PredictionQuestion[];
  matchesAnalyzed?: number;
  target?: string;
  userEntries?: PredictionEntry[];
};

export function PredictionsPage() {
  const [round, setRound] = useState<PredictionRound | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<PredictionRound>("prediction-action", undefined, { method: "GET" });
      setRound(result);
      setChoices(Object.fromEntries((result.userEntries ?? []).map((entry) => [entry.questionId, entry.outcome])));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se han podido cargar los pronósticos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const isOpen = Boolean(round?.status === "open" && isPredictionOpen(now));
  const entries = useMemo(() => new Map((round?.userEntries ?? []).map((entry) => [entry.questionId, entry])), [round]);

  const submit = async (question: PredictionQuestion) => {
    const outcome = choices[question.id];
    if (!outcome || !round || !isOpen) return;
    setBusyId(question.id);
    setError("");
    setMessage("");
    try {
      await apiRequest("prediction-action", { action: "submit", questionId: question.id, outcome });
      setRound((current) => current ? {
        ...current,
        userEntries: [
          ...(current.userEntries ?? []).filter((entry) => entry.questionId !== question.id),
          { questionId: question.id, outcome, status: "active" },
        ],
      } : current);
      setMessage("Tu elección se ha guardado.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se ha podido guardar tu elección.");
      await load();
    } finally {
      setBusyId("");
    }
  };

  const dateLabel = round?.dateKey ? formatDateKey(round.dateKey) : "Hoy";
  const roundOpen = isOpen;
  const statusLabel = round?.status === "settled" ? "Resultado publicado"
    : round?.status === "cancelled" ? "Jornada cancelada"
    : roundOpen ? "Abiertos hasta las 15:00" : round?.questions.length ? "Cerrados" : "Pendientes";

  return <section className="feature-page predictions-page">
    <header className="predictions-hero">
      <div className="predictions-hero-icon"><Brain size={24} /></div>
      <div className="predictions-hero-copy"><span className="predictions-kicker">LA JORNADA, SEGÚN LOS DATOS</span><h1>Pronósticos</h1><p>Elige el resultado del próximo partido y comprueba cómo se comportan las estadísticas.</p></div>
      <button className="predictions-refresh" type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={16} className={loading ? "predictions-spinning" : ""} /> Actualizar</button>
    </header>

    <div className="predictions-meta">
      <div className="predictions-day"><span><Clock3 size={16} /></span><div><strong>{dateLabel}</strong><small>Las elecciones cierran a las 15:00 · hora de Madrid</small></div></div>
      <div className={`predictions-status ${roundOpen ? "is-open" : ""}`}><i />{statusLabel}</div>
    </div>

    {message && <p className="predictions-notice is-success" role="status"><Check size={16} />{message}</p>}
    {error && <div className="predictions-notice is-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Reintentar</button></div>}

    {loading && !round ? <div className="predictions-loading" role="status"><span className="page-loading-spinner"/><strong>Cargando la jornada…</strong></div>
      : round?.questions.length ? <>
        <div className="predictions-round-note"><Sparkles size={16} /><span>{round.target || "La jornada se resolverá con el primer resultado que Piero registre hoy."} {round.matchesAnalyzed === 0 ? "Todavía no hay partidos históricos: se muestra una estimación inicial equilibrada." : `Estimación basada en ${round.matchesAnalyzed} ${round.matchesAnalyzed === 1 ? "partido" : "partidos"} anteriores.`}</span></div>
        <div className="prediction-question-grid">
          {round.questions.map((question, index) => {
            const saved = entries.get(question.id);
            const cancelled = round.status === "cancelled" || saved?.status === "cancelled" || saved?.status === "refunded";
            const resolved = saved && saved.status !== "active";
            return <article className="prediction-card" key={question.id} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
              <div className="prediction-card-heading"><span className="prediction-kind-icon">{question.kind === "winner" ? <Trophy size={17} /> : <Target size={17} />}</span><span>{question.kind === "winner" ? "RESULTADO" : "GOLEADOR"}</span>{resolved && <b className={`prediction-outcome-badge ${saved?.status === "correct" ? "is-correct" : "is-wrong"}`}>{cancelled ? "Cancelado" : saved?.status === "correct" ? "Acierto" : saved?.status === "incorrect" ? "No acertado" : "Cerrado"}</b>}</div>
              <h2>{question.question}</h2>
              <div className={`prediction-options ${Object.keys(question.outcomes).length === 3 ? "has-three" : ""}`} role="group" aria-label={question.question}>
                {Object.entries(question.outcomes).map(([outcome, estimate]) => {
                  const selected = choices[question.id] === outcome;
                  return <button type="button" key={outcome} className={`prediction-option ${selected ? "is-selected" : ""}`} disabled={!roundOpen || Boolean(resolved)} aria-pressed={selected} onClick={() => setChoices((current) => ({ ...current, [question.id]: outcome }))}>
                    <strong>{outcome}</strong><span>{Math.round(Math.max(0, Math.min(1, estimate.probability)) * 100)}%</span>
                  </button>;
                })}
              </div>
              {saved?.status === "active" && <p className="prediction-saved">Tu elección: <strong>{saved.outcome}</strong>{roundOpen ? " · Puedes cambiarla hasta las 15:00." : ""}</p>}
              {resolved && <p className="prediction-saved">Tu elección: <strong>{saved?.outcome}</strong></p>}
              {roundOpen && <div className="prediction-card-footer"><span>{saved?.status === "active" ? "Puedes cambiar tu respuesta" : "Elección gratuita"}</span><button className="button button-primary button-small" type="button" disabled={!choices[question.id] || busyId === question.id || Boolean(resolved)} onClick={() => void submit(question)}>{busyId === question.id ? "Guardando…" : saved?.status === "active" ? "Actualizar elección" : "Guardar elección"}</button></div>}
            </article>;
          })}
        </div>
      </> : <div className="predictions-empty"><span><Brain size={24} /></span><h2>{round?.status === "cancelled" ? "La jornada se ha cancelado" : "Todavía no hay jornada"}</h2><p>{round?.status === "cancelled" ? "No se registró ningún partido para esta fecha." : "Los pronósticos se generan los días lectivos. Vuelve a consultar después de las 08:00."}</p></div>}
  </section>;
}

function formatDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Madrid" }).format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}
