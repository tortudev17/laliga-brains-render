import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Bell, CircleUserRound, LogOut, Menu, Shield, X } from "lucide-react";
import { limitToLast, onValue, orderByChild, query, ref } from "firebase/database";
import { useAuth } from "./AuthContext";
import { AuthDialog } from "../components/AuthDialog";
import { apiRequest } from "../services/api/client";
import { database } from "../services/firebase/client";

const HomePage = lazy(() => import("../pages/HomePage").then((module) => ({ default: module.HomePage })));
const MatchesPage = lazy(() => import("../pages/MatchesPage").then((module) => ({ default: module.MatchesPage })));
const SectionPage = lazy(() => import("../pages/SectionPage").then((module) => ({ default: module.SectionPage })));
const ProfilePage = lazy(() => import("../pages/ProfilePage").then((module) => ({ default: module.ProfilePage })));
const PieroPage = lazy(() => import("../pages/PieroPage").then((module) => ({ default: module.PieroPage })));
const PlayerProfilePage = lazy(() => import("../pages/PlayerProfilePage").then((module) => ({ default: module.PlayerProfilePage })));

const navigation = [
  ["/", "Inicio"], ["/partidos", "Partidos"], ["/goleadores", "Goleadores"], ["/social", "Social"],
  ["/fantasy", "Fantasy"], ["/pronosticos", "Predicciones"], ["/penaltis", "Penaltis"],
  ["/clasificaciones", "Clasificaciones"], ["/perfil", "Perfil"],
] as const;

export function App() {
  const { user, profile, loading, logout } = useAuth();
  const [authMode, setAuthMode] = useState<"login" | "register" | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const signedIn = Boolean(user && profile?.accountStatus === "active");
  const isPieroRoute = location.pathname.startsWith("/piero");

  return <div className={`app-shell${isPieroRoute ? " piero-route-shell" : ""}`}>
    {!isPieroRoute && <header className="topbar">
      <Link to="/" className="brand" aria-label="LaLiga Brains, inicio">
        <span className="brand-mark"><SoccerBall /></span><span className="brand-name">LaLiga <strong>Brains</strong></span>
      </Link>
      <nav className={`main-nav ${mobileOpen ? "is-open" : ""}`} aria-label="Navegación principal">
        {navigation.filter(([path]) => signedIn || path === "/" || path === "/partidos").map(([path, title]) =>
          <Link key={path} className={location.pathname === path ? "active" : ""} to={path} onClick={() => setMobileOpen(false)}>{title}</Link>)}
      </nav>
      <div className="header-actions">
        {loading ? <span className="session-loading" aria-live="polite">Comprobando sesión…</span> : signedIn ? <>
          <NotificationBell />
          <button className="user-chip" onClick={() => { void logout(); }} title="Cerrar sesión"><CircleUserRound size={20} /><span>{profile?.displayName || profile?.username}</span><LogOut size={16} /></button>
          <Link to="/piero" className="admin-link"><Shield size={16} /> Modo Piero</Link>
        </> : <>
          <button className="text-button" onClick={() => setAuthMode("login")}>Iniciar sesión</button>
          <button className="button button-primary button-small" onClick={() => setAuthMode("register")}>Crear cuenta</button>
          <Link to="/piero" className="admin-link"><Shield size={16} /> Modo Piero</Link>
        </>}
        <button className="icon-button mobile-menu" aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"} onClick={() => setMobileOpen((value) => !value)}>{mobileOpen ? <X size={21} /> : <Menu size={21} />}</button>
      </div>
    </header>}
    <main className={isPieroRoute ? "piero-route-main" : "page-container"}>
      <Suspense fallback={<div className="empty-feature">Cargando sección…</div>}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/partidos" element={<MatchesPage />} />
        <Route path="/perfil" element={<GatedRoute loading={loading} signedIn={signedIn}><ProfilePage /></GatedRoute>} />
        <Route path="/piero" element={<PieroPage />} />
        <Route path="/jugador/:playerId" element={<GatedRoute loading={loading} signedIn={signedIn}><PlayerProfilePage /></GatedRoute>} />
        {navigation.filter(([path]) => !["/", "/partidos", "/perfil"].includes(path)).map(([path, title]) => <Route key={path} path={path} element={<GatedRoute loading={loading} signedIn={signedIn}><SectionPage title={title} /></GatedRoute>} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </main>
    {!isPieroRoute && <footer className="site-footer"><span>LaLiga Brains</span><span>3 ESO · 4 ESO</span><span>Monedas virtuales sin valor económico</span></footer>}
    {authMode && <AuthDialog mode={authMode} onClose={() => setAuthMode(null)} onChangeMode={setAuthMode} />}
  </div>;
}

function GatedRoute({ loading, signedIn, children }: { loading: boolean; signedIn: boolean; children: React.ReactNode }) {
  if (loading) return <div className="empty-feature" role="status">Comprobando sesión…</div>;
  return signedIn ? <>{children}</> : <Navigate to="/" replace />;
}

function NotificationBell() {
  const { user } = useAuth();
  const [open,setOpen]=useState(false);
  const [items,setItems]=useState<Array<{id:string;type?:string;title?:string;message?:string;read?:boolean;postId?:string;matchId?:string;createdAt?:number}>>([]);
  const [error,setError]=useState("");
  const unread=items.filter((item)=>item.read===false).length;
  useEffect(()=>{
    if(!user||!database)return;
    return onValue(query(ref(database,`laligaBrains/notifications/${user.uid}`),orderByChild("createdAt"),limitToLast(50)),(snapshot)=>{
      const rows=Object.entries((snapshot.val()??{}) as Record<string,Omit<(typeof items)[number],"id">>).map(([id,item])=>({...item,id}));
      setItems(rows.sort((a,b)=>Number(b.createdAt??0)-Number(a.createdAt??0)));
    },()=>setError("No se han podido actualizar las notificaciones."));
  },[user]);
  const load=async()=>{try{const result=await apiRequest<{items:typeof items}>("notifications-action",undefined,{method:"GET"});setItems(result.items);setError("");}catch(problem){setError(problem instanceof Error?problem.message:"No se pudieron cargar las notificaciones.");}};
  const toggle=()=>{const next=!open;setOpen(next);if(next)void load();};
  const markRead=async(id:string)=>{try{await apiRequest("notifications-action",{notificationId:id});setItems((current)=>current.map((item)=>item.id===id?{...item,read:true}:item));}catch(problem){setError(problem instanceof Error?problem.message:"No se pudo marcar como leído.");}};
  return <div className="notification-wrap"><button className="icon-button notification-button" aria-label={`Notificaciones${unread?`, ${unread} sin leer`:""}`} title="Notificaciones" onClick={toggle}><Bell size={19}/>{unread>0&&<span className="notification-count">{unread>9?"9+":unread}</span>}</button>{open&&<div className="notification-panel"><div className="notification-panel-title"><strong>Notificaciones</strong><button onClick={()=>void load()}>Actualizar</button></div>{error&&<p className="notification-error">{error}</p>}{items.length?items.slice(0,30).map((item)=><button key={item.id} className={`notification-item ${item.read?"read":"unread"}`} onClick={()=>{void markRead(item.id);if(item.type==="match_result")window.location.assign("/partidos");else if(item.postId)window.location.assign("/social");}}><strong>{item.title||notificationLabel(item.type)}</strong><span>{item.message||notificationLabel(item.type)}</span><small>{item.createdAt?new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"short"}).format(item.createdAt):""}</small></button>):!error&&<p className="notifications-empty">No tienes notificaciones.</p>}</div>}</div>;
}

function notificationLabel(type?:string){return type==="like"?"Te han dado me gusta":type==="match_result"?"Nuevo resultado":"Notificación de LaLiga Brains";}

function SoccerBall() {
  return <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" /><path d="m20 8 6 4-2 7h-8l-2-7 6-4Zm-11 8 5 3 2 8-5 4-6-5 4-10Zm22 0 4 10-6 5-5-4 2-8 5-3ZM11 32l5-5h8l5 5-4 5h-9l-5-5Z" /></svg>;
}
