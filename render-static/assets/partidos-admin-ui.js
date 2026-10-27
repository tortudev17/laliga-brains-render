(() => {
  let options = null;
  let players = [];
  let matches = [];
  let bound = false;

  const byId = (id) => document.getElementById(id);
  const panel = () => byId("partidos-admin-panel");
  const isAdmin = () => options?.isAdmin?.() === true;

  function context() {
    const idToken = options?.getIdToken?.();
    const username = String(options?.getUsername?.() || "").trim();
    if (!idToken || !username || !isAdmin()) throw new Error("Inicia sesión con la cuenta de administrador para continuar.");
    return { idToken, username };
  }

  function setStatus(message, kind = "") {
    const status = byId("partidos-admin-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-success", kind === "success");
  }

  function localDate() {
    const date = new Date();
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function playerById(id) {
    return players.find((player) => player.id === id);
  }

  function scorerOptions(selected = "") {
    const select = document.createElement("select");
    select.className = "match-admin-scorer-select";
    select.required = true;
    select.setAttribute("aria-label", "Quién marcó este gol");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Elige quién marcó";
    select.append(placeholder);
    for (const player of players) {
      const option = document.createElement("option");
      option.value = player.id;
      option.textContent = String(player.name || player.id);
      select.append(option);
    }
    const control = document.createElement("div");
    control.className = "match-admin-scorer-control";
    const unknownButton = document.createElement("button");
    unknownButton.type = "button";
    unknownButton.className = "match-admin-secondary match-admin-no-memory";
    unknownButton.dataset.unknownScorer = "true";
    const unknown = selected === "unknown";
    unknownButton.dataset.selected = String(unknown);
    unknownButton.setAttribute("aria-pressed", String(unknown));
    unknownButton.textContent = unknown ? "Elegir jugador" : "No recuerdo";
    if (unknown) {
      select.disabled = true;
      unknownButton.classList.add("is-selected");
    } else {
      select.value = selected;
    }
    control.append(select, unknownButton);
    return control;
  }

  function renderScorerFields(count, selections = []) {
    const list = byId("match-admin-scorers");
    if (!list) return;
    list.replaceChildren();
    const total = Math.max(0, Math.min(99, Number(count) || 0));
    if (!total) {
      const empty = document.createElement("p");
      empty.className = "match-admin-no-scorers";
      empty.textContent = "Añade el marcador de 4.º ESO para indicar los goleadores.";
      list.append(empty);
      return;
    }
    for (let index = 0; index < total; index += 1) {
      const row = document.createElement("div");
      row.className = "match-admin-scorer-row";
      const number = document.createElement("span");
      number.textContent = `Gol ${index + 1}`;
      row.append(number, scorerOptions(selections[index] || ""));
      list.append(row);
    }
  }

  function matchGoalTotals() {
    const totals = new Map();
    const byName = new Map(players.map((player) => [String(player.name || player.id).toLocaleLowerCase("es-ES"), player.id]));
    for (const match of matches) {
      for (const scorer of match.scorerEntries || []) {
        if (scorer.unknown) continue;
        const id = scorer.playerId || byName.get(String(scorer.name || "").toLocaleLowerCase("es-ES"));
        if (id) totals.set(id, (totals.get(id) || 0) + (Number(scorer.goals) || 0));
      }
    }
    return totals;
  }

  function renderManualGoals() {
    const list = byId("manual-goals-list");
    if (!list) return;
    list.replaceChildren();
    if (!players.length) {
      const empty = document.createElement("p");
      empty.className = "match-admin-no-scorers";
      empty.textContent = "Añade primero jugadores Fantasy en el Reino.";
      list.append(empty);
      return;
    }
    const matchTotals = matchGoalTotals();
    for (const player of players) {
      const row = document.createElement("article");
      row.className = "manual-goal-row";
      const copy = document.createElement("div");
      copy.className = "manual-goal-copy";
      const title = document.createElement("strong");
      title.textContent = String(player.name || player.id);
      const details = document.createElement("small");
      const recorded = matchTotals.get(player.id) || 0;
      const manual = Number(player.manualGoals) || 0;
      details.textContent = `${recorded} ${recorded === 1 ? "gol en partidos" : "goles en partidos"} · Total ${recorded + manual}`;
      copy.append(title, details);
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = "1000000";
      input.step = "1";
      input.value = String(manual);
      input.setAttribute("aria-label", `Goles fuera de partido de ${player.name || player.id}`);
      input.dataset.manualGoals = player.id;
      const save = document.createElement("button");
      save.type = "button";
      save.className = "match-admin-secondary";
      save.textContent = "Guardar";
      save.dataset.saveManualGoals = player.id;
      row.append(copy, input, save);
      list.append(row);
    }
  }

  function resetForm() {
    const form = byId("match-admin-form");
    form?.reset();
    byId("match-admin-id").value = "";
    byId("match-admin-date").value = localDate();
    byId("match-admin-3-scored").value = "0";
    byId("match-admin-3-conceded").value = "0";
    byId("match-admin-4-scored").value = "0";
    byId("match-admin-4-conceded").value = "0";
    byId("match-admin-submit").textContent = "Guardar partido";
    byId("match-admin-cancel").hidden = true;
    renderScorerFields(0);
  }

  function fillForm(match) {
    const score3 = match.scorelines?.["3eso"] || { scored: 0, conceded: 0 };
    const score4 = match.scorelines?.["4eso"] || { scored: 0, conceded: 0 };
    byId("match-admin-id").value = match.id;
    byId("match-admin-date").value = match.dateISO || localDate();
    byId("match-admin-3-scored").value = String(score3.scored);
    byId("match-admin-3-conceded").value = String(score3.conceded);
    byId("match-admin-4-scored").value = String(score4.scored);
    byId("match-admin-4-conceded").value = String(score4.conceded);
    const selections = [];
    for (const scorer of match.scorerEntries || []) {
      const id = scorer.unknown
        ? "unknown"
        : scorer.playerId || players.find((player) => String(player.name || "").toLocaleLowerCase("es-ES") === String(scorer.name || "").toLocaleLowerCase("es-ES"))?.id || "unknown";
      for (let index = 0; index < (Number(scorer.goals) || 0); index += 1) selections.push(id);
    }
    while (selections.length < Number(score4.scored)) selections.push("unknown");
    renderScorerFields(score4.scored, selections.slice(0, Number(score4.scored)));
    byId("match-admin-submit").textContent = "Guardar cambios";
    byId("match-admin-cancel").hidden = false;
    setStatus("Editando este partido.");
    panel()?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  async function submitMatch(event) {
    event.preventDefault();
    if (!isAdmin()) return setStatus("Solo la cuenta de administrador puede gestionar partidos.", "error");
    const submit = byId("match-admin-submit");
    submit.disabled = true;
    setStatus("Guardando partido…");
    try {
      const { idToken } = context();
      const scorerEntries = [...byId("match-admin-scorers").querySelectorAll(".match-admin-scorer-row")].map((row) => {
        const select = row.querySelector("select");
        const unknown = row.querySelector("[data-unknown-scorer]")?.dataset.selected === "true";
        if (unknown) return { unknown: true, goals: 1 };
        if (!select?.value) throw new Error("Elige un goleador o pulsa «No recuerdo» para cada gol de 4.º ESO.");
        return { playerId: select.value, goals: 1 };
      });
      const matchId = byId("match-admin-id").value;
      const wasEditing = Boolean(matchId);
      for (const scorer of scorerEntries) {
        if (!scorer.unknown && !playerById(scorer.playerId)) throw new Error("Actualiza la lista de jugadores Fantasy e inténtalo de nuevo.");
      }
      const result = await window.PartidosData.saveMatch(options.baseUrl, idToken, {
        date: byId("match-admin-date").value,
        scores: {
          "3eso": { scored: Number(byId("match-admin-3-scored").value), conceded: Number(byId("match-admin-3-conceded").value) },
          "4eso": { scored: Number(byId("match-admin-4-scored").value), conceded: Number(byId("match-admin-4-conceded").value) }
        },
        scorers: scorerEntries
      }, matchId);
      resetForm();
      const rewardMessage = result.rewardCoins > 0 ? ` Fantasy pagó ${result.rewardCoins} ${result.rewardCoins === 1 ? "moneda" : "monedas"}.` : "";
      setStatus(`${wasEditing ? "Partido actualizado" : "Partido creado"}.${rewardMessage}`, "success");
      options.notify?.(wasEditing ? "Partido actualizado." : "Partido creado.");
      await options.refresh?.();
    } catch (error) {
      setStatus(error?.message || "No se pudo guardar el partido.", "error");
    } finally {
      submit.disabled = false;
    }
  }

  function decorateMatchRow(row, match) {
    if (!isAdmin()) return;
    const actions = document.createElement("div");
    actions.className = "match-admin-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Editar";
    edit.dataset.matchAction = "edit";
    edit.dataset.matchId = match.id;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Eliminar";
    remove.dataset.matchAction = "delete";
    remove.dataset.matchId = match.id;
    actions.append(edit, remove);
    row.append(actions);
  }

  async function matchAction(event) {
    const button = event.target.closest("[data-match-action]");
    if (!button || !isAdmin()) return;
    const match = matches.find((item) => item.id === button.dataset.matchId);
    if (!match) return;
    if (button.dataset.matchAction === "edit") {
      byId("matches-close")?.click();
      fillForm(match);
      return;
    }
    const label = match.dateLabel || match.id;
    if (!window.confirm(`¿Eliminar el partido del ${label}? Esta acción no se puede deshacer.`)) return;
    button.disabled = true;
    setStatus("Eliminando partido…");
    try {
      const { idToken } = context();
      await window.PartidosData.deleteMatch(options.baseUrl, idToken, match.id);
      setStatus("Partido eliminado.", "success");
      await options.refresh?.();
      const listStatus = byId("all-matches-status");
      if (listStatus) listStatus.textContent = "Partido eliminado.";
    } catch (error) {
      setStatus(error?.message || "No se pudo eliminar el partido.", "error");
      const listStatus = byId("all-matches-status");
      if (listStatus) listStatus.textContent = error?.message || "No se pudo eliminar el partido.";
      button.disabled = false;
    }
  }

  async function saveManualGoal(event) {
    const button = event.target.closest("[data-save-manual-goals]");
    if (!button || !isAdmin()) return;
    const playerId = button.dataset.saveManualGoals;
    const input = byId("manual-goals-list").querySelector(`[data-manual-goals="${CSS.escape(playerId)}"]`);
    const goals = Number(input?.value);
    if (!Number.isSafeInteger(goals) || goals < 0 || goals > 1000000) return setStatus("Introduce un total válido de goles fuera de partido.", "error");
    button.disabled = true;
    try {
      const { idToken } = context();
      const result = await window.PartidosData.saveManualGoals(options.baseUrl, idToken, playerId, goals);
      const rewardMessage = result.rewardCoins > 0 ? ` Se pagaron ${result.rewardCoins} ${result.rewardCoins === 1 ? "moneda" : "monedas"} a su propietario Fantasy.` : "";
      setStatus(`Goles fuera de partido actualizados para ${playerById(playerId)?.name || playerId}.${rewardMessage}`, "success");
      await options.refresh?.();
    } catch (error) {
      setStatus(error?.message || "No se pudieron guardar los goles.", "error");
      button.disabled = false;
    }
  }

  async function refresh(nextMatches = matches) {
    matches = Array.isArray(nextMatches) ? nextMatches : [];
    if (!panel()) return;
    panel().hidden = !isAdmin();
    if (!isAdmin()) return;
    try {
      const { idToken } = context();
      players = await window.PartidosData.loadFantasyPlayers(options.baseUrl, idToken);
      renderManualGoals();
    } catch (error) {
      players = [];
      renderManualGoals();
      setStatus(error?.message || "No se pudieron cargar los jugadores Fantasy.", "error");
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    byId("match-admin-form")?.addEventListener("submit", submitMatch);
    byId("match-admin-cancel")?.addEventListener("click", () => { resetForm(); setStatus(""); });
    byId("match-admin-4-scored")?.addEventListener("input", (event) => {
      const previous = [...byId("match-admin-scorers").querySelectorAll(".match-admin-scorer-row")].map((row) => (
        row.querySelector("[data-unknown-scorer]")?.dataset.selected === "true"
          ? "unknown"
          : row.querySelector("select")?.value || ""
      ));
      renderScorerFields(event.currentTarget.value, previous);
    });
    byId("matches-list")?.addEventListener("click", matchAction);
    byId("manual-goals-list")?.addEventListener("click", saveManualGoal);
    byId("match-admin-scorers")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-unknown-scorer]");
      if (!button) return;
      const selected = button.dataset.selected !== "true";
      const select = button.closest(".match-admin-scorer-control")?.querySelector("select");
      button.dataset.selected = String(selected);
      button.setAttribute("aria-pressed", String(selected));
      button.textContent = selected ? "Elegir jugador" : "No recuerdo";
      button.classList.toggle("is-selected", selected);
      if (select) {
        select.disabled = selected;
        if (selected) select.value = "";
      }
    });
    resetForm();
  }

  function init(initOptions) {
    if (options) return;
    options = initOptions || {};
    bind();
  }

  window.PartidosAdminUI = Object.freeze({ init, refresh, decorateMatchRow });
})();
