import { useCallback, useEffect, useState } from "react";
import { Award, Check, ChevronRight, CircleHelp, Coins, RefreshCw, Trophy, X } from "lucide-react";
import { apiRequest } from "../services/api/client";
import "../styles/quiz.css";

type QuizQuestion = { id: string; question: string; options: string[] };
type QuizAnswer = { selected: string; correct: boolean; correctAnswer: string; reward: number; deferred?: boolean; answeredAt: number };
type QuizSession = {
  sessionId: string;
  gameNumber: number;
  status: "open" | "completed";
  score: number;
  earned: number;
  questionIds: string[];
  questions: QuizQuestion[];
  answers: Record<string, QuizAnswer>;
};
type QuizState = { dateKey: string; gamesPlayed: number; totalEarnedToday: number; walletBalance: number; economyPaused: boolean; session: QuizSession | null };

export function QuizPage() {
  const [state, setState] = useState<QuizState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; correctAnswer: string; reward: number; deferred?: boolean } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest<QuizState>("quiz-action", undefined, { method: "GET" });
      setState(result);
      setSelected("");
      setFeedback(null);
      if (result.session) {
        const firstUnanswered = result.session.questions.findIndex((question) => !result.session?.answers?.[question.id]);
        setCurrentIndex(firstUnanswered >= 0 ? firstUnanswered : result.session.questions.length - 1);
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se ha podido cargar el quiz.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const session = state?.session ?? null;
  const currentQuestion = session?.questions[currentIndex];
  const answeredCount = session ? Object.keys(session.answers ?? {}).length : 0;
  const allQuestionsAnswered = Boolean(session && answeredCount >= session.questions.length);
  const progress = session ? Math.round(answeredCount / session.questions.length * 100) : 0;
  const score = session?.score ?? 0;
  const hasAnsweredCurrent = Boolean(currentQuestion && session?.answers?.[currentQuestion.id]);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest<{ result: QuizState }>("quiz-action", { action: "start", startKey: crypto.randomUUID() });
      setState(response.result);
      setCurrentIndex(0);
      setSelected("");
      setFeedback(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se ha podido iniciar el quiz.");
    } finally {
      setBusy(false);
    }
  };

  const answer = async () => {
    if (!session || !currentQuestion || !selected || hasAnsweredCurrent || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest<{ result: QuizState & { correct: boolean; correctAnswer: string; reward: number; deferred: boolean } }>("quiz-action", {
        action: "answer", sessionId: session.sessionId, questionId: currentQuestion.id, answer: selected,
      });
      const result = response.result;
      setState(result);
      setFeedback({ correct: result.correct, correctAnswer: result.correctAnswer, reward: result.reward, deferred: result.deferred });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "No se ha podido comprobar la respuesta.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const nextQuestion = () => {
    if (!session) return;
    setFeedback(null);
    setSelected("");
    const next = session.questions.findIndex((question, index) => index > currentIndex && !session.answers?.[question.id]);
    if (next >= 0) setCurrentIndex(next);
    else {
      const firstUnanswered = session.questions.findIndex((question) => !session.answers?.[question.id]);
      if (firstUnanswered >= 0) setCurrentIndex(firstUnanswered);
    }
  };

  return <section className="feature-page quiz-page">
    <header className="quiz-hero">
      <div className="quiz-hero-icon"><CircleHelp size={24}/></div>
      <div className="quiz-hero-copy"><span className="quiz-kicker">RETO DE FÚTBOL</span><h1>Quiz</h1><p>5 preguntas por partida. Gana 5 monedas por cada respuesta correcta.</p></div>
      <div className="quiz-hero-reward"><Coins size={18}/><strong>+5</strong><small>por acierto</small></div>
    </header>

    <div className="quiz-stats-strip">
      <div><span className="quiz-stat-icon"><Trophy size={17}/></span><small>Partidas jugadas hoy</small><strong>{state ? state.gamesPlayed.toLocaleString("es-ES") : "—"}</strong></div>
      <div><span className="quiz-stat-icon"><Award size={17}/></span><small>Premios del quiz hoy</small><strong>{state ? state.totalEarnedToday.toLocaleString("es-ES") : "—"}</strong></div>
      <div><span className="quiz-stat-icon"><Coins size={17}/></span><small>Saldo actual</small><strong>{state ? state.walletBalance.toLocaleString("es-ES") : "—"} <em>🪙</em></strong></div>
    </div>

    {state?.economyPaused && <div className="quiz-alert" role="status"><span>La economía está pausada: puedes jugar y tus premios quedarán pendientes hasta que se reanude.</span></div>}
    {error && <div className="quiz-alert" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Reintentar</button></div>}

    {loading && !state ? <div className="quiz-loading" role="status"><span className="page-loading-spinner"/>Cargando el quiz…</div>
      : !session ? <div className="quiz-start-card">
        <span className="quiz-start-emblem"><Trophy size={27}/></span><h2>¿Cuánto sabes de fútbol?</h2><p>Cada partida tiene 5 preguntas. Puedes jugar todas las partidas que quieras.</p>
        <div className="quiz-start-facts"><span><b>5</b> preguntas por partida</span><span><b>5</b> monedas por acierto</span><span>Partidas ilimitadas</span></div>
        <button className="button button-primary quiz-start-button" type="button" disabled={busy} onClick={() => void start()}>{busy ? "Preparando…" : "Empezar quiz"}<ChevronRight size={17}/></button>
      </div> : allQuestionsAnswered ? <div className="quiz-result-card">
        <span className="quiz-result-emblem"><Award size={28}/></span><span className="quiz-kicker">PARTIDA {session.gameNumber} COMPLETADA</span><h2>{score} de {session.questions.length} correctas</h2><p>{state?.economyPaused ? "Premios pendientes:" : "Has ganado"} <strong>{session.earned.toLocaleString("es-ES")} monedas</strong> en esta partida.</p>
        <div className="quiz-result-progress"><span style={{ width: `${score / session.questions.length * 100}%` }}/></div><small>{state?.gamesPlayed.toLocaleString("es-ES")} partidas jugadas hoy · {state?.totalEarnedToday.toLocaleString("es-ES")} monedas en premios hoy</small>
        <button className="button button-primary quiz-start-button" type="button" disabled={busy} onClick={() => void start()}>{busy ? "Preparando…" : "Jugar otra partida"}<RefreshCw size={15}/></button>
      </div> : <>
        <div className="quiz-session-heading"><div><span className="quiz-kicker">PARTIDA {session.gameNumber}</span><h2>Pregunta {currentIndex + 1} <small>de {session.questions.length}</small></h2></div><div className="quiz-session-score"><strong>{score}</strong><span>aciertos</span></div></div>
        <div className="quiz-progress-track" role="progressbar" aria-valuenow={answeredCount} aria-valuemin={0} aria-valuemax={session.questions.length}><i style={{ width: `${progress}%` }}/></div>
        {currentQuestion && <article className="quiz-question-card">
          <div className="quiz-question-number"><span>#{String(currentIndex + 1).padStart(2, "0")}</span><span>{answeredCount} / {session.questions.length} respondidas</span></div>
          <h2>{currentQuestion.question}</h2>
          <div className="quiz-answer-options" role="group" aria-label="Opciones de respuesta">
            {currentQuestion.options.map((option, index) => {
              const saved = session.answers?.[currentQuestion.id];
              const isCorrect = Boolean(saved && option === saved.correctAnswer);
              const isWrongSelection = Boolean(saved && option === saved.selected && !saved.correct);
              const classes = ["quiz-answer-option", selected === option ? "is-selected" : "", isCorrect ? "is-correct" : "", isWrongSelection ? "is-wrong" : ""].filter(Boolean).join(" ");
              return <button key={option} type="button" className={classes} disabled={busy || hasAnsweredCurrent} aria-pressed={selected === option} onClick={() => setSelected(option)}><span>{String.fromCharCode(65 + index)}</span><strong>{option}</strong>{isCorrect ? <Check size={17}/> : isWrongSelection ? <X size={17}/> : null}</button>;
            })}
          </div>
          {feedback && <div className={`quiz-feedback ${feedback.correct ? "is-correct" : "is-wrong"}`} role="status"><span>{feedback.correct ? <Check size={17}/> : <X size={17}/>}</span><div><strong>{feedback.correct ? `¡Correcto! +${feedback.reward}${feedback.deferred ? " monedas pendientes" : " monedas"}` : "No era esa respuesta"}</strong><small>Respuesta correcta: {feedback.correctAnswer}</small></div></div>}
          {hasAnsweredCurrent && !feedback && <div className={`quiz-feedback ${session.answers[currentQuestion.id]?.correct ? "is-correct" : "is-wrong"}`}><span>{session.answers[currentQuestion.id]?.correct ? <Check size={17}/> : <X size={17}/>}</span><div><strong>{session.answers[currentQuestion.id]?.correct ? `¡Correcto! +${session.answers[currentQuestion.id]?.reward}${session.answers[currentQuestion.id]?.deferred ? " monedas pendientes" : " monedas"}` : "Respuesta guardada"}</strong><small>Respuesta correcta: {session.answers[currentQuestion.id]?.correctAnswer}</small></div></div>}
          <div className="quiz-question-footer"><span>{hasAnsweredCurrent ? "Esta pregunta ya está cerrada." : "Solo puedes responder una vez a cada pregunta."}</span>{hasAnsweredCurrent ? <button className="button button-primary" type="button" onClick={nextQuestion}>Siguiente pregunta <ChevronRight size={16}/></button> : <button className="button button-primary" type="button" disabled={!selected || busy} onClick={() => void answer()}>{busy ? "Comprobando…" : "Confirmar respuesta"}</button>}</div>
        </article>}
      </>}
  </section>;
}
