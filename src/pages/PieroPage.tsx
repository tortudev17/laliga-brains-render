import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CalendarDays, Check, Coins, Flag, LayoutDashboard, LockKeyhole, LogOut, MessageSquare, Pencil, RefreshCw, Settings, Shield, ShieldCheck, Trash2, Trophy, UserPlus, Users, X } from "lucide-react";
import { apiRequest } from "../services/api/client";
import type { MatchRecord, UserRole } from "../types/domain";

type AdminData = {
  users: Array<{ uid: string; username: string; role: UserRole; accountStatus: string; createdAt: number; recommendationPriority?: "low" | "normal" | "high" }>;
  pendingApprovals: Array<{ id: string; uid: string; username: string; role: string; status: string }>;
  matches: Array<MatchRecord & { dateKey?: string }>;
  reports: Array<{ id: string; postId: string; reason: string; reporterUid: string; createdAt: number }>;
  players: Array<{ id: string; name: string; team: string; ghost: boolean; uid?: string }>;
  fantasyPlayers: Array<{ id: string; name: string; value: number; ownerUid?: string; permanentInvestment?: number }>;
  recentCoinActivity: Array<{ id: string; walletUid: string; amount: number; type: string; createdAt: number }>;
  recentFantasyTransfers: Array<{ id: string; playerId: string; ownerUid?: string; previousOwnerUid?: string; action: string; amount: number; createdAt: number }>;
  predictionStatuses: Array<{ id: string; dateKey: string; status: string; entriesSettled?: number; matchId?: string }>;
  enhancedSecurity: boolean;
  penaltyGameEnabled: boolean;
};

const adminTabs = ["Panel general", "Partidos", "Jugadores", "Usuarios", "Monedas", "Social", "Seguridad"] as const;
type AdminTab = typeof adminTabs[number];
const adminTabIcons = { "Panel general": LayoutDashboard, Partidos: CalendarDays, Jugadores: Trophy, Usuarios: Users, Monedas: Coins, Social: MessageSquare, Seguridad: ShieldCheck };
const adminTabDescriptions: Record<AdminTab, string> = {
  "Panel general": "Resumen de la actividad de la comunidad.",
  Partidos: "Publica resultados y corrige el historial de la liga.",
  Jugadores: "Gestiona perfiles de 4 ESO y jugadores fantasma.",
  Usuarios: "Revisa cuentas, solicitudes y permisos de la comunidad.",
  Monedas: "Consulta la economía y registra ajustes auditables.",
  Social: "Revisa los informes de publicaciones.",
  Seguridad: "Controla el acceso y las opciones de seguridad.",
};

export function PieroPage() {
  const [pin, setPin] = useState("");
  const [unlockStep, setUnlockStep] = useState<"pin" | "password">("pin");
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [session, setSession] = useState("");
  const [pinChallenge, setPinChallenge] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<AdminTab>("Panel general");
  const [score3ESO, setScore3ESO] = useState(0);
  const [score4ESO, setScore4ESO] = useState(0);
  const [goalscorers, setGoalscorers] = useState<string[]>([]);
  const [matchDate, setMatchDate] = useState(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date()));
  const [editingMatch, setEditingMatch] = useState<string | null>(null);
  const [ghostName, setGhostName] = useState("");
  const [mergePlayerId, setMergePlayerId] = useState("");
  const [mergeUid, setMergeUid] = useState("");
  const [coinUid, setCoinUid] = useState("");
  const [coinAmount, setCoinAmount] = useState(10);
  const [coinReason, setCoinReason] = useState("");

  const headers = useMemo(() => ({ "x-piero-session": session }), [session]);
  const fetchAdminData = async (token = session) => {
    if (!token) return;
    const result = await apiRequest<AdminData>("piero-data", undefined, { method: "GET", headers: { "x-piero-session": token }, auth: null });
    setData(result);
  };
  const runAdminAction = async (body: Record<string, unknown>) => {
    setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ result?: unknown }>("piero-admin", body, { headers, auth: null });
      setMessageType("success");
      setMessage("Cambios guardados.");
      await fetchAdminData();
      return result;
    } catch (error) { setMessageType("error"); setMessage(error instanceof Error ? error.message : "No se pudo completar la acción."); return null; }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!unlocked) return;
    let timer = window.setTimeout(() => void lock(), 15 * 60 * 1000);
    const reset = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void lock(), 15 * 60 * 1000); };
    ["pointerdown", "keydown", "touchstart"].forEach((event) => window.addEventListener(event, reset, { passive: true }));
    return () => { window.clearTimeout(timer); ["pointerdown", "keydown", "touchstart"].forEach((event) => window.removeEventListener(event, reset)); };
  }, [unlocked]);

  async function lock() {
    const activeSession = session;
    setUnlocked(false); setSession(""); setData(null); setPin(""); setPassword(""); setUnlockStep("pin");
    setPinChallenge("");
    if (activeSession) try { await apiRequest("piero-lock", {}, { headers: { "x-piero-session": activeSession }, auth: null }); } catch { /* La sesión también caduca en el servidor. */ }
  }

  const checkPin = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const result = await apiRequest<{ challengeId: string }>("piero-pin", { pin });
      setPinChallenge(result.challengeId);
      setUnlockStep("password");
    } catch (error) { setMessageType("error"); setMessage(error instanceof Error ? error.message : "No se pudo comprobar el PIN."); }
    finally { setBusy(false); }
  };

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    let createdSession = "";
    try {
      const result = await apiRequest<{ sessionToken: string }>("piero-login", { challengeId: pinChallenge, password }, { auth: null });
      createdSession = result.sessionToken;
      await fetchAdminData(result.sessionToken);
      setSession(result.sessionToken); setUnlocked(true); setPin(""); setPassword(""); setPinChallenge(""); setMessage("");
    } catch (error) {
      if (createdSession) void apiRequest("piero-lock", {}, { headers: { "x-piero-session": createdSession }, auth: null }).catch(() => undefined);
      setMessageType("error");
      setMessage(error instanceof Error ? error.message : "No se pudo desbloquear Modo Piero.");
      setUnlockStep("pin"); setPin(""); setPassword(""); setPinChallenge("");
    }
    finally { setBusy(false); }
  };

  const updateScorerSlot = (index: number, playerId: string) => setGoalscorers((current) => { const next = [...current]; next[index] = playerId; return next; });
  const scorerCounts = goalscorers.filter(Boolean).reduce<Record<string, number>>((counts, playerId) => { counts[playerId] = (counts[playerId] ?? 0) + 1; return counts; }, {});
  const saveMatch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (Object.keys(scorerCounts).reduce((sum, id) => sum + scorerCounts[id]!, 0) !== score4ESO) { setMessageType("error"); setMessage("Asigna exactamente un jugador de 4 ESO por cada gol."); return; }
    if (matchDate > new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date()) && !window.confirm("La fecha es futura. ¿Quieres guardar este resultado histórico con esa fecha?")) return;
    const result = await runAdminAction({ action: editingMatch ? "editMatch" : "createMatch", matchId: editingMatch, date: matchDate, score3ESO, score4ESO, goalscorers4ESO: scorerCounts });
    if (result) { setEditingMatch(null); setScore3ESO(0); setScore4ESO(0); setGoalscorers([]); }
  };

  const startEditMatch = (match: MatchRecord & { dateKey?: string }) => {
    setEditingMatch(match.id); setScore3ESO(match.score3ESO); setScore4ESO(match.score4ESO); setMatchDate(match.dateKey || new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(match.playedAt));
    const slots = Object.entries(match.goalscorers4ESO ?? {}).flatMap(([id, count]) => Array(Number(count)).fill(id) as string[]);
    setGoalscorers(slots); setTab("Partidos"); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!unlocked) return <section className="piero-access-page">
    <div className="piero-access-top"><Link to="/" className="piero-back-link"><ArrowLeft size={17}/>Volver a LaLiga Brains</Link></div>
    <form className="piero-lock-form" onSubmit={(event) => void (unlockStep === "pin" ? checkPin(event) : unlock(event))}>
      <span className="piero-lock-icon"><LockKeyhole size={23}/></span>
      <div><h1>Modo Piero</h1><p>Acceso privado al panel de administración.</p></div>
      <div className="piero-step-indicator"><span className={unlockStep === "pin" ? "current" : "complete"}>1</span><i/><span className={unlockStep === "password" ? "current" : ""}>2</span><small>PIN</small><small>Contraseña</small></div>
      <h2>{unlockStep === "pin" ? "Introduce el PIN" : "Confirma tu contraseña"}</h2>
      <p>{unlockStep === "pin" ? "Primero verifica el PIN de Modo Piero." : "El PIN es correcto. Ahora inicia sesión con la contraseña de Piero."}</p>
      {unlockStep === "pin" ? <label>PIN de cuatro cifras<input required autoFocus inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={(event)=>setPin(event.target.value.replace(/\D/g, ""))} placeholder="••••"/></label> : <><div className="piero-account-id">Cuenta de administrador <strong>holam@secure.com</strong></div><label>Contraseña de administrador<input required autoFocus type="password" autoComplete="current-password" value={password} onChange={(event)=>setPassword(event.target.value)} /></label></>}
      {message && <p className="error-message" role="alert">{message}</p>}
      <button className="button button-primary full-button" disabled={busy}>{busy ? "Comprobando…" : unlockStep === "pin" ? "Continuar" : "Entrar en Modo Piero"}</button>
      {unlockStep === "password" && <button type="button" className="plain-link" onClick={() => { setUnlockStep("pin"); setPin(""); setPassword(""); setPinChallenge(""); setMessage(""); }}>Volver al PIN</button>}
    </form>
  </section>;

  return <div className="piero-admin-shell">
    <header className="piero-admin-header">
      <Link to="/" className="piero-admin-brand"><span className="piero-brand-mark"><Shield size={20}/></span><span><strong>LaLiga Brains</strong><small>Administración</small></span></Link>
      <div className="piero-admin-header-actions"><span className="piero-active-status"><i/>Sesión activa</span><button className="piero-header-button" onClick={() => void fetchAdminData()} aria-label="Actualizar panel"><RefreshCw size={17}/>Actualizar</button><button className="piero-exit-button" onClick={() => void lock()}><LogOut size={17}/>Salir del Modo Piero</button></div>
    </header>
    <div className="piero-admin-layout">
      <aside className="piero-admin-sidebar">
        <div className="piero-sidebar-heading">GESTIÓN</div>
        <nav className="piero-admin-tabs" aria-label="Secciones administrativas">{adminTabs.map((item) => { const Icon = adminTabIcons[item]; return <button key={item} className={tab === item ? "active" : ""} aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}><Icon size={18}/><span>{item}</span>{item === "Usuarios" && Boolean(data?.pendingApprovals.length) && <b>{data?.pendingApprovals.length}</b>}</button>; })}</nav>
        <div className="piero-sidebar-security"><ShieldCheck size={18}/><div><strong>Sesión protegida</strong><span>Bloqueo tras 15 min sin actividad</span></div></div>
      </aside>
      <main className="piero-admin-main">
        <div className="piero-content-heading"><div><h1>{tab}</h1><p>{adminTabDescriptions[tab]}</p></div>{tab !== "Panel general" && <button className="piero-refresh-button" onClick={() => void fetchAdminData()}><RefreshCw size={16}/>Actualizar datos</button>}</div>
        {tab === "Panel general" && <>
          <div className="admin-welcome"><Shield size={21}/><div><h2>Sesión administrativa activa</h2><p>Las acciones quedan asociadas a la cuenta Piero. El panel se bloquea tras 15 minutos de inactividad.</p></div></div>
          <div className="admin-summary"><Summary icon={<Users size={18}/>} label="Usuarios" value={data?.users.length ?? "—"}/><Summary icon={<Check size={18}/>} label="Aprobaciones pendientes" value={data?.pendingApprovals.length ?? "—"}/><Summary icon={<Trophy size={18}/>} label="Partidos registrados" value={data?.matches.length ?? "—"}/><Summary icon={<Flag size={18}/>} label="Informes pendientes" value={data?.reports.length ?? "—"}/></div>
        </>}
    {tab === "Panel general" && <div className="admin-grid">
      <section className="admin-card"><h2>Actividad reciente</h2>{data?.matches.length?data.matches.slice(0,5).map((match)=><div className="admin-list-row" key={match.id}><div><strong>3 ESO {match.score3ESO} — {match.score4ESO} 4 ESO</strong><span>{match.dateKey||new Intl.DateTimeFormat("es-ES",{dateStyle:"medium",timeZone:"Europe/Madrid"}).format(match.playedAt)}</span></div></div>):<div className="admin-empty">Todavía no hay resultados registrados.</div>}</section>
      <section className="admin-card"><h2>Actividad de monedas</h2>{data?.recentCoinActivity.length?data.recentCoinActivity.slice(0,8).map((item)=><div className="admin-list-row" key={item.id}><div><strong>{data.users.find((account)=>account.uid===item.walletUid)?.username??"Cuenta"} · {item.amount>0?"+":""}{item.amount} monedas</strong><span>{coinActivityLabel(item.type)} · {new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Madrid"}).format(item.createdAt)}</span></div></div>):<div className="admin-empty">Sin movimientos recientes.</div>}</section>
      <section className="admin-card"><h2>Traspasos Fantasy</h2>{data?.recentFantasyTransfers.length?data.recentFantasyTransfers.slice(0,8).map((item)=><div className="admin-list-row" key={item.id}><div><strong>{data.fantasyPlayers.find((player)=>player.id===item.playerId)?.name??"Jugador"} · {item.amount} monedas</strong><span>{item.action} · {new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Madrid"}).format(item.createdAt)}</span></div></div>):<div className="admin-empty">Sin traspasos recientes.</div>}</section>
      <section className="admin-card"><h2>Predicciones recientes</h2>{data?.predictionStatuses.length?data.predictionStatuses.slice(0,8).map((round)=><div className="admin-list-row" key={round.id}><div><strong>{round.dateKey} · {round.status}</strong><span>{round.entriesSettled??0} elecciones evaluadas{round.matchId?` · Partido ${round.matchId}`:""}</span></div></div>):<div className="admin-empty">No hay jornadas de predicciones todavía.</div>}</section>
    </div>}
    {tab === "Partidos" && <div className="admin-grid"><section className="admin-card"><h2><Trophy size={20}/>{editingMatch ? "Corregir partido" : "Registrar partido"}</h2><form onSubmit={(event)=>void saveMatch(event)}><label>Fecha del partido<input required type="date" value={matchDate} onChange={(event)=>setMatchDate(event.target.value)}/></label><div className="score-inputs"><label>3 ESO<input type="number" min="0" max="99" value={score3ESO} onChange={(event)=>setScore3ESO(Number(event.target.value))}/></label><span>—</span><label>4 ESO<input type="number" min="0" max="99" value={score4ESO} onChange={(event)=>{const score=Number(event.target.value);setScore4ESO(score);setGoalscorers((current)=>Array.from({length:score},(_,index)=>current[index]??""));}}/></label></div>{score4ESO > 0 && <div className="scorers-form"><strong>Goleadores de 4 ESO · {score4ESO} {score4ESO===1?"gol":"goles"}</strong>{Array.from({length:score4ESO},(_,index)=><label key={index}>Gol {index+1}<select required value={goalscorers[index]??""} onChange={(event)=>updateScorerSlot(index,event.target.value)}><option value="">Elige un jugador</option>{data?.players.filter((player)=>player.team==="4ESO").map((player)=><option key={player.id} value={player.id}>{player.name}{player.ghost?" · jugador fantasma":""}</option>)}</select></label>)}</div>}<p className="muted-note">Cada gol debe atribuirse a un jugador registrado o jugador fantasma de 4 ESO. Se usará la titularidad Fantasy al publicar para atribuir las recompensas.</p><div className="form-actions"><button className="button button-primary" disabled={busy}>{busy?"Guardando…":editingMatch?"Guardar corrección":"Publicar resultado"}</button>{editingMatch&&<button type="button" className="button button-secondary" onClick={()=>{setEditingMatch(null);setGoalscorers([]);setScore3ESO(0);setScore4ESO(0);}}>Cancelar</button>}</div></form></section><section className="admin-card"><h2>Partidos recientes</h2><div className="admin-match-list">{data?.matches.length ? data.matches.slice(0,12).map((match)=><div key={match.id} className="admin-list-row"><div><strong>{match.score3ESO} — {match.score4ESO}</strong><span>{match.dateKey || new Intl.DateTimeFormat("es-ES",{dateStyle:"medium",timeZone:"Europe/Madrid"}).format(match.playedAt)}</span></div><button aria-label="Editar partido" onClick={()=>startEditMatch(match)}><Pencil size={16}/></button><button aria-label="Eliminar partido" onClick={()=>{if(window.confirm("¿Eliminar este resultado? Se corregirán las estadísticas asociadas."))void runAdminAction({action:"deleteMatch",matchId:match.id});}}><Trash2 size={16}/></button></div>) : <div className="admin-empty">Todavía no hay partidos.</div>}</div></section></div>}
    {tab === "Jugadores" && <div className="admin-grid"><section className="admin-card"><h2><UserPlus size={20}/>Crear jugador fantasma</h2><form onSubmit={(event)=>{event.preventDefault();void runAdminAction({action:"createGhostPlayer",name:ghostName}).then((result)=>{if(result)setGhostName("");});}}><label>Nombre del jugador<input required maxLength={60} value={ghostName} onChange={(event)=>setGhostName(event.target.value)} placeholder="Nombre inicial"/></label><button className="button button-primary">Crear jugador</button><p className="muted-note">El jugador podrá recibir goles, aparecer en el mercado y conservar su historial al registrarse.</p></form></section><section className="admin-card"><h2>Combinar perfil fantasma</h2><form onSubmit={(event)=>{event.preventDefault();void runAdminAction({action:"mergePlayer",playerId:mergePlayerId,uid:mergeUid});}}><label>Jugador fantasma<select required value={mergePlayerId} onChange={(event)=>setMergePlayerId(event.target.value)}><option value="">Elige un jugador</option>{data?.players.filter((player)=>player.ghost).map((player)=><option key={player.id} value={player.id}>{player.name}</option>)}</select></label><label>Cuenta de jugador de 4 ESO<select required value={mergeUid} onChange={(event)=>setMergeUid(event.target.value)}><option value="">Elige una cuenta</option>{data?.users.filter((user)=>user.role==="player_4eso"&&user.accountStatus==="active").map((user)=><option key={user.uid} value={user.uid}>{user.username}</option>)}</select></label><button className="button button-primary">Combinar perfiles</button></form></section><section className="admin-card"><h2>Perfiles de 4 ESO</h2><div className="admin-match-list">{data?.players.map((player)=><div className="admin-list-row" key={player.id}><div><strong>{player.name}</strong><span>{player.ghost?"Jugador fantasma":player.uid?`Cuenta: ${player.uid}`:"Jugador registrado"}</span></div><strong>{data?.fantasyPlayers.find((item)=>item.id===player.id)?.value??50} 🪙</strong></div>)}</div></section></div>}
    {tab === "Usuarios" && <section className="admin-card"><h2><Users size={20}/>Cuentas y solicitudes</h2><div className="approval-list">
      {data?.pendingApprovals.map((application)=><div className="approval-row" key={application.id}><div><strong>{application.username}</strong><span>{application.role==="player_3eso"?"Jugador de 3 ESO":"Jugador de 4 ESO"} · pendiente de aprobación</span></div><button title="Aprobar" onClick={()=>void runAdminAction({action:"approveUser",uid:application.uid})}><Check size={17}/></button><button title="Rechazar" onClick={()=>void runAdminAction({action:"rejectUser",uid:application.uid})}><X size={17}/></button></div>)}
      {data?.users.filter((account)=>account.accountStatus!=="pending_approval").map((account)=><div className="admin-user-row" key={account.uid}><div className="admin-user-heading"><strong>{account.username}</strong><span>{roleLabel(account.role)} · {account.accountStatus}</span></div>
        <div className="admin-user-controls"><select aria-label={`Cambiar clasificación de ${account.username}`} value={account.role} onChange={(event)=>void runAdminAction({action:"changeRole",uid:account.uid,role:event.target.value})}><option value="player_3eso">Jugador de 3 ESO</option><option value="player_4eso">Jugador de 4 ESO</option><option value="spectator">Espectador</option></select>
          <select aria-label={`Prioridad de recomendación de ${account.username}`} value={account.recommendationPriority??"normal"} onChange={(event)=>void runAdminAction({action:"recommendationPriority",uid:account.uid,priority:event.target.value})}><option value="low">Recomendación baja</option><option value="normal">Recomendación normal</option><option value="high">Recomendación alta</option></select>
          <button className="button button-secondary button-small" onClick={()=>void runAdminAction({action:"setPostingSuspension",uid:account.uid,until:Date.now()+24*60*60*1000})}>Suspender publicaciones 24 h</button>
          <button className="button button-secondary button-small" onClick={()=>{if(window.confirm(`¿${account.accountStatus==="active"?"Suspender":"Reactivar"} la cuenta de ${account.username}?`))void runAdminAction({action:"suspendUser",uid:account.uid,suspended:account.accountStatus==="active"});}}>{account.accountStatus==="active"?"Suspender cuenta":"Reactivar cuenta"}</button>
          <button className="button button-secondary button-small" onClick={()=>{const reason=window.prompt("Motivo del bloqueo permanente","");if(reason?.trim()&&window.confirm(`¿Bloquear permanentemente a ${account.username}?`))void runAdminAction({action:"banUser",uid:account.uid,reason});}}>Bloquear permanentemente</button>
        </div></div>)}
    </div></section>}
    {tab === "Monedas" && <div className="admin-grid"><section className="admin-card"><h2><Coins size={20}/>Ajuste de monedas</h2><form onSubmit={(event)=>{event.preventDefault();void runAdminAction({action:"coinAdjust",uid:coinUid,amount:coinAmount,reason:coinReason});}}><label>Cuenta<select required value={coinUid} onChange={(event)=>setCoinUid(event.target.value)}><option value="">Elige una cuenta</option>{data?.users.map((user)=><option value={user.uid} key={user.uid}>{user.username}</option>)}</select></label><label>Importe (positivo o negativo)<input required type="number" step="1" value={coinAmount} onChange={(event)=>setCoinAmount(Number(event.target.value))}/></label><label>Motivo<input required maxLength={300} value={coinReason} onChange={(event)=>setCoinReason(event.target.value)}/></label><button className="button button-primary">Aplicar ajuste</button></form></section><section className="admin-card"><h2>Integridad de la economía</h2><p>Los saldos se cambian dentro de una transacción atómica del estado económico y se reflejan en el libro de movimientos.</p><div className="admin-empty">Los movimientos recientes se consultan en el libro auditable.</div></section></div>}
    {tab === "Social" && <section className="admin-card"><h2><MessageSquare size={20}/>Informes de contenido</h2>{data?.reports.length?data.reports.map((report)=><div className="approval-row" key={report.id}><div><strong>Publicación {report.postId}</strong><span>{report.reason}</span></div><button onClick={()=>void runAdminAction({action:"moderatePost",postId:report.postId,moderationAction:"delete"})}>Eliminar</button><button onClick={()=>void runAdminAction({action:"dismissReport",reportId:report.id})}>Descartar</button></div>):<div className="admin-empty">No hay informes pendientes.</div>}</section>}
    {tab === "Seguridad" && <section className="admin-card"><h2><Settings size={20}/>Configuración</h2><label className="security-toggle"><div><strong>Seguridad mejorada</strong><span>Las cuentas de jugador nuevas requieren aprobación. Los espectadores pueden registrarse sin revisión.</span></div><input type="checkbox" checked={Boolean(data?.enhancedSecurity)} onChange={(event)=>void runAdminAction({action:"setEnhancedSecurity",enabled:event.target.checked})}/></label><label className="security-toggle"><div><strong>Minijuego de penaltis</strong><span>Por defecto está desactivado. Actívalo para mostrarlo a la comunidad.</span></div><input type="checkbox" checked={Boolean(data?.penaltyGameEnabled)} onChange={(event)=>void runAdminAction({action:"setPenaltyGameEnabled",enabled:event.target.checked})}/></label><p className="muted-note">Las sesiones de Piero caducan tras 15 minutos de inactividad y el PIN se bloquea durante 15 minutos después de cinco intentos fallidos.</p></section>}
        {message&&<p className={`admin-flash ${messageType}`} role={messageType === "error" ? "alert" : "status"}>{message}</p>}
      </main>
    </div>
  </div>;
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) { return <div className="admin-summary-item"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>; }
function roleLabel(role: UserRole) { return role === "player_3eso" ? "Jugador de 3 ESO" : role === "player_4eso" ? "Jugador de 4 ESO" : "Espectador"; }
function coinActivityLabel(type: string) { return type === "prediction_retirement_reversal" || type.startsWith("prediction_") ? "Revisión histórica de predicciones" : type.replaceAll("_", " "); }
