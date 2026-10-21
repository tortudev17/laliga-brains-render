import { useEffect, useState } from "react";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { limitToLast, onValue, orderByChild, query, ref } from "firebase/database";
import { Coins, ShieldCheck, UserRound, Camera } from "lucide-react";
import { useAuth } from "../app/AuthContext";
import { database, getFirebaseStorage } from "../services/firebase/client";
import { apiRequest } from "../services/api/client";
import type { WalletView, CoinTransaction } from "../types/domain";

export function ProfilePage() {
  const { user, profile } = useAuth();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [nickname, setNickname] = useState(profile?.nickname ?? "");
  const [photoPath, setPhotoPath] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDisplayName(profile?.displayName ?? ""); setNickname(profile?.nickname ?? ""); setPhotoPath(profile?.photoPath ?? ""); }, [profile?.displayName, profile?.nickname, profile?.photoPath]);
  useEffect(() => {
    if (!user || !database) return;
    const walletUnsubscribe = onValue(ref(database, `laligaBrains/economy/wallets/${user.uid}`), (snapshot) => setWallet(snapshot.val()));
    const ledgerUnsubscribe = onValue(query(ref(database, `laligaBrains/economy/ledger/${user.uid}`), orderByChild("createdAt"), limitToLast(50)), (snapshot) => {
      const rows = Object.values((snapshot.val() ?? {}) as Record<string, CoinTransaction>).sort((a,b)=>b.createdAt-a.createdAt);
      setTransactions(rows);
    });
    return () => { walletUnsubscribe(); ledgerUnsubscribe(); };
  }, [user]);
  useEffect(() => {
    if (!profile?.photoPath) return;
    void getFirebaseStorage().then((storage)=>getDownloadURL(storageRef(storage,profile.photoPath!))).then(setPhotoUrl).catch(()=>setPhotoUrl(""));
  }, [profile?.photoPath]);

  const saveProfile = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setMessage(""); try { await apiRequest("profile-action",{displayName,nickname,photoPath});setMessage("Perfil actualizado."); } catch(error) { setMessage(error instanceof Error?error.message:"No se pudo guardar el perfil."); } finally { setBusy(false); } };
  const uploadPhoto = async (file?:File) => {
    if (!file || !user) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5*1024*1024) { setMessage("Elige una imagen JPG, PNG o WebP de hasta 5 MB."); return; }
    setBusy(true);setMessage("");
    const extension=file.type==="image/png"?"png":file.type==="image/webp"?"webp":"jpg";
    const path=`profilePhotos/${user.uid}/${crypto.randomUUID()}.${extension}`;
    let uploadedStorage: Awaited<ReturnType<typeof getFirebaseStorage>> | undefined;
    try { uploadedStorage=await getFirebaseStorage();await uploadBytes(storageRef(uploadedStorage,path),file,{contentType:file.type});setPhotoPath(path);setPhotoUrl(URL.createObjectURL(file));setMessage("Foto cargada. Guarda el perfil para publicarla."); }
    catch(error) { if(uploadedStorage)await deleteObject(storageRef(uploadedStorage,path)).catch(()=>undefined);setMessage(error instanceof Error?error.message:"No se pudo cargar la foto."); }
    finally { setBusy(false); }
  };
  const changePassword = async (event:React.FormEvent) => { event.preventDefault();setBusy(true);setMessage("");try{await apiRequest("change-password",{password:newPassword});setMessage("Contraseña actualizada. Actualizando la sesión…");setTimeout(()=>window.location.reload(),700);}catch(error){setMessage(error instanceof Error?error.message:"No se pudo cambiar la contraseña.");}finally{setBusy(false);}};

  return <section className="feature-page"><div className="page-heading"><div><h1>Perfil</h1><p>Tu cuenta y actividad en LaLiga Brains.</p></div></div><div className="profile-layout">
    <section className="profile-card"><div className="profile-avatar">{photoUrl?<img src={photoUrl} alt="Foto de perfil"/>:<UserRound size={30}/>}</div><div><h2>{profile?.displayName||profile?.username}</h2><p>@{profile?.username}</p></div><form className="profile-edit-form" onSubmit={(event)=>void saveProfile(event)}><label>Nombre visible<input required minLength={2} maxLength={40} value={displayName} onChange={(event)=>setDisplayName(event.target.value)}/></label><label>Apodo<input maxLength={30} value={nickname} onChange={(event)=>setNickname(event.target.value)}/></label><label className="photo-upload"><span><Camera size={15}/> Foto de perfil · JPG, PNG o WebP hasta 5 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event)=>void uploadPhoto(event.target.files?.[0])}/></label><button className="button button-primary button-small" disabled={busy}>Guardar perfil</button>{message&&<p className="inline-message" role="status">{message}</p>}</form><div className="profile-detail"><span>Tipo de usuario</span><strong>{profile?.role==="player_3eso"?"Jugador de 3 ESO":profile?.role==="player_4eso"?"Jugador de 4 ESO":"Espectador"}</strong></div><div className="profile-detail"><span>Identificador de cuenta</span><code>{user?.uid}</code></div></section>
    <section className="wallet-card"><div className="wallet-heading"><span className="wallet-icon"><Coins size={21}/></span><div><h2>Monedero</h2><span>Monedas virtuales · sin valor económico</span></div></div><strong className="wallet-balance">{wallet?.balance??0} <small>🪙</small></strong><p>Tu saldo se actualiza al confirmar cada operación.</p><div className="transaction-list"><h3>Movimientos recientes</h3>{transactions.length?transactions.slice(0,12).map((item)=><div className="transaction-row" key={item.id}><span>{transactionLabel(item.type)}</span><strong className={item.amount<0?"negative":"positive"}>{item.amount>0?"+":""}{item.amount}</strong><small>{new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Madrid"}).format(item.createdAt)}</small></div>):<p className="muted-note">Todavía no hay movimientos.</p>}</div></section>
    <section className="security-card"><ShieldCheck size={22}/><div><h2>Seguridad de la cuenta</h2><p>La contraseña se gestiona de forma segura con Firebase Authentication.</p><p>UID de Firebase: <code>{user?.uid}</code></p>{profile?.mustChangePassword&&<form className="change-password-form" onSubmit={(event)=>void changePassword(event)}><label>Establece una contraseña nueva<input required minLength={10} type="password" autoComplete="new-password" value={newPassword} onChange={(event)=>setNewPassword(event.target.value)}/></label><button className="button button-primary button-small" disabled={busy}>Cambiar contraseña</button></form>}</div></section>
  </div></section>;
}

function transactionLabel(type:string){const labels:Record<string,string>={registration_bonus:"Bono de registro",penalty_win:"Victoria en penaltis",fantasy_goal:"Goles Fantasy",fantasy_goal_adjustment:"Corrección de recompensa Fantasy",fantasy_purchase:"Fichaje Fantasy",fantasy_sale:"Venta Fantasy",fantasy_buyout:"Cláusula de rescisión",fantasy_transfer:"Traspaso Fantasy",fantasy_transfer_received:"Traspaso recibido",fantasy_investment:"Inversión Fantasy",extra_social_post:"Publicación extra",post_promotion:"Promoción de publicación",prediction_stake:"Movimiento histórico de pronósticos",prediction_stake_refund:"Ajuste histórico de pronósticos",prediction_payout:"Movimiento histórico de pronósticos",prediction_refund:"Ajuste histórico de pronósticos",prediction_correction:"Ajuste histórico de pronósticos",prediction_cancel_correction:"Ajuste histórico de pronósticos",prediction_cancel_refund:"Ajuste histórico de pronósticos",prediction_retirement_reversal:"Revisión histórica de pronósticos",piero_adjustment:"Ajuste de Piero"};return labels[type]??"Movimiento de monedas";}
