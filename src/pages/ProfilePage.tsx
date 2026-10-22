import { useEffect, useState } from "react";
import { deleteObject, ref as storageRef, uploadBytes } from "firebase/storage";
import { Coins, ShieldCheck, Camera } from "lucide-react";
import { useAuth } from "../app/AuthContext";
import { getFirebaseStorage } from "../services/firebase/client";
import { apiRequest } from "../services/api/client";
import type { WalletView, CoinTransaction } from "../types/domain";
import { UserAvatar } from "../components/UserAvatar";

export function ProfilePage() {
  const { user, profile } = useAuth();
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [fantasyPlayers, setFantasyPlayers] = useState<Array<{ id: string; name: string; value: number }>>([]);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [nickname, setNickname] = useState(profile?.nickname ?? "");
  const [photoPath, setPhotoPath] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDisplayName(profile?.displayName ?? ""); setNickname(profile?.nickname ?? ""); setPhotoPath(profile?.photoPath ?? ""); }, [profile?.displayName, profile?.nickname, profile?.photoPath]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const refresh = async () => {
      try {
        const [walletData, fantasyData] = await Promise.all([
          apiRequest<{ wallet: WalletView; transactions: CoinTransaction[] }>("wallet-action", undefined, { method: "GET" }),
          apiRequest<{ players: Array<{ id: string; name: string; value: number; ownerUid?: string; archived?: boolean }> }>("fantasy-action", undefined, { method: "GET" }),
        ]);
        if (!active) return;
        setWallet(walletData.wallet);
        setTransactions(walletData.transactions);
        setFantasyPlayers(fantasyData.players
          .filter((player) => player.ownerUid === user.uid && player.archived !== true)
          .map((player) => ({ id: player.id, name: player.name, value: Number(player.value ?? 50) }))
          .filter((player) => Number.isSafeInteger(player.value) && player.value > 0));
      } catch (error) {
        if (active) console.error("No se pudieron actualizar los datos del perfil.", error);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [user]);
  const walletBalance = Number(wallet?.balance ?? 0);
  const fantasyAssetValue = fantasyPlayers.reduce((total, player) => total + player.value, 0);
  const netWorth = walletBalance + fantasyAssetValue;
  const saveProfile = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setMessage(""); try { await apiRequest("profile-action",{displayName,nickname,photoPath});setMessage("Perfil actualizado."); } catch(error) { setMessage(error instanceof Error?error.message:"No se pudo guardar el perfil."); } finally { setBusy(false); } };
  const uploadPhoto = async (file?:File) => {
    if (!file || !user) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5*1024*1024) { setMessage("Elige una imagen JPG, PNG o WebP de hasta 5 MB."); return; }
    setBusy(true);setMessage("");
    const extension=file.type==="image/png"?"png":file.type==="image/webp"?"webp":"jpg";
    const path=`profilePhotos/${user.uid}/${crypto.randomUUID()}.${extension}`;
    const previousPath=photoPath;
    let uploadedStorage: Awaited<ReturnType<typeof getFirebaseStorage>> | undefined;
    try {
      uploadedStorage=await getFirebaseStorage();
      await uploadBytes(storageRef(uploadedStorage,path),file,{contentType:file.type});
      await apiRequest("profile-action",{photoPath:path});
      setPhotoPath(path);
      setMessage("Foto de perfil actualizada.");
      if (previousPath && previousPath !== path) await deleteObject(storageRef(uploadedStorage,previousPath)).catch(()=>undefined);
    }
    catch(error) { if(uploadedStorage)await deleteObject(storageRef(uploadedStorage,path)).catch(()=>undefined);setMessage(error instanceof Error?error.message:"No se pudo cargar la foto."); }
    finally { setBusy(false); }
  };
  const changePassword = async (event:React.FormEvent) => { event.preventDefault();setBusy(true);setMessage("");try{await apiRequest("change-password",{password:newPassword});setMessage("Contraseña actualizada. Actualizando la sesión…");setTimeout(()=>window.location.reload(),700);}catch(error){setMessage(error instanceof Error?error.message:"No se pudo cambiar la contraseña.");}finally{setBusy(false);}};

  return <section className="feature-page"><div className="page-heading"><div><h1>Perfil</h1><p>Tu cuenta y actividad en LaLiga Brains.</p></div></div><div className="profile-layout">
    <section className="profile-card profile-editor-card"><div className="profile-avatar"><UserAvatar photoPath={photoPath} name={displayName || profile?.username || "tu cuenta"} size={72} className="profile-avatar-image"/></div><div className="profile-person-heading"><h2>{profile?.displayName||profile?.username}</h2><p>@{profile?.username}</p></div><form className="profile-edit-form" onSubmit={(event)=>void saveProfile(event)}><label>Nombre visible<input required minLength={2} maxLength={40} value={displayName} onChange={(event)=>setDisplayName(event.target.value)}/></label><label>Apodo<input maxLength={30} value={nickname} onChange={(event)=>setNickname(event.target.value)}/></label><label className="photo-upload"><span><Camera size={15}/> {busy?"Guardando foto…":"Cambiar foto de perfil"}<small>JPG, PNG o WebP · máximo 5 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event)=>{const file=event.target.files?.[0];event.target.value="";void uploadPhoto(file);}}/></label><button className="button button-primary button-small" disabled={busy}>{busy?"Guardando…":"Guardar cambios"}</button>{message&&<p className="inline-message" role={message.startsWith("No se")?"alert":"status"}>{message}</p>}</form><div className="profile-detail"><span>Tipo de usuario</span><strong>{profile?.role==="player_3eso"?"Jugador de 3 ESO":profile?.role==="player_4eso"?"Jugador de 4 ESO":"Espectador"}</strong></div><div className="profile-detail"><span>Identificador de cuenta</span><code>{user?.uid}</code></div></section>
    <section className="wallet-card"><div className="wallet-heading"><span className="wallet-icon"><Coins size={21}/></span><div><h2>Monedero</h2><span>Monedas virtuales · sin valor económico</span></div></div><span className="wallet-balance-label">Monedas disponibles para gastar</span><strong className="wallet-balance">{walletBalance.toLocaleString("es-ES")} <small>🪙</small></strong><div className="profile-net-worth"><span>Patrimonio total</span><strong>{netWorth.toLocaleString("es-ES")} <small>monedas</small></strong><small>Monedero {walletBalance.toLocaleString("es-ES")} + plantilla Fantasy {fantasyAssetValue.toLocaleString("es-ES")}</small></div>{fantasyPlayers.length>0&&<div className="profile-fantasy-assets"><h3>Valor de tu plantilla</h3>{fantasyPlayers.map((player)=><div key={player.id}><span>{player.name}</span><strong>{player.value.toLocaleString("es-ES")} 🪙</strong></div>)}</div>}<p>Tu saldo se actualiza al confirmar cada operación. El valor de Fantasy no se puede gastar hasta vender al jugador o retirar su inversión.</p><div className="transaction-list"><h3>Movimientos recientes</h3>{transactions.length?transactions.slice(0,12).map((item)=><div className="transaction-row" key={item.id}><span>{transactionLabel(item.type)}</span><strong className={item.amount<0?"negative":"positive"}>{item.amount>0?"+":""}{item.amount}</strong><small>{new Intl.DateTimeFormat("es-ES",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Madrid"}).format(item.createdAt)}</small></div>):<p className="muted-note">Todavía no hay movimientos.</p>}</div></section>
    <section className="security-card"><ShieldCheck size={22}/><div><h2>Seguridad de la cuenta</h2><p>La contraseña se gestiona de forma segura con Firebase Authentication.</p><p>UID de Firebase: <code>{user?.uid}</code></p>{profile?.mustChangePassword&&<form className="change-password-form" onSubmit={(event)=>void changePassword(event)}><label>Establece una contraseña nueva<input required minLength={10} type="password" autoComplete="new-password" value={newPassword} onChange={(event)=>setNewPassword(event.target.value)}/></label><button className="button button-primary button-small" disabled={busy}>Cambiar contraseña</button></form>}</div></section>
  </div></section>;
}

function transactionLabel(type:string){const labels:Record<string,string>={registration_bonus:"Bono de registro",penalty_win:"Victoria en penaltis",fantasy_goal:"Goles Fantasy",fantasy_goal_adjustment:"Corrección de recompensa Fantasy",fantasy_purchase:"Fichaje Fantasy",fantasy_sale:"Venta Fantasy",fantasy_buyout:"Cláusula de rescisión",fantasy_transfer:"Traspaso Fantasy",fantasy_transfer_received:"Traspaso recibido",fantasy_investment:"Inversión Fantasy",fantasy_investment_withdrawal:"Retirada de inversión Fantasy",piero_player_retirement:"Retirada de jugador Fantasy",piero_fantasy_reset:"Reinicio de economía Fantasy",extra_social_post:"Publicación extra",post_promotion:"Promoción de publicación",prediction_stake:"Ajuste histórico de monedas",prediction_stake_refund:"Ajuste histórico de monedas",prediction_payout:"Ajuste histórico de monedas",prediction_refund:"Ajuste histórico de monedas",prediction_correction:"Ajuste histórico de monedas",prediction_cancel_correction:"Ajuste histórico de monedas",prediction_cancel_refund:"Ajuste histórico de monedas",prediction_retirement_reversal:"Ajuste histórico de monedas",piero_adjustment:"Ajuste de Piero"};return labels[type]??"Movimiento de monedas";}
