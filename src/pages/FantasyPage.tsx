import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, BadgeEuro, CircleHelp, Coins, Crown, RefreshCw, Search, ShieldCheck, ShoppingBag, Sparkles, UserPlus, X } from "lucide-react";
import { useAuth } from "../app/AuthContext";
import { database } from "../services/firebase/client";
import { apiRequest } from "../services/api/client";
import { ref, onValue } from "firebase/database";
import "../styles/fantasy.css";

type FantasyPlayer = { id: string; name: string; value: number; permanentInvestment?: number; ownerUid?: string; ownerName?: string; ownerUsername?: string; ownerFantasyCount?: number; ghost?: boolean };
type FantasyOffer = { id: string; playerId: string; buyerUid: string; buyerName?: string; buyerUsername?: string; sellerUid: string; sellerName?: string; sellerUsername?: string; creatorUid: string; creatorName?: string; creatorUsername?: string; recipientUid: string; recipientName?: string; recipientUsername?: string; amount: number; status: string; parentOfferId?: string };
type OfferDraft = { mode: "offer" | "counter"; playerId: string; offerId?: string; playerName: string; amount: string };

const money = (amount: number) => `${Math.round(amount).toLocaleString("es-ES")} monedas`;

export function FantasyPage() {
  const { user } = useAuth();
  const [players, setPlayers] = useState<FantasyPlayer[]>([]);
  const [roster, setRoster] = useState<FantasyPlayer[]>([]);
  const [rosterLimit, setRosterLimit] = useState(5);
  const [extraSlots, setExtraSlots] = useState(0);
  const [offers, setOffers] = useState<FantasyOffer[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [marketFilter, setMarketFilter] = useState<"all" | "available" | "owned">("all");
  const [investments, setInvestments] = useState<Record<string, number>>({});
  const [withdrawals, setWithdrawals] = useState<Record<string, number>>({});
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletError, setWalletError] = useState("");
  const [offerDraft, setOfferDraft] = useState<OfferDraft | null>(null);
  const pendingActionKeys = useRef(new Map<string, string>());

  const load = async () => {
    setLoading(true);
    try {
      const result = await apiRequest<{ players: FantasyPlayer[]; roster: FantasyPlayer[]; offers: FantasyOffer[]; rosterLimit?: number; extraSlots?: number }>("fantasy-action", undefined, { method: "GET" });
      setPlayers(result.players);
      setRoster(result.roster);
      setOffers(result.offers);
      setRosterLimit(Number.isSafeInteger(result.rosterLimit) && Number(result.rosterLimit) >= 5 ? Number(result.rosterLimit) : 5);
      setExtraSlots(Number.isSafeInteger(result.extraSlots) && Number(result.extraSlots) >= 0 ? Number(result.extraSlots) : 0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar el mercado.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!user || !database) {
      setWalletBalance(null);
      setWalletError("No se ha podido conectar con el monedero.");
      return;
    }
    return onValue(ref(database, `laligaBrains/economy/wallets/${user.uid}`), (snapshot) => {
      const value = snapshot.val() as { balance?: unknown } | null;
      setWalletBalance(typeof value?.balance === "number" && Number.isSafeInteger(value.balance) ? value.balance : 0);
      setWalletError("");
    }, () => {
      setWalletBalance(null);
      setWalletError("No se ha podido consultar el saldo de monedas.");
    });
  }, [user]);

  const filteredPlayers = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("es-ES");
    return players.filter((player) => {
      const matchesSearch = !normalized || player.name.toLocaleLowerCase("es-ES").includes(normalized);
      const matchesFilter = marketFilter === "all"
        || (marketFilter === "available" && !player.ownerUid)
        || (marketFilter === "owned" && Boolean(player.ownerUid));
      return matchesSearch && matchesFilter;
    });
  }, [players, search, marketFilter]);

  const canAfford = (amount: number) => {
    if (walletBalance === null) {
      setMessage(walletError || "Espera a que se cargue tu saldo antes de comprar o invertir.");
      return false;
    }
    if (walletBalance < amount) {
      setMessage(`Saldo insuficiente: necesitas ${money(amount)} y tienes ${money(walletBalance)}.`);
      return false;
    }
    return true;
  };

  const postFantasyAction = async (payload: Record<string, unknown>) => {
    const signature = JSON.stringify(payload);
    const key = pendingActionKeys.current.get(signature) ?? crypto.randomUUID();
    pendingActionKeys.current.set(signature, key);
    const result = await apiRequest("fantasy-action", { ...payload, idempotencyKey: key });
    pendingActionKeys.current.delete(signature);
    return result;
  };

  const act = async (action: string, playerId: string, amount?: number) => {
    const player = players.find((item) => item.id === playerId);
    const cost = action === "buy" ? Number(player?.value ?? 0)
      : action === "buyout" ? Number(player?.value ?? 0) * 2
      : action === "invest" ? Number(amount ?? 0) : 0;
    if (cost > 0 && !canAfford(cost)) return;
    setBusy(true);
    setMessage("");
    try {
      await postFantasyAction({ action, playerId, amount });
      setMessage(action === "buy" ? "Jugador fichado correctamente."
        : action === "sell" ? "Jugador liberado al mercado."
        : action === "buyout" ? "Cláusula pagada y traspaso completado."
        : action === "offer" ? "Oferta enviada sin reservar monedas."
        : action === "withdrawInvestment" ? "Inversión retirada y monedas devueltas al monedero."
        : "Inversión añadida al valor del jugador.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo completar el movimiento.");
    } finally {
      setBusy(false);
    }
  };

  const nextSlotPrice = [500, 5000, 50000][Math.min(extraSlots, 2)] ?? 50000;
  const addRosterSlot = async () => {
    if (!canAfford(nextSlotPrice)) return;
    setBusy(true);
    setMessage("");
    try {
      await postFantasyAction({ action: "buySquadSlot" });
      setMessage(`Ampliación comprada por ${money(nextSlotPrice)}. Ya tienes una plaza más.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo ampliar la plantilla.");
    } finally {
      setBusy(false);
    }
  };

  const submitOffer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!offerDraft) return;
    const amount = Number(offerDraft.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setMessage("Escribe una cantidad entera de monedas mayor que cero.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (offerDraft.mode === "offer") {
        await postFantasyAction({ action: "offer", playerId: offerDraft.playerId, amount });
        setMessage("Oferta enviada. Las monedas no se reservan hasta que se acepte.");
      } else {
        await postFantasyAction({ action: "counterOffer", offerId: offerDraft.offerId, amount });
        setMessage("Contraoferta enviada.");
      }
      setOfferDraft(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo enviar la oferta.");
    } finally {
      setBusy(false);
    }
  };

  const respond = async (offer: FantasyOffer, accept: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      await postFantasyAction({ action: "respondOffer", offerId: offer.id, accept });
      setMessage(accept ? "Traspaso aceptado y liquidado." : "Oferta rechazada.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo responder a la oferta.");
    } finally {
      setBusy(false);
    }
  };

  const cancelOffer = async (offerId: string) => {
    setBusy(true);
    setMessage("");
    try {
      await postFantasyAction({ action: "cancelOffer", offerId });
      setMessage("Oferta cancelada.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cancelar la oferta.");
    } finally {
      setBusy(false);
    }
  };

  const playerName = (id: string) => players.find((player) => player.id === id)?.name ?? "Jugador";
  const ownedSlots = Array.from({ length: Math.max(0, rosterLimit - roster.length) });
  const fantasyAssetValue = roster.reduce((total, player) => total + Math.max(0, Number(player.value) || 0), 0);
  const netWorth = walletBalance === null ? null : walletBalance + fantasyAssetValue;

  return <section className="feature-page fantasy-page">
    <div className="fantasy-hero">
      <div className="fantasy-hero-copy">
        <span className="fantasy-eyebrow"><Sparkles size={14} /> MERCADO DE 4 ESO</span>
        <h1>Fantasy</h1>
        <p>Construye tu plantilla, sigue el valor de cada jugador y negocia con otros mánagers.</p>
      </div>
      <button className="fantasy-refresh" onClick={() => void load()} disabled={loading} aria-label="Actualizar mercado">
        <RefreshCw size={17} className={loading ? "is-spinning" : ""} /> <span>Actualizar</span>
      </button>
      <div className="fantasy-hero-ball" aria-hidden="true">⚽</div>
    </div>

    <div className="fantasy-wallet-strip">
      <div className="fantasy-wallet-emblem"><Coins size={22} /></div>
      <div className="fantasy-wallet-copy"><span>Tu patrimonio Fantasy</span><small>Monedero disponible más el valor actual de tu plantilla</small></div>
      <div className="fantasy-wallet-figures"><strong className="fantasy-wallet-value">{netWorth === null ? "—" : netWorth.toLocaleString("es-ES")} <small>monedas</small></strong><span>Monedero {walletBalance === null ? "—" : walletBalance.toLocaleString("es-ES")} · Plantilla {fantasyAssetValue.toLocaleString("es-ES")}</span></div>
      <Link to="/perfil" className="fantasy-wallet-link">Ver movimientos <ArrowUpRight size={15} /></Link>
    </div>
    {walletError && <p className="fantasy-alert" role="alert">{walletError}</p>}

    <div className="fantasy-grid">
      <section className="fantasy-panel fantasy-market-panel">
        <div className="fantasy-panel-heading">
          <div><span className="fantasy-section-kicker">FICHAJES</span><h2>Mercado de jugadores</h2><p>Compra un jugador libre o negocia con su mánager.</p></div>
          <span className="fantasy-count-pill">{players.length} {players.length === 1 ? "jugador" : "jugadores"}</span>
        </div>
        <div className="fantasy-market-tools">
          <label className="fantasy-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar jugador" aria-label="Buscar jugador" /></label>
          <div className="fantasy-filter" role="group" aria-label="Filtrar mercado">
            <button className={marketFilter === "all" ? "active" : ""} onClick={() => setMarketFilter("all")}>Todos</button>
            <button className={marketFilter === "available" ? "active" : ""} onClick={() => setMarketFilter("available")}>Libres</button>
            <button className={marketFilter === "owned" ? "active" : ""} onClick={() => setMarketFilter("owned")}>Con dueño</button>
          </div>
        </div>
        <div className="fantasy-market-list">
          {loading && !players.length ? <div className="fantasy-empty"><span className="fantasy-loader"/><strong>Cargando mercado</strong><small>Consultando jugadores disponibles…</small></div>
            : filteredPlayers.length ? filteredPlayers.map((player, index) => <article className="fantasy-player-row" key={player.id} style={{ animationDelay: `${Math.min(index, 7) * 35}ms` }}>
              <div className={`fantasy-player-mark ${player.ownerUid ? "is-owned" : ""}`} aria-hidden="true">{player.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toLocaleUpperCase("es-ES") || "J"}</div>
              <div className="fantasy-player-identity"><strong>{player.name}</strong><span>{player.ownerUid === user?.uid ? "En tu plantilla" : player.ownerUid ? <>Propietario: <Link className="fantasy-manager-link" to={`/perfil/${encodeURIComponent(player.ownerUid)}`}>{player.ownerName || "Mánager"}{player.ownerUsername ? ` · @${player.ownerUsername}` : ""}</Link><small className="fantasy-owner-count">· {player.ownerFantasyCount ?? 0}/5 jugadores</small></> : player.ghost ? "Perfil de jugador" : "Jugador de 4 ESO"}</span></div>
              <div className="fantasy-player-price"><strong>{player.value.toLocaleString("es-ES")} <small>🪙</small></strong><span>Cláusula {Math.round(player.value * 2).toLocaleString("es-ES")}</span></div>
              <div className="fantasy-market-action">
                {!player.ownerUid ? <button className="fantasy-button fantasy-button-primary" disabled={busy || roster.length >= rosterLimit} title={roster.length >= rosterLimit ? "Tu plantilla está completa; compra una plaza adicional" : undefined} onClick={() => void act("buy", player.id)}><ShoppingBag size={15} /> Fichar</button>
                  : player.ownerUid === user?.uid ? <span className="fantasy-owned-badge"><ShieldCheck size={14} /> En tu equipo</span>
                  : <div className="fantasy-action-stack"><button className="fantasy-button fantasy-button-outline" disabled={busy || roster.length >= rosterLimit} onClick={() => void act("buyout", player.id)}>Rescatar</button><button className="fantasy-text-action" disabled={busy || roster.length >= rosterLimit} onClick={() => setOfferDraft({ mode: "offer", playerId: player.id, playerName: player.name, amount: String(player.value) })}>Hacer oferta</button></div>}
              </div>
            </article>)
              : <div className="fantasy-empty"><Search size={25} /><strong>{players.length ? "No hay resultados" : "El mercado está vacío"}</strong><small>{players.length ? "Prueba con otro nombre o filtro." : "Los jugadores de 4 ESO aparecerán aquí cuando estén disponibles."}</small></div>}
        </div>
        <div className="fantasy-market-footnote"><CircleHelp size={15} /><span>Los fichajes y las cláusulas se confirman antes de descontar monedas. La cláusula equivale al doble del valor.</span></div>
      </section>

      <aside className="fantasy-side-column">
        <section className="fantasy-panel fantasy-squad-panel">
          <div className="fantasy-panel-heading fantasy-squad-heading">
            <div><span className="fantasy-section-kicker">TU EQUIPO</span><h2>Mi plantilla</h2></div>
            <div className="fantasy-squad-count"><strong>{roster.length}</strong><span>/ {rosterLimit}</span></div>
          </div>
          <div className="fantasy-squad-progress"><span style={{ width: `${Math.min(100, roster.length / Math.max(rosterLimit, 1) * 100)}%` }} /></div>
          <p className="fantasy-squad-caption">{roster.length === rosterLimit ? "Plantilla completa" : `Te ${rosterLimit - roster.length === 1 ? "queda" : "quedan"} ${rosterLimit - roster.length} ${rosterLimit - roster.length === 1 ? "plaza" : "plazas"} disponibles`}</p>
          <div className="fantasy-slot-upgrade"><div><strong>Ampliar plantilla</strong><small>Una plaza permanente · próxima: {money(nextSlotPrice)}</small></div><button className="fantasy-button fantasy-button-outline" disabled={busy} onClick={() => void addRosterSlot()}><UserPlus size={15}/> Añadir plaza</button></div>
          <p className="fantasy-slot-pricing">Coste por plaza extra: 500, 5.000 y 50.000 monedas; las siguientes también cuestan 50.000. El fichaje del jugador se paga aparte.</p>
          <div className="fantasy-roster-list">
            {roster.map((player) => <article className="fantasy-roster-player" key={player.id}>
              <div className="fantasy-player-mark roster-mark" aria-hidden="true">{player.name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toLocaleUpperCase("es-ES") || "J"}</div>
              <div className="fantasy-player-identity"><strong>{player.name}</strong><span>Valor actual · {money(player.value)}</span><small>Inversión permanente · {money(player.permanentInvestment ?? 0)}</small></div>
              <button className="fantasy-icon-action" aria-label={`Vender a ${player.name} al mercado`} title="Vender al mercado" disabled={busy} onClick={() => void act("sell", player.id)}><ArrowDownLeft size={16} /></button>
              <div className="fantasy-invest-control"><label htmlFor={`invest-${player.id}`}>Invertir</label><span className="fantasy-invest-input"><input id={`invest-${player.id}`} type="number" inputMode="numeric" min="1" step="1" value={investments[player.id] ?? 10} onChange={(event) => setInvestments({ ...investments, [player.id]: Number(event.target.value) })} aria-label={`Monedas para invertir en ${player.name}`} /><button disabled={busy} onClick={() => void act("invest", player.id, investments[player.id] ?? 10)}>Añadir</button></span></div>
              {(player.permanentInvestment ?? 0) > 0 && <div className="fantasy-invest-control fantasy-withdraw-control"><label htmlFor={`withdraw-${player.id}`}>Retirar inversión</label><span className="fantasy-invest-input"><input id={`withdraw-${player.id}`} type="number" inputMode="numeric" min="1" max={player.permanentInvestment} step="1" value={withdrawals[player.id] ?? player.permanentInvestment} onChange={(event) => setWithdrawals({ ...withdrawals, [player.id]: Number(event.target.value) })} aria-label={`Monedas de inversión para retirar de ${player.name}`} /><button disabled={busy} onClick={() => void act("withdrawInvestment", player.id, withdrawals[player.id] ?? player.permanentInvestment)}>Retirar</button></span><small>El valor del jugador bajará en la misma cantidad.</small></div>}
            </article>)}
            {ownedSlots.map((_, index) => <div className="fantasy-empty-slot" key={`slot-${index}`}><span className="fantasy-slot-plus">+</span><span>Espacio libre</span><small>Ficha a un jugador del mercado</small></div>)}
          </div>
          {!roster.length && <div className="fantasy-squad-note"><Crown size={17} /><span>Tu equipo empieza con cinco plazas. Elige jugadores del mercado para completar la plantilla o amplíala para fichar más.</span></div>}
        </section>

        <section className="fantasy-panel fantasy-transfer-panel">
          <div className="fantasy-panel-heading"><div><span className="fantasy-section-kicker">NEGOCIACIÓN</span><h2>Ofertas</h2></div><BadgeEuro size={19} /></div>
          <p className="fantasy-offer-note">Las ofertas no bloquean el saldo. Todo se comprueba de nuevo al aceptar.</p>
          {offers.length ? <div className="fantasy-offer-list">{offers.slice().sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending")).map((offer) => {
            return <article className="fantasy-offer-row" key={offer.id}>
            <div className="fantasy-offer-title"><div><strong>{playerName(offer.playerId)}</strong><span>{offerStatus(offer.status)}</span></div><b>{money(offer.amount)}</b></div>
            <div className="fantasy-offer-participants"><span>De <Link to={`/perfil/${encodeURIComponent(offer.creatorUid)}`}>{offer.creatorName || "Mánager"}{offer.creatorUsername ? ` · @${offer.creatorUsername}` : ""}</Link></span><span>Para <Link to={`/perfil/${encodeURIComponent(offer.recipientUid)}`}>{offer.recipientName || "Mánager"}{offer.recipientUsername ? ` · @${offer.recipientUsername}` : ""}</Link></span></div>
            {offer.status === "pending" && offer.recipientUid === user?.uid && <div className="fantasy-offer-actions"><button className="fantasy-button fantasy-button-primary" disabled={busy} onClick={() => void respond(offer, true)}>Aceptar</button><button className="fantasy-button fantasy-button-outline" disabled={busy} onClick={() => setOfferDraft({ mode: "counter", playerId: offer.playerId, offerId: offer.id, playerName: playerName(offer.playerId), amount: String(offer.amount) })}>Contraoferta</button><button className="fantasy-text-action" disabled={busy} onClick={() => void respond(offer, false)}>Rechazar</button></div>}
            {offer.status === "pending" && offer.creatorUid === user?.uid && <button className="fantasy-text-action" disabled={busy} onClick={() => void cancelOffer(offer.id)}>Cancelar oferta</button>}
          </article>})}</div> : <div className="fantasy-offers-empty"><span><ArrowUpRight size={17} /></span><p>Cuando envíes o recibas una oferta, podrás gestionarla aquí.</p></div>}
        </section>
      </aside>
    </div>

    {message && <div className={`fantasy-message ${/^(Saldo insuficiente|No se|Tu plantilla|Este jugador|El comprador|No eres|Solo puedes|La oferta|La contraoferta|La inversión|La retirada|Espera|Escribe|No tienes|La operación)/.test(message) ? "is-error" : "is-success"}`} role="status"><span>{message}</span><button aria-label="Cerrar aviso" onClick={() => setMessage("")}><X size={16} /></button></div>}

    {offerDraft && <div className="fantasy-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOfferDraft(null); }}>
      <section className="fantasy-offer-modal" role="dialog" aria-modal="true" aria-labelledby="offer-modal-title">
        <button className="fantasy-modal-close" aria-label="Cerrar" disabled={busy} onClick={() => setOfferDraft(null)}><X size={18} /></button>
        <span className="fantasy-modal-icon"><BadgeEuro size={22} /></span>
        <span className="fantasy-section-kicker">MERCADO FANTASY</span>
        <h2 id="offer-modal-title">{offerDraft.mode === "counter" ? "Enviar contraoferta" : "Hacer una oferta"}</h2>
        <p>Por <strong>{offerDraft.playerName}</strong>. No se descontarán monedas hasta que la oferta se acepte.</p>
        <form onSubmit={(event) => void submitOffer(event)}>
          <label>Importe de la oferta <span className="fantasy-modal-amount"><input type="number" min="1" step="1" inputMode="numeric" autoFocus value={offerDraft.amount} onChange={(event) => setOfferDraft({ ...offerDraft, amount: event.target.value })} /><b>🪙</b></span></label>
          {message && <span className="fantasy-modal-error" role="alert">{message}</span>}
          <div><button className="fantasy-button fantasy-button-outline" type="button" disabled={busy} onClick={() => { setOfferDraft(null); setMessage(""); }}>Cancelar</button><button className="fantasy-button fantasy-button-primary" type="submit" disabled={busy}>{busy ? "Enviando…" : "Enviar oferta"}</button></div>
        </form>
      </section>
    </div>}
  </section>;
}

function offerStatus(status: string) {
  const labels: Record<string, string> = { pending: "pendiente", accepted: "aceptada", rejected: "rechazada", cancelled: "cancelada", countered: "con contraoferta" };
  return labels[status] ?? "cerrada";
}
