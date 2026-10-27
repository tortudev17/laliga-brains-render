(() => {
  const moneyFormat = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
  const avatarChoices = ["⚽", "🦁", "🐺", "🦊", "🐼", "🐸", "⭐", "🏆"];
  let options = null;
  let cachedMatches = [];
  let selectedPlayer = "";
  let goalPlayers = [];
  let fantasySnapshot = null;

  const byId = (id) => document.getElementById(id);
  const money = (value) => `${moneyFormat.format(Number(value) || 0)} monedas`;

  function context() {
    if (!options) throw new Error("La aplicación todavía no está lista.");
    const idToken = options.getIdToken?.();
    const username = String(options.getUsername?.() || "").trim();
    if (!idToken || !username) throw new Error("Inicia sesión para continuar.");
    return { idToken, username };
  }

  function setStatus(selector, message, kind = "") {
    const element = byId(selector);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-error", kind === "error");
    element.classList.toggle("is-success", kind === "success");
    element.hidden = !message;
  }

  function announce(message) {
    options?.notify?.(message);
  }

  function translateError(error, fallback) {
    const message = String(error?.message || "");
    if (/three players|at most three|max(?:imum)? three/i.test(message)) return "Tu equipo ya tiene tres jugadores.";
    if (/not enough coins|insufficient|balance/i.test(message)) return "No tienes suficientes monedas.";
    if (/no longer on your team|no longer owned|no longer pending|state has changed/i.test(message)) return "El estado ha cambiado. Actualiza la aplicación.";
    if (/already has an owner|already owned/i.test(message)) return "Este jugador ya tiene dueño.";
    if (/no longer owned|no longer pending/i.test(message)) return "El estado ha cambiado. Actualiza la aplicación.";
    if (/Firebase request failed/i.test(message)) return "No se pudo guardar el cambio en Firebase.";
    if (/network|reached/i.test(message)) return "No se pudo conectar. Comprueba tu conexión.";
    if (/auth|token|signed in/i.test(message)) return "Vuelve a iniciar sesión para continuar.";
    return fallback;
  }

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  async function refreshGoals() {
    const list = byId("goles-player-list");
    if (!list) return;
    list.replaceChildren();
    setStatus("goles-status", "Cargando goleadores…");
    try {
      const { idToken } = context();
      const [loadedMatches, fantasyPlayers] = await Promise.all([
        window.PartidosData.loadMatches(options.baseUrl, idToken),
        window.PartidosData.loadFantasyPlayers(options.baseUrl, idToken).catch(() => [])
      ]);
      cachedMatches = loadedMatches;
      const playerMap = new Map();
      const playerIdsByName = new Map();
      for (const player of fantasyPlayers) {
        const name = String(player.name || player.id).trim();
        const key = `player:${player.id}`;
        playerIdsByName.set(name.toLocaleLowerCase("es-ES"), key);
        playerMap.set(key, { id: player.id, name, goals: 0, matchGoals: 0, manualGoals: Math.max(0, Number(player.manualGoals) || 0), matches: [] });
      }
      for (const match of cachedMatches) {
        for (const scorer of match.scorerEntries || []) {
          if (scorer.unknown) continue;
          const name = String(scorer.name || "").trim();
          const goals = Math.max(0, Number(scorer.goals) || 0);
          if (!name || !goals) continue;
          const key = scorer.playerId
            ? `player:${scorer.playerId}`
            : playerIdsByName.get(name.toLocaleLowerCase("es-ES")) || `name:${name.toLocaleLowerCase("es-ES")}`;
          const player = playerMap.get(key) || { name, goals: 0, matchGoals: 0, manualGoals: 0, matches: [] };
          player.name ||= name;
          player.matchGoals += goals;
          player.matches.push({ match, goals });
          playerMap.set(key, player);
        }
      }
      goalPlayers = [...playerMap.values()].map((player) => ({ ...player, goals: player.matchGoals + player.manualGoals }))
        .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name, "es"));
      if (!goalPlayers.length) {
        setStatus("goles-status", "Todavía no hay goles de 4.º ESO.");
        return;
      }
      setStatus("goles-status", "");
      for (const player of goalPlayers) {
        const heading = document.createElement("button");
        heading.type = "button";
        heading.className = "player-row goal-player-toggle";
        heading.dataset.playerName = player.name;
        heading.setAttribute("aria-label", `${player.name}, ${player.goals} ${player.goals === 1 ? "gol" : "goles"}. Ver jugador`);
        heading.innerHTML = `<span class="goal-player-list-icon" aria-hidden="true">⚽</span><strong>${escapeText(player.name)}</strong><span>${player.goals} ${player.goals === 1 ? "gol" : "goles"}</span><span class="goal-player-chevron" aria-hidden="true">›</span>`;
        list.append(heading);
      }
    } catch (error) {
      setStatus("goles-status", translateError(error, "No se pudieron cargar los goleadores."), "error");
    }
  }

  function displayGoalPlayer(player) {
    if (!player) return false;
    selectedPlayer = String(player.name || "");
    const name = selectedPlayer;
    byId("goles-detail-name").textContent = name;
    byId("goles-detail-total").textContent = String(Math.max(0, Number(player.goals) || 0));
    byId("goles-detail-matches").replaceChildren();
    const avatar = byId("goles-detail-avatar");
    if (avatar) avatar.textContent = "⚽";
    const matches = Array.isArray(player.matches) ? player.matches : [];
    if (player.manualGoals) {
      const manual = document.createElement("p");
      manual.className = "goal-manual-count";
      manual.textContent = `${player.manualGoals} ${player.manualGoals === 1 ? "gol añadido fuera de partido" : "goles añadidos fuera de partido"}`;
      byId("goles-detail-matches").append(manual);
    }
    for (const item of matches) {
      const match = item.match || item;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "player-match player-match-button";
      button.dataset.matchId = match.id || "";
      button.innerHTML = `<time>${escapeText(match.dateLabel || "Fecha no disponible")}</time><span>${escapeText(match.resultText || match.scoreText || "Resultado no disponible")} · ${Number(item.goals ?? item.scorerGoals ?? 0)} ${Number(item.goals ?? item.scorerGoals ?? 0) === 1 ? "gol" : "goles"}</span>`;
      byId("goles-detail-matches").append(button);
    }
    if (!matches.length && !player.manualGoals) {
      const empty = document.createElement("p");
      empty.className = "goal-manual-count";
      empty.textContent = "Todavía no ha marcado en ningún partido.";
      byId("goles-detail-matches").append(empty);
    }
    byId("goles-player-detail").removeAttribute("hidden");
    window.AppStack?.push("goles", {
      id: "jugador",
      title: name,
      panels: ["#goles-player-detail"],
      container: ".goles-content"
    });
    return true;
  }

  function showGoalPlayer(name) {
    const sought = String(name || "").trim().toLocaleLowerCase("es-ES");
    const player = goalPlayers.find((item) => item.name.toLocaleLowerCase("es-ES") === sought);
    if (player) return displayGoalPlayer(player);
    return false;
  }

  async function refreshReminders() {
    const list = byId("objetivo-list");
    if (!list) return;
    list.replaceChildren();
    setStatus("objetivos-status", "Cargando objetivos…");
    try {
      const { idToken, username } = context();
      const data = await window.UserAppsData.loadReminders(options.baseUrl, idToken, username);
      const items = Object.entries(data || {}).filter(([, item]) => item && typeof item === "object")
        .sort((a, b) => Number(a[1].createdAt || 0) - Number(b[1].createdAt || 0));
      if (!items.length) {
        setStatus("objetivos-status", "Aún no tienes objetivos. Añade el primero arriba.");
        return;
      }
      setStatus("objetivos-status", "");
      for (const [id, item] of items) {
        const row = document.createElement("article");
        row.className = "objective-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.done === true;
        checkbox.setAttribute("aria-label", `Marcar como ${checkbox.checked ? "pendiente" : "completado"}: ${item.text || "objetivo"}`);
        checkbox.dataset.reminderAction = "toggle";
        checkbox.dataset.reminderId = id;
        const text = document.createElement("span");
        text.className = "objective-copy";
        text.textContent = String(item.text || "Objetivo");
        text.classList.toggle("is-done", checkbox.checked);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "objective-delete";
        remove.dataset.reminderAction = "delete";
        remove.dataset.reminderId = id;
        remove.textContent = "Eliminar";
        row.append(checkbox, text, remove);
        list.append(row);
      }
    } catch (error) {
      setStatus("objetivos-status", translateError(error, "No se pudieron cargar tus objetivos."), "error");
    }
  }

  async function addReminder(event) {
    event.preventDefault();
    const input = byId("objetivo-input");
    const text = input?.value.trim();
    if (!text) {
      input?.focus();
      setStatus("objetivos-status", "Escribe un objetivo antes de guardarlo.", "error");
      return;
    }
    try {
      const { idToken, username } = context();
      await window.UserAppsData.addReminder(options.baseUrl, idToken, username, {
        text: text.slice(0, 160), done: false, createdAt: Date.now()
      });
      input.value = "";
      await refreshReminders();
      announce("Objetivo guardado.");
    } catch (error) {
      setStatus("objetivos-status", translateError(error, "No se pudo guardar el objetivo."), "error");
    }
  }

  async function handleReminderAction(event) {
    const target = event.target.closest("[data-reminder-action]");
    if (!target) return;
    const action = target.dataset.reminderAction;
    if ((action === "toggle" && event.type !== "change") || (action === "delete" && event.type !== "click")) return;
    try {
      const { idToken, username } = context();
      const id = target.dataset.reminderId;
      if (action === "toggle") {
        await window.UserAppsData.setReminderDone(options.baseUrl, idToken, username, id, target.checked);
      } else {
        await window.UserAppsData.deleteReminder(options.baseUrl, idToken, username, id);
      }
      await refreshReminders();
    } catch (error) {
      setStatus("objetivos-status", translateError(error, "No se pudo actualizar el objetivo."), "error");
    }
  }

  const membershipNames = {
    "3eso": "3.º de ESO", "4eso": "4.º de ESO", spectator: "Espectador"
  };

  function renderProfile(profile, username) {
    const name = profile.name || username;
    const avatar = String(profile.profilePicture || "⚽");
    const avatarBackground = /^#[\da-f]{6}$/i.test(String(profile.profileBackground || "")) ? profile.profileBackground : "#2678d5";
    const avatarNode = byId("profile-avatar");
    if (avatarNode) {
      avatarNode.textContent = avatar;
      avatarNode.style.backgroundColor = avatarBackground;
      avatarNode.setAttribute("aria-label", `Avatar de ${name}: ${avatar}`);
    }
    const emojiInput = byId("profile-emoji-input");
    if (emojiInput && document.activeElement !== emojiInput) emojiInput.value = avatar;
    const backgroundInput = byId("profile-background-input");
    if (backgroundInput) backgroundInput.value = avatarBackground;
    if (byId("profile-name")) byId("profile-name").textContent = name;
    if (byId("profile-membership")) {
      byId("profile-membership").textContent = membershipNames[profile.membership] || profile.membership || "Espectador";
      byId("profile-membership").dataset.membership = profile.membership || "spectator";
    }
    if (byId("profile-balance")) byId("profile-balance").textContent = money(profile.money);
    const choices = byId("avatar-options");
    if (choices && !choices.childElementCount) {
      for (const value of avatarChoices) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.avatar = value;
        button.textContent = value;
        button.setAttribute("aria-label", `Elegir avatar ${value}`);
        choices.append(button);
      }
    }
    for (const button of choices?.querySelectorAll("[data-avatar]") || []) {
      const selected = button.dataset.avatar === avatar;
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("is-selected", selected);
    }
  }

  async function refreshProfile() {
    setStatus("profile-status", "Cargando perfil…");
    try {
      const { idToken, username } = context();
      const profile = await window.UserAppsData.loadProfile(options.baseUrl, idToken, username);
      const fallbackMoney = await window.PartidosData.loadUserBalance(options.baseUrl, idToken, username).catch(() => 0);
      renderProfile({ ...profile, money: profile.money ?? fallbackMoney }, username);
      setStatus("profile-status", "");
    } catch (error) {
      setStatus("profile-status", translateError(error, "No se pudo cargar el perfil."), "error");
    }
  }

  async function handleAvatarChoice(event) {
    const button = event.target.closest("[data-avatar]");
    if (!button) return;
    try {
      const { idToken, username } = context();
      await window.UserAppsData.saveProfilePicture(options.baseUrl, idToken, username, button.dataset.avatar);
      const currentName = byId("profile-name")?.textContent || username;
      renderProfile({ name: currentName, membership: byId("profile-membership")?.dataset.membership, profilePicture: button.dataset.avatar, profileBackground: byId("profile-background-input")?.value, money: String(byId("profile-balance")?.textContent || "").replace(/\D/g, "") }, username);
      setStatus("profile-status", "Avatar actualizado.", "success");
    } catch (error) {
      setStatus("profile-status", translateError(error, "No se pudo guardar el avatar."), "error");
    }
  }

  async function saveProfileCustomization(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const emojiInput = byId("profile-emoji-input");
    const backgroundInput = byId("profile-background-input");
    const button = form.querySelector('button[type="submit"]');
    const avatar = String(emojiInput?.value || "").trim();
    const background = String(backgroundInput?.value || "");
    if (!avatar || Array.from(avatar).length > 12) {
      setStatus("profile-status", "Escribe un emoji para tu perfil.", "error");
      emojiInput?.focus();
      return;
    }
    if (!/^#[\da-f]{6}$/i.test(background)) {
      setStatus("profile-status", "Elige un color válido para el fondo.", "error");
      backgroundInput?.focus();
      return;
    }
    if (button) button.disabled = true;
    setStatus("profile-status", "Guardando personalización…");
    try {
      const { idToken, username } = context();
      await window.UserAppsData.saveProfileAppearance(options.baseUrl, idToken, username, avatar, background);
      renderProfile({
        name: byId("profile-name")?.textContent || username,
        membership: byId("profile-membership")?.dataset.membership,
        profilePicture: avatar,
        profileBackground: background,
        money: String(byId("profile-balance")?.textContent || "").replace(/\D/g, "")
      }, username);
      setStatus("profile-status", "Perfil actualizado.", "success");
    } catch (error) {
      setStatus("profile-status", translateError(error, "No se pudo guardar la personalización."), "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function showDeleteConfirmation() {
    const confirmation = byId("delete-account-confirmation");
    if (confirmation) {
      confirmation.hidden = false;
    }
    byId("delete-account-confirm")?.focus({ preventScroll: true });
    setStatus("profile-status", "");
  }

  function hideDeleteConfirmation() {
    const confirmation = byId("delete-account-confirmation");
    if (confirmation) confirmation.hidden = true;
    setStatus("profile-status", "");
    byId("delete-account-button")?.focus({ preventScroll: true });
  }

  async function confirmDeleteAccount() {
    const button = byId("delete-account-confirm");
    if (button) button.disabled = true;
    setStatus("profile-status", "Eliminando la cuenta…");
    try {
      const { idToken, username } = context();
      const apiKey = document.querySelector('meta[name="firebase-api-key"]')?.content?.trim();
      await window.UserAppsData.deleteAccountData(options.baseUrl, idToken, username, apiKey);
      try { localStorage.removeItem("laligaBrainsAuthSession"); } catch { /* Storage can be disabled. */ }
      setStatus("profile-status", "Cuenta eliminada.", "success");
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      setStatus("profile-status", translateError(error, "No se pudo eliminar la cuenta."), "error");
      if (button) button.disabled = false;
    }
  }

  function makeButton(label, action, playerId = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fantasy-action-button";
    button.dataset.fantasyAction = action;
    if (playerId) button.dataset.playerId = playerId;
    button.textContent = label;
    return button;
  }

  async function refreshFantasy() {
    const market = byId("fantasy-market");
    const rosterList = byId("fantasy-roster");
    const requestsList = byId("fantasy-transfer-requests");
    const activityList = byId("fantasy-activity");
    if (!market || !rosterList || !requestsList) return;
    market.replaceChildren();
    rosterList.replaceChildren();
    requestsList.replaceChildren();
    setStatus("fantasy-status", "Cargando mercado…");
    try {
      const { idToken, username } = context();
      fantasySnapshot = await window.UserAppsData.loadFantasy(options.baseUrl, idToken, username);
      byId("fantasy-balance").textContent = money(fantasySnapshot.balance);
      const maxPlayersValue = Number(fantasySnapshot.maxPlayers);
      const maxPlayers = Number.isFinite(maxPlayersValue) && maxPlayersValue >= 0 ? maxPlayersValue : 3;
      const rosterCount = byId("fantasy-roster-count");
      if (rosterCount) rosterCount.textContent = `${fantasySnapshot.roster.length}/${maxPlayers}`;
      const players = Object.entries(fantasySnapshot.players).filter(([, player]) => player && typeof player === "object");
      if (!players.length) {
        const empty = document.createElement("p");
        empty.textContent = "No hay jugadores disponibles.";
        market.append(empty);
      }
      for (const [id, player] of players) {
        const ownedByMe = String(player.owner || "") === username;
        const owner = String(player.owner || "");
        const row = document.createElement("article");
        row.className = "fantasy-player-row";
        const details = document.createElement("div");
        details.className = "fantasy-player-details";
        const playerName = String(player.name || id);
        const goalsLink = document.createElement("button");
        goalsLink.type = "button";
        goalsLink.className = "fantasy-player-goals-link";
        goalsLink.dataset.goalsPlayer = playerName;
        goalsLink.textContent = playerName;
        const costValue = document.createElement("span");
        const marketValue = Number(player.value ?? player.cost ?? player.price) || 0;
        costValue.textContent = `Valor de mercado ${money(marketValue)}`;
        const ownerLabel = document.createElement("small");
        ownerLabel.textContent = ownedByMe ? "En tu equipo" : owner ? `Propietario: ${owner}` : "Sin propietario";
        details.append(goalsLink, costValue, ownerLabel);
        row.append(details);
        if (!owner) {
          const button = makeButton("Fichar", "buy", id);
          button.disabled = fantasySnapshot.roster.length >= maxPlayers || marketValue > fantasySnapshot.balance;
          row.append(button);
        } else if (!ownedByMe) {
          const offerControls = document.createElement("div");
          offerControls.className = "fantasy-offer-controls";
          const input = document.createElement("input");
          input.type = "number";
          input.min = "1";
          input.step = "1";
          input.inputMode = "numeric";
          input.className = "fantasy-offer-input";
          input.placeholder = "Monedas de la oferta";
          input.setAttribute("aria-label", `Cantidad de la oferta para ${playerName}`);
          input.dataset.offerAmount = id;
          const offer = makeButton("Hacer oferta", "make-offer", id);
          offer.disabled = fantasySnapshot.balance < 1 || fantasySnapshot.roster.length >= maxPlayers;
          offerControls.append(input, offer);
          row.append(offerControls);
        } else {
          const mine = fantasySnapshot.roster.find((entry) => entry.id === id);
          const invested = Number(mine?.investment) || 0;
          const input = document.createElement("input");
          input.type = "number";
          input.min = "1";
          input.step = "1";
          input.inputMode = "numeric";
          input.className = "fantasy-invest-input";
          input.placeholder = "Monedas";
          input.setAttribute("aria-label", `Monedas para invertir en ${player.name || id}`);
          input.dataset.investAmount = id;
          const invest = makeButton("Invertir", "invest", id);
          invest.disabled = fantasySnapshot.balance < 1;
          const investBox = document.createElement("div");
          investBox.className = "fantasy-invest-controls";
          const investedLabel = document.createElement("small");
          investedLabel.textContent = `Invertido: ${money(invested)} · La inversión no se puede retirar.`;
          investBox.append(input, invest, investedLabel);
          row.append(investBox);
        }
        market.append(row);
      }

      if (!fantasySnapshot.roster.length) {
        const empty = document.createElement("p");
        empty.textContent = `Tu equipo está vacío. Puedes fichar hasta ${maxPlayers} ${maxPlayers === 1 ? "jugador" : "jugadores"}.`;
        rosterList.append(empty);
      } else {
        for (const player of fantasySnapshot.roster) {
          const row = document.createElement("div");
          row.className = "fantasy-roster-row";
          const goalsLink = document.createElement("button");
          goalsLink.type = "button";
          goalsLink.className = "fantasy-player-goals-link";
          goalsLink.dataset.goalsPlayer = String(player.name || player.id);
          goalsLink.textContent = String(player.name || player.id);
          const value = document.createElement("span");
          value.textContent = `Mercado ${money(player.value ?? player.cost)}`;
          const sell = makeButton(`Vender por ${money(player.value ?? player.cost)}`, "sell", player.id);
          row.append(goalsLink, value, sell);
          rosterList.append(row);
        }
      }

      const [requests, outgoingOffers] = await Promise.all([
        window.UserAppsData.listTransferRequests(options.baseUrl, idToken, username),
        window.UserAppsData.listOutgoingTransferOffers(options.baseUrl, idToken, username)
      ]);
      if (!requests.length) {
        const empty = document.createElement("p");
        empty.textContent = "No tienes ofertas recibidas pendientes.";
        requestsList.append(empty);
      } else {
        for (const item of requests) {
          const row = document.createElement("article");
          row.className = "fantasy-transfer-row";
          const text = document.createElement("span");
          text.textContent = `${item.fromUsername} ofrece ${money(item.amount)} por ${item.playerName} · Mercado ${money(item.marketValue)}.`;
          const accept = makeButton("Aceptar", "approve-transfer", item.id);
          accept.dataset.requestId = item.id;
          accept.dataset.requester = item.fromUsername || "";
          accept.dataset.playerId = item.playerId || "";
          accept.dataset.playerName = item.playerName || "";
          const decline = makeButton("Rechazar", "decline-transfer", item.id);
          decline.dataset.requestId = item.id;
          decline.dataset.requester = item.fromUsername || "";
          decline.dataset.playerId = item.playerId || "";
          decline.dataset.playerName = item.playerName || "";
          row.append(text, accept, decline);
          requestsList.append(row);
        }
      }
      const outgoingList = byId("fantasy-outgoing-offers");
      if (outgoingList) {
        outgoingList.replaceChildren();
        if (!outgoingOffers.length) {
          const empty = document.createElement("p");
          empty.textContent = "Todavía no has enviado ofertas.";
          outgoingList.append(empty);
        } else {
          const statusNames = { pending: "Pendiente", approved: "Aceptada", declined: "Rechazada", stale: "Ya no disponible" };
          for (const item of outgoingOffers) {
            const row = document.createElement("article");
            row.className = "fantasy-transfer-row fantasy-outgoing-offer";
            const text = document.createElement("span");
            text.textContent = `${item.playerName || "Jugador"} · ${money(item.amount)} para ${item.owner || "propietario"}`;
            const status = document.createElement("strong");
            status.className = `fantasy-offer-status is-${item.status}`;
            status.textContent = statusNames[item.status] || "Pendiente";
            row.append(text, status);
            outgoingList.append(row);
          }
        }
      }
      if (activityList) await renderFantasyActivity(activityList, idToken, username);
      setStatus("fantasy-status", "");
    } catch (error) {
      setStatus("fantasy-status", translateError(error, "No se pudo cargar Fantasy."), "error");
    }
  }

  function activityMessage(item) {
    const player = String(item.playerName || item.player || item.name || "jugador");
    const amount = Number(item.amount ?? item.coins ?? item.investment);
    const action = String(item.type || item.action || item.kind || "").toLowerCase();
    if (item.message || item.description || item.summary) return String(item.message || item.description || item.summary);
    if (/buy|purchase|sign|fich|compra/.test(action)) return `Fichaste a ${player}${Number.isFinite(amount) ? ` por ${money(amount)}` : ""}.`;
    if (/invest|invers/.test(action)) return `Invertiste ${Number.isFinite(amount) ? money(amount) : "monedas"} en ${player}.`;
    if (/transfer|traspas/.test(action)) return `Se actualizó el traspaso de ${player}.`;
    if (/assign|play|mission|jugar/.test(action)) return `${player} terminó una convocatoria y generó monedas.`;
    if (Number.isFinite(amount)) return `Movimiento de ${money(amount)}${player ? ` · ${player}` : ""}.`;
    return `Actividad de Fantasy: ${player}.`;
  }

  function activityTime(item) {
    const raw = item.createdAt ?? item.timestamp ?? item.date ?? item.time;
    if (raw === null || raw === undefined || raw === "") return "";
    const numeric = Number(raw);
    const date = Number.isFinite(numeric) ? new Date(numeric < 1e12 ? numeric * 1000 : numeric) : new Date(raw);
    if (!Number.isFinite(date.getTime())) return String(raw);
    return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  async function renderFantasyActivity(container, idToken, username) {
    container.replaceChildren();
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-label", "Actividad de Fantasy");
    let entries = [];
    try {
      if (window.KingdomData?.listActivity) {
        const result = await window.KingdomData.listActivity(options.baseUrl, idToken, {
          admin: username.toLowerCase() === "adri",
          username
        });
        entries = Array.isArray(result)
          ? result
          : Object.entries(result || {}).map(([id, item]) => ({ id, ...(item || {}) }));
      }
    } catch {
      // Keep this panel usable when the optional activity feed is temporarily unavailable.
      entries = [];
    }
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "fantasy-activity-empty";
      empty.textContent = "Aún no hay movimientos de Fantasy.";
      container.append(empty);
      return;
    }
    entries.sort((a, b) => Number(b.createdAt ?? b.timestamp ?? 0) - Number(a.createdAt ?? a.timestamp ?? 0));
    for (const item of entries) {
      const row = document.createElement("article");
      row.className = "fantasy-activity-row";
      const copy = document.createElement("span");
      copy.textContent = activityMessage(item);
      const dateText = activityTime(item);
      row.append(copy);
      if (dateText) {
        const time = document.createElement("time");
        time.textContent = dateText;
        row.append(time);
      }
      container.append(row);
    }
  }

  async function handleFantasyAction(event) {
    const button = event.target.closest("[data-fantasy-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.fantasyAction;
    button.disabled = true;
    setStatus("fantasy-status", "Guardando…");
    try {
      const { idToken, username } = context();
      const playerId = button.dataset.playerId;
      if (action === "buy") {
        await window.UserAppsData.buyPlayer(options.baseUrl, idToken, username, playerId);
        const player = fantasySnapshot?.players?.[playerId] || {};
        if (window.KingdomData?.recordPurchase) {
          try {
            await window.KingdomData.recordPurchase(options.baseUrl, idToken, {
              buyer: username,
              playerId,
              playerName: player.name || playerId,
              cost: Number(player.cost ?? player.value) || 0
            });
          } catch {
            // Do not undo a completed signing if the activity feed cannot be written.
          }
        }
        announce("Jugador fichado.");
      } else if (action === "invest") {
        const input = [...(byId("fantasy-market")?.querySelectorAll("[data-invest-amount]") || [])]
          .find((candidate) => candidate.dataset.investAmount === playerId);
        const amount = Number(input?.value);
        if (!Number.isInteger(amount) || amount <= 0) throw new Error("MONTO_INVALIDO");
        await window.UserAppsData.investPlayer(options.baseUrl, idToken, username, playerId, amount);
        if (window.KingdomData?.createActivity) {
          try {
            const player = fantasySnapshot?.players?.[playerId] || {};
            await window.KingdomData.createActivity(options.baseUrl, idToken, {
              type: "investment",
              message: `Invertiste ${money(amount)} en ${player.name || playerId}.`,
              actor: username,
              playerId,
              playerName: player.name || playerId,
              details: { amount }
            });
          } catch {
            // The investment is already committed; an activity-feed issue cannot reverse it.
          }
        }
        announce("Inversión guardada; el valor del jugador ha aumentado.");
      } else if (action === "make-offer") {
        const player = fantasySnapshot?.players?.[playerId];
        if (!player?.owner) throw new Error("PLAYER_NO_LONGER_OWNED");
        const input = [...(byId("fantasy-market")?.querySelectorAll("[data-offer-amount]") || [])]
          .find((candidate) => candidate.dataset.offerAmount === playerId);
        const amount = Number(input?.value);
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("MONTO_OFERTA_INVALIDO");
        await window.UserAppsData.submitTransferOffer(options.baseUrl, idToken, username, player.owner, playerId, amount);
        if (window.KingdomData?.createActivity) {
          try {
            await window.KingdomData.createActivity(options.baseUrl, idToken, {
              type: "transfer-offer",
              message: `${username} ofrece ${money(amount)} por ${player.name || playerId}.`,
              actor: username,
              playerId,
              playerName: player.name || playerId,
              target: player.owner,
              amount
            });
          } catch {
            // Preserve the transfer request if the activity log is unavailable.
          }
        }
        if (window.KingdomData?.notifyUser) {
          try {
            await window.KingdomData.notifyUser(options.baseUrl, idToken, player.owner, {
              app: "Fantasy",
              message: `${username} ofrece ${money(amount)} por ${player.name || playerId}.`,
              path: "/fantasy/offers"
            });
          } catch {
            // Keep the submitted transfer request even if notification delivery fails.
          }
        }
        announce("Oferta enviada al propietario.");
      } else if (action === "sell") {
        const result = await window.UserAppsData.sellPlayer(options.baseUrl, idToken, username, playerId);
        if (window.KingdomData?.createActivity) {
          try {
            const player = fantasySnapshot?.players?.[playerId] || {};
            await window.KingdomData.createActivity(options.baseUrl, idToken, {
              type: "player-sale",
              message: `Vendiste a ${player.name || playerId} por ${money(result.marketValue)}.`,
              actor: username,
              playerId,
              playerName: player.name || playerId,
              details: { amount: result.marketValue }
            });
          } catch {
            // The sale is already saved; the activity feed can recover independently.
          }
        }
        announce(`Jugador vendido por ${money(result.marketValue)}.`);
      } else if (action === "approve-transfer") {
        await window.UserAppsData.approveTransferRequest(options.baseUrl, idToken, username, button.dataset.requestId);
        if (window.KingdomData?.createActivity) {
          try {
            await window.KingdomData.createActivity(options.baseUrl, idToken, {
              type: "transfer-approved",
              message: `Aceptaste el traspaso de ${button.dataset.playerName || "un jugador"} a ${button.dataset.requester || "otro usuario"}.`,
              actor: username,
              playerId: button.dataset.playerId,
              playerName: button.dataset.playerName,
              target: button.dataset.requester
            });
          } catch {
            // The ownership move has already committed.
          }
        }
        announce("Traspaso aceptado.");
      } else if (action === "decline-transfer") {
        await window.UserAppsData.declineTransferRequest(options.baseUrl, idToken, username, button.dataset.requestId);
        if (window.KingdomData?.createActivity) {
          try {
            await window.KingdomData.createActivity(options.baseUrl, idToken, {
              type: "transfer-declined",
              message: `Rechazaste el traspaso de ${button.dataset.playerName || "un jugador"}.`,
              actor: username,
              playerId: button.dataset.playerId,
              playerName: button.dataset.playerName,
              target: button.dataset.requester
            });
          } catch {
            // The decline has already committed.
          }
        }
        announce("Solicitud rechazada.");
      }
      await refreshFantasy();
    } catch (error) {
      const fallback = error?.message === "MONTO_INVALIDO"
        ? "Introduce una inversión en monedas mayor que cero."
        : error?.message === "MONTO_OFERTA_INVALIDO"
          ? "Escribe una oferta de al menos una moneda."
          : "No se pudo completar la acción.";
      setStatus("fantasy-status", translateError(error, fallback), "error");
      button.disabled = false;
    }
  }

  function bind() {
    byId("goles-player-list")?.addEventListener("click", (event) => {
      const matchButton = event.target.closest("[data-match-id]");
      if (matchButton) {
        options.navigateMatch?.(matchButton.dataset.matchId);
        return;
      }
      const playerButton = event.target.closest("[data-player-name]");
      if (playerButton) showGoalPlayer(playerButton.dataset.playerName);
    });
    byId("objetivo-form")?.addEventListener("submit", addReminder);
    byId("objetivo-list")?.addEventListener("click", handleReminderAction);
    byId("objetivo-list")?.addEventListener("change", handleReminderAction);
    byId("avatar-options")?.addEventListener("click", handleAvatarChoice);
    byId("profile-customization-form")?.addEventListener("submit", saveProfileCustomization);
    byId("delete-account-button")?.addEventListener("click", showDeleteConfirmation);
    byId("delete-account-cancel")?.addEventListener("click", hideDeleteConfirmation);
    byId("delete-account-confirm")?.addEventListener("click", confirmDeleteAccount);
    byId("fantasy-market")?.addEventListener("click", handleFantasyAction);
    byId("fantasy-roster")?.addEventListener("click", handleFantasyAction);
    byId("fantasy-transfer-requests")?.addEventListener("click", handleFantasyAction);
    byId("fantasy-outgoing-offers")?.addEventListener("click", handleFantasyAction);
    window.addEventListener("fantasy:refresh", () => void refreshFantasy());
    window.addEventListener("userapps:show-player", (event) => {
      if (event.detail?.playerName) {
        void openPlayer(event.detail.playerName);
      }
    });
  }

  function init(initOptions) {
    if (options) return;
    options = initOptions || {};
    bind();
  }

  function openPlayer(name) {
    selectedPlayer = String(name || "");
    return refreshGoals().then(() => showGoalPlayer(selectedPlayer));
  }

  function refresh(appId) {
    if (appId === "goles") return refreshGoals();
    if (appId === "objetivos") return refreshReminders();
    if (appId === "perfil") return refreshProfile();
    if (appId === "fantasy") return refreshFantasy();
    return Promise.resolve();
  }

  window.UserAppsUI = Object.freeze({ init, refresh, openPlayer, showPlayer: displayGoalPlayer });
})();
