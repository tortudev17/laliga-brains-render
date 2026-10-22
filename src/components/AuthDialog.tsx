import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { useAuth } from "../app/AuthContext";
import type { UserRole } from "../types/domain";

export function AuthDialog({ mode, onClose, onChangeMode }: { mode: "login" | "register"; onClose: () => void; onChangeMode: (mode: "login" | "register") => void }) {
  const { login, register } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<UserRole | null>(null);
  const [message, setMessage] = useState("");
  const [pendingApproval, setPendingApproval] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (mode === "register" && password !== confirm) { setMessage("Las contraseñas no coinciden."); return; }
    if (mode === "register" && !role) { setMessage("Selecciona un tipo de usuario para continuar."); return; }
    setBusy(true);
    try {
      if (mode === "login") { await login(username, password); onClose(); }
      else { const result = await register(username, password, role!); setPendingApproval(result.pendingApproval); setRegistrationComplete(true); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo completar la solicitud."); }
    finally { setBusy(false); }
  };

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="icon-button dialog-close" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
      <span className="dialog-mark"><ShieldCheck size={23} /></span>
      <h2 id="auth-title">{registrationComplete ? "Cuenta creada" : recoveryMode ? "Recuperar contraseña" : mode === "login" ? "Inicia sesión" : "Crea tu cuenta"}</h2>
      <p>{registrationComplete ? pendingApproval ? "Tu solicitud de jugador está pendiente de aprobación. Cuando Piero la apruebe, recibirás tus 120 monedas iniciales." : "Tu cuenta ya está lista y tienes 120 monedas iniciales." : recoveryMode ? "Las cuentas usan un correo interno sin buzón. Para recuperar el acceso, contacta con Piero para que cambie la contraseña desde Firebase Authentication." : mode === "login" ? "Entra con tu nombre de usuario y contraseña." : "Elige un usuario y una contraseña para empezar."}</p>
      {registrationComplete ? <div className="recovery-panel">
        <strong>Nombre de usuario</strong><code>{username.trim().toLowerCase()}</code>
        <span>Guarda tu usuario. No se genera un código de recuperación porque Firebase Authentication no puede cambiar una contraseña ajena desde el navegador.</span>
        <button className="button button-primary full-button" onClick={onClose}>Continuar</button>
      </div> : recoveryMode ? <div className="recovery-panel">
        <strong>Necesitas ayuda de Piero</strong><span>El correo de acceso se genera automáticamente y no recibe mensajes. Piero tendrá que cambiar la contraseña desde la consola de Firebase.</span>
        <button type="button" className="plain-link" onClick={() => { setRecoveryMode(false); setMessage(""); }}>Volver al inicio de sesión</button>
      </div> : <form onSubmit={(event) => void submit(event)}>
        <label>Usuario<input required minLength={3} maxLength={20} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Tu nombre de usuario" /></label>
        <label>Contraseña<input required minLength={10} autoComplete={mode === "login" ? "current-password" : "new-password"} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Al menos 10 caracteres" /></label>
        {mode === "register" && <>
          <label>Confirmar contraseña<input required type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
          <div className="role-select-row">
            <label>Tipo de usuario<select required value={role ?? ""} onChange={(event) => setRole(event.target.value ? event.target.value as UserRole : null)}>
              <option value="">Seleccionar tipo de usuario</option><option value="player_3eso">Jugador de 3 ESO</option><option value="player_4eso">Jugador de 4 ESO</option><option value="spectator">Espectador</option>
            </select></label>
            <button type="button" className="button button-secondary button-small role-deselect" disabled={!role} onClick={() => setRole(null)}>Deseleccionar</button>
          </div>
        </>}
        {message && <p className="error-message" role="alert">{message}</p>}
        <button className="button button-primary full-button" disabled={busy || (mode === "register" && !role)}>{busy ? "Un momento…" : mode === "login" ? "Iniciar sesión" : "Crear cuenta"}</button>
        {mode === "login" && <button type="button" className="plain-link" onClick={() => setRecoveryMode(true)}>¿Has olvidado la contraseña?</button>}
        <button type="button" className="plain-link" onClick={() => { setRole(null); onChangeMode(mode === "login" ? "register" : "login"); }}>{mode === "login" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}</button>
      </form>}
    </section>
  </div>;
}
