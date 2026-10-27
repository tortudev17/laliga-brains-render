(() => {
  let options = null;
  let bound = false;
  let kingdomSettings = {
    publicName: "Adri",
    maxFantasyPlayers: 3,
    assignmentRewardRate: 0.1,
    minHours: 1,
    maxHours: 8,
    startingCoins: 100,
    predictionsEnabled: true
  };
  const defaultSettings = { ...kingdomSettings };
  const byId = (id) => document.getElementById(id);

  function context() {
    if (!options) throw new Error("El Reino todavía no está listo.");
    const token = options.getIdToken?.();
    const username = String(options.getUsername?.() || "").trim();
    if (!token || !username) throw new Error("Inicia sesión para continuar.");
    return { token, username };
  }

  function setStatus(message, kind = "") {
    const node = byId("kingdom-status");
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
    node.classList.toggle("is-error", kind === "error");
    node.classList.toggle("is-success", kind === "success");
  }

  function errorText(error, fallback) {
    const message = String(error?.message || "");
    if (/permission|denied|unauthorized|forbidden/i.test(message)) return "Firebase no permite esta acción con los permisos actuales.";
    if (/not found|no existe/i.test(message)) return "No se encontró el elemento. Actualiza la lista e inténtalo de nuevo.";
    if (/network|conexión|connect/i.test(message)) return "No se pudo conectar. Comprueba tu conexión.";
    return fallback;
  }

  function entries(data) {
    if (Array.isArray(data)) return data.map((item, i) => [String(item?.id ?? item?.username ?? i), item]);
    if (data && typeof data === "object") return Object.entries(data).filter(([, item]) => item !== null && item !== undefined);
    return [];
  }

  function text(value, fallback = "") {
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
  }

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }

  function makeButton(label, action, extra = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "kingdom-action";
    button.dataset.kingdomAction = action;
    for (const [key, val] of Object.entries(extra)) button.dataset[key] = String(val);
    button.textContent = label;
    return button;
  }

  function setView(admin) {
    const adminView = byId("kingdom-admin-view");
    const userView = byId("kingdom-user-view");
    if (adminView) adminView.hidden = !admin;
    if (userView) userView.hidden = admin;
  }

  function ensureAnnouncementFields() {
    const form = byId("kingdom-announcement-form");
    if (!form) return;
    let title = form.querySelector('[name="title"]');
    if (!title) {
      const label = el("label", "kingdom-field-label", "Título del anuncio");
      title = document.createElement("input");
      title.name = "title";
      title.maxLength = 90;
      title.required = true;
      title.placeholder = "Anuncio";
      label.append(title);
      form.append(label);
    }
    let message = form.querySelector('[name="message"]');
    if (!message) {
      const label = el("label", "kingdom-field-label", "Mensaje");
      message = document.createElement("textarea");
      message.name = "message";
      message.maxLength = 800;
      message.required = true;
      message.rows = 3;
      message.placeholder = "Escribe el anuncio";
      label.append(message);
      form.append(label);
    }
    if (!form.querySelector('[type="submit"]')) {
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "Publicar anuncio";
      form.append(submit);
    }
  }

  function ensureFeatureField() {
    const form = byId("kingdom-feature-form");
    if (!form) return;
    let heading = byId("kingdom-feature-title");
    if (!heading) {
      heading = el("h2", "kingdom-feature-title", `Enviar un mensaje a ${kingdomSettings.publicName || "Adri"}`);
      heading.id = "kingdom-feature-title";
      form.before(heading);
    }
    let input = byId("kingdom-feature-input") || form.querySelector("textarea, input");
    if (!input) {
      input = document.createElement("textarea");
      input.id = "kingdom-feature-input";
      input.name = "message";
      input.maxLength = 800;
      input.required = true;
      input.rows = 4;
      input.placeholder = "Cuéntanos qué te gustaría mejorar o comentar";
      form.append(input);
    }
    if (!form.querySelector('[type="submit"]')) {
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "Enviar";
      form.append(submit);
    }
  }

  function ensureSettingsForm() {
    const view = byId("kingdom-admin-view");
    if (!view) return null;
    let form = byId("kingdom-settings-form");
    if (!form) {
      form = document.createElement("form");
      form.id = "kingdom-settings-form";
      form.className = "kingdom-settings-form";
      const heading = el("h2", "", "Constantes globales");
      const description = el("p", "", "Estos valores se aplican a todos los jugadores.");
      form.append(heading, description);
      view.prepend(form);
    }
    const schema = [
      ["publicName", "Nombre público", "text", 70],
      ["maxFantasyPlayers", "Máximo de jugadores Fantasy", "number", 3],
      ["assignmentRewardRate", "Recompensa por hora (% del valor)", "number", 100],
      ["minHours", "Horas mínimas de En juego", "number", 8],
      ["maxHours", "Horas máximas de En juego", "number", 8],
      ["startingCoins", "Monedas iniciales de una cuenta nueva", "number", 1000000],
      ["predictionsEnabled", "Activar Predicciones", "checkbox", null]
    ];
    for (const [key, labelText, type, max] of schema) {
      let input = form.querySelector(`[data-kingdom-setting="${key}"]`);
      if (input) continue;
      const label = el("label", "kingdom-setting-field", labelText);
      input = document.createElement("input");
      input.type = type;
      input.dataset.kingdomSetting = key;
      if (type === "number") {
        input.min = key === "minHours" || key === "maxHours" || key === "maxFantasyPlayers" ? "1" : "0";
        input.max = String(max);
        input.step = key === "assignmentRewardRate" ? "0.1" : "1";
      }
      if (type === "text") input.maxLength = max;
      if (type !== "checkbox") input.required = true;
      label.append(input);
      form.append(label);
    }
    if (!form.querySelector('[type="submit"]')) {
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "Guardar constantes";
      form.append(submit);
    }
    return form;
  }

  function applySettings(settings = {}) {
    kingdomSettings = { ...defaultSettings, ...(settings && typeof settings === "object" ? settings : {}) };
    kingdomSettings.publicName = String(kingdomSettings.publicName || "Adri");
    for (const [key, value] of Object.entries(kingdomSettings)) {
      const input = document.querySelector(`[data-kingdom-setting="${key}"]`);
      if (!input) continue;
      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = String(key === "assignmentRewardRate" ? Number(value) * 100 : value);
    }
    const title = byId("kingdom-feature-title");
    if (title) title.textContent = `Enviar un mensaje a ${kingdomSettings.publicName}`;
    window.dispatchEvent(new CustomEvent("kingdom:settings", { detail: { ...kingdomSettings } }));
  }

  function ensureNewPlayerForm(usersData) {
    const list = byId("kingdom-player-list");
    if (!list) return;
    let form = byId("kingdom-new-player-form");
    if (!form) {
      form = document.createElement("form");
      form.id = "kingdom-new-player-form";
      form.className = "kingdom-new-player-form";
      form.append(el("h3", "", "Añadir jugador Fantasy"));
      for (const [key, labelText, type] of [["playerId", "ID del jugador", "text"], ["name", "Nombre", "text"], ["cost", "Coste", "number"], ["value", "Valor", "number"]]) {
        const label = el("label", "kingdom-field-label", labelText);
        const input = document.createElement("input");
        input.name = key;
        input.type = type;
        input.required = true;
        if (type === "text") input.maxLength = 55;
        if (type === "number") { input.min = "1"; input.step = "1"; }
        label.append(input);
        form.append(label);
      }
      const ownerLabel = el("label", "kingdom-field-label", "Propietario");
      const owner = document.createElement("select");
      owner.name = "owner";
      ownerLabel.append(owner);
      form.append(ownerLabel);
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = "Crear jugador";
      form.append(submit);
      list.before(form);
    }
    const select = form.querySelector('[name="owner"]');
    if (select) {
      const selected = select.value;
      select.replaceChildren();
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "Sin propietario";
      select.append(none);
      for (const [id, user] of entries(usersData)) {
        const username = String(user?.username ?? id);
        const option = document.createElement("option");
        option.value = username;
        option.textContent = username;
        select.append(option);
      }
      select.value = selected;
    }
  }

  function renderAnnouncements(data) {
    const list = byId("kingdom-announcement-list");
    if (!list) return;
    list.replaceChildren();
    const items = entries(data).map(([id, item]) => ({ id, ...(item && typeof item === "object" ? item : { message: item }) }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    if (!items.length) {
      list.append(el("p", "kingdom-empty", "Todavía no hay anuncios."));
      return;
    }
    for (const item of items) {
      const article = el("article", "kingdom-announcement");
      article.dataset.announcementId = String(item.id);
      article.append(el("h3", "", text(item.title, "Anuncio")));
      article.append(el("p", "", text(item.message, "")));
      const stamp = Number(item.createdAt);
      if (Number.isFinite(stamp) && stamp > 0) {
        article.append(el("time", "kingdom-date", new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(stamp)));
      }
      list.append(article);
    }
  }

  function renderActivities(data, list) {
    if (!list) return;
    list.replaceChildren();
    const items = entries(data).map(([id, item]) => ({ id, ...(item && typeof item === "object" ? item : {}) }))
      .sort((a, b) => Number(b.createdAt || b.timestamp || 0) - Number(a.createdAt || a.timestamp || 0));
    if (!items.length) {
      list.append(el("p", "kingdom-empty", "Todavía no hay actividad registrada."));
      return;
    }
    for (const item of items.slice(0, 60)) {
      const row = el("article", "kingdom-activity-row");
      row.append(el("strong", "", text(item.title ?? item.type, "Actividad")));
      row.append(el("p", "", text(item.message ?? item.description, "")));
      const stamp = Number(item.createdAt ?? item.timestamp);
      if (Number.isFinite(stamp) && stamp > 0) row.append(el("time", "kingdom-date", new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(stamp)));
      list.append(row);
    }
  }

  function renderUserRequests(data) {
    const list = byId("kingdom-user-requests");
    if (!list) return;
    list.replaceChildren();
    const items = entries(data).map(([id, item]) => ({ id, ...(item && typeof item === "object" ? item : {}) }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    if (!items.length) {
      list.append(el("p", "kingdom-empty", "Aún no has enviado solicitudes ni comentarios."));
      return;
    }
    for (const item of items) {
      const article = el("article", "kingdom-request-card");
      article.dataset.requestId = String(item.id);
      article.append(el("p", "kingdom-request-message", text(item.message ?? item.text, "Solicitud")));
      const status = text(item.status, item.response ? "Respondida" : "Pendiente");
      article.append(el("span", "kingdom-request-status", status === "pending" ? "Pendiente" : status));
      if (item.response) {
        const reply = el("div", "kingdom-response");
        reply.append(el("strong", "", "Respuesta"), el("p", "", text(item.response)));
        article.append(reply);
      }
      list.append(article);
    }
  }

  function renderAdminUsers(data) {
    const list = byId("kingdom-user-list");
    if (!list) return;
    list.replaceChildren();
    const users = entries(data).map(([id, item]) => ({ username: id, ...(item && typeof item === "object" ? item : { money: item }) }));
    if (!users.length) {
      list.append(el("p", "kingdom-empty", "No hay perfiles para mostrar."));
      return;
    }
    for (const user of users) {
      const row = el("article", "kingdom-admin-row kingdom-user-row");
      const label = el("div", "kingdom-admin-copy");
      label.append(el("strong", "", text(user.name, user.username)), el("small", "", user.username));
      const balance = user.money ?? user.balance ?? 0;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.value = String(Number(balance) || 0);
      input.setAttribute("aria-label", `Saldo de ${user.username}`);
      input.dataset.kingdomMoney = user.username;
      const addInput = document.createElement("input");
      addInput.type = "number";
      addInput.min = "1";
      addInput.step = "1";
      addInput.placeholder = "+ monedas";
      addInput.setAttribute("aria-label", `Añadir monedas a ${user.username}`);
      addInput.dataset.kingdomAddMoney = user.username;
      const actions = el("div", "kingdom-row-actions");
      actions.append(makeButton("Guardar saldo", "set-money", { username: user.username }), makeButton("Añadir", "add-money", { username: user.username }));
      row.append(label, input, addInput, actions);
      list.append(row);
    }
  }

  function renderAdminPlayers(data, usersData) {
    const list = byId("kingdom-player-list");
    if (!list) return;
    list.replaceChildren();
    const usernames = entries(usersData).map(([id, item]) => String(item?.username ?? id)).filter(Boolean);
    const players = entries(data).map(([id, item]) => ({ id, ...(item && typeof item === "object" ? item : {}) }));
    if (!players.length) {
      list.append(el("p", "kingdom-empty", "No hay jugadores de Fantasy."));
      return;
    }
    for (const player of players) {
      const row = el("article", "kingdom-admin-row kingdom-player-row");
      const name = document.createElement("input");
      name.type = "text";
      name.maxLength = 70;
      name.value = text(player.name, player.id);
      name.setAttribute("aria-label", `Nombre de ${player.id}`);
      name.dataset.kingdomPlayerName = player.id;
      const value = document.createElement("input");
      value.type = "number";
      value.min = "1";
      value.step = "1";
      value.value = String(Number(player.value) || Number(player.cost) || 1);
      value.setAttribute("aria-label", `Valor de ${player.name || player.id}`);
      value.dataset.kingdomPlayerValue = player.id;
      const owner = document.createElement("select");
      owner.setAttribute("aria-label", `Propietario de ${player.name || player.id}`);
      owner.dataset.kingdomPlayerOwner = player.id;
      const unowned = document.createElement("option");
      unowned.value = "";
      unowned.textContent = "Sin propietario";
      owner.append(unowned);
      for (const username of usernames) {
        const option = document.createElement("option");
        option.value = username;
        option.textContent = username;
        owner.append(option);
      }
      owner.value = text(player.owner, "");
      row.append(el("strong", "kingdom-player-id", player.id), name, value, owner, makeButton("Guardar jugador", "save-player", { playerId: player.id }));
      list.append(row);
    }
  }

  function renderAdminRequests(data) {
    const list = byId("kingdom-request-list");
    if (!list) return;
    list.replaceChildren();
    const requests = entries(data).map(([id, item]) => ({ id, ...(item && typeof item === "object" ? item : {}) }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    if (!requests.length) {
      list.append(el("p", "kingdom-empty", "No hay solicitudes ni comentarios."));
      return;
    }
    for (const request of requests) {
      const card = el("article", "kingdom-request-card");
      card.dataset.requestId = String(request.id);
      const head = el("div", "kingdom-request-head");
      head.append(el("strong", "", text(request.username, "Usuario")), el("span", "kingdom-request-status", text(request.status, request.response ? "Respondida" : "Pendiente")));
      card.append(head, el("p", "kingdom-request-message", text(request.message ?? request.text, "Solicitud")));
      if (request.response) card.append(el("p", "kingdom-response-text", `Respuesta: ${request.response}`));
      if (!request.response) {
        const form = document.createElement("form");
        form.className = "kingdom-response-form";
        form.dataset.requestId = request.id;
        const textarea = document.createElement("textarea");
        textarea.name = "response";
        textarea.maxLength = 800;
        textarea.required = true;
        textarea.rows = 2;
        textarea.placeholder = "Escribe una respuesta";
        const button = document.createElement("button");
        button.type = "submit";
        button.textContent = "Responder";
        form.append(textarea, button);
        card.append(form);
      }
      list.append(card);
    }
  }

  function renderWebVersions(versions, currentId) {
    const currentNode = byId("kingdom-web-current-id");
    const list = byId("kingdom-web-version-list");
    if (currentNode) currentNode.textContent = currentId || "Sin publicar";
    if (!list) return;
    list.replaceChildren();
    if (!versions.length) {
      list.append(el("p", "kingdom-empty", "Todavía no hay versiones de la web."));
      return;
    }
    const dateFormatter = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" });
    for (const version of versions) {
      const row = el("article", "kingdom-version-row");
      const copy = el("div", "kingdom-version-copy");
      copy.append(el("strong", "", version.id));
      const date = Number(version.createdAt) > 0 ? dateFormatter.format(new Date(Number(version.createdAt))) : "Fecha desconocida";
      const size = Number(version.size) > 0 ? `${(Number(version.size) / 1024).toFixed(0)} KB` : "Tamaño desconocido";
      const images = Array.isArray(version.images) ? version.images.length : 0;
      const uploader = String(version.uploadedBy || "usuario desconocido");
      copy.append(el("small", "", `${date} · ${size} · ${Number(version.fileCount) || 0} archivos · subió ${uploader} · ${images} imágenes en Firebase Realtime Database`));
      row.append(copy);
      if (version.id === currentId) row.append(el("span", "kingdom-version-badge", "ACTUAL"));
      const actions = el("div", "kingdom-version-actions");
      actions.append(
        makeButton("Previsualizar", "preview-web-version", { versionId: version.id }),
        makeButton("Ver código", "code-web-version", { versionId: version.id })
      );
      if (version.id !== currentId) actions.append(makeButton("Hacer actual", "set-current-web-version", { versionId: version.id }));
      actions.append(makeButton("Eliminar", "delete-web-version", { versionId: version.id }));
      row.append(actions);
      list.append(row);
    }
  }

  async function refreshWebVersions() {
    const list = byId("kingdom-web-version-list");
    if (!list || !window.SiteVersions) return;
    try {
      const { token } = context();
      const result = await window.SiteVersions.listVersions(options.baseUrl, token);
      renderWebVersions(result.versions, result.currentId);
    } catch (error) {
      list.replaceChildren(el("p", "kingdom-empty", errorText(error, "No se pudieron cargar las versiones.")));
    }
  }

  async function submitWebVersion(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = byId("kingdom-web-zip");
    const file = input?.files?.[0];
    const submit = form.querySelector('[type="submit"]');
    if (!file) { setStatus("Selecciona un archivo ZIP.", "error"); return; }
    const { token, username } = context();
    const progress = byId("kingdom-web-upload-progress");
    const progressLabel = byId("kingdom-web-upload-progress-label");
    if (submit) { submit.disabled = true; submit.textContent = "Procesando el sitio…"; }
    if (input) input.disabled = true;
    if (progress) { progress.hidden = false; progress.value = 0; }
    if (progressLabel) progressLabel.textContent = "Revisando el ZIP…";
    setStatus("Revisando el sitio…");
    try {
      await window.SiteVersions.uploadArchive(options.baseUrl, token, username, file, ({ percent = 0, detail = "Procesando…" } = {}) => {
        if (progress) progress.value = Math.max(0, Math.min(100, percent));
        if (progressLabel) progressLabel.textContent = detail;
        setStatus(detail);
      });
      form.reset();
      await refreshWebVersions();
      setStatus("Versión guardada. Sigue sin ser la versión actual; puedes previsualizarla o publicarla.", "success");
      if (progress) progress.value = 100;
      if (progressLabel) progressLabel.textContent = "Versión guardada. Las imágenes y el código están en Firebase Realtime Database.";
    } catch (error) {
      if (progress) progress.value = 0;
      if (progressLabel) progressLabel.textContent = "La carga se detuvo.";
      setStatus(errorText(error, error?.message || "No se pudo subir esta versión."), "error");
    } finally {
      if (input) input.disabled = false;
      if (submit) { submit.disabled = false; submit.textContent = "Subir como versión nueva"; }
    }
  }

  async function webVersionAction(button, action) {
    const versionId = button.dataset.versionId || "";
    if (action === "preview-web-version" || action === "code-web-version") {
      const view = action === "code-web-version" ? "code" : "preview";
      window.open(`./version-preview.html?id=${encodeURIComponent(versionId)}&view=${view}`, "_blank", "noopener");
      return;
    }
    const { token } = context();
    button.disabled = true;
    try {
      if (action === "set-current-web-version") {
        await window.SiteVersions.setCurrent(options.baseUrl, token, versionId);
        setStatus(`La versión ${versionId} ya es la web actual para todos.`, "success");
      } else if (action === "unpublish-web") {
        await window.SiteVersions.setCurrent(options.baseUrl, token, null);
        setStatus("Se retiró la versión actual. La web original vuelve a mostrarse para todos.", "success");
      } else if (action === "delete-web-version") {
        if (!window.confirm(`¿Eliminar la versión ${versionId}? Se borrarán su ZIP y sus imágenes de Firebase Realtime Database.`)) return;
        await window.SiteVersions.deleteVersion(options.baseUrl, token, versionId);
        setStatus(`Se eliminó la versión ${versionId} y sus imágenes de Firebase Realtime Database.`, "success");
      }
      await refreshWebVersions();
    } catch (error) {
      setStatus(errorText(error, error?.message || "No se pudo actualizar la versión."), "error");
    } finally {
      button.disabled = false;
    }
  }

  async function copyAgentRequest() {
    const request = byId("kingdom-agent-request")?.value.trim();
    if (!request) { setStatus("Describe primero qué quieres cambiar en la web.", "error"); return; }
    const prompt = [
      "Trabaja en el proyecto LaLigaBrains abierto en este Mac y aplica este cambio:",
      request,
      "Al terminar, crea website-upload.zip en la raíz del proyecto. Debe ser una web estática pequeña con index.html en la raíz, máximo 5 MB comprimida, máximo 12 MB descomprimida y 50 archivos. Incluye las imágenes como archivos separados y usa rutas relativas. El cargador guardará cada imagen en su propio registro de Firebase Realtime Database y la comprimirá cuando sea necesario para dejar el registro codificado por debajo de 1 MB. El ZIP guardado contiene solo el código. No incluyas vídeos ni imágenes data:image. No publiques ni subas nada desde Codex."
    ].join("\n\n");
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("Encargo copiado. Abre el lanzador de Mac y pégalo en el chat nuevo de Codex.", "success");
    } catch {
      setStatus("No se pudo copiar el encargo. Revisa los permisos del portapapeles del navegador.", "error");
    }
  }

  async function refresh() {
    if (!options) return;
    setStatus("Cargando…");
    try {
      const { token, username } = context();
      const admin = options.isAdmin?.() === true;
      setView(admin);
      ensureFeatureField();
      if (admin) {
        ensureAnnouncementFields();
        ensureSettingsForm();
      }
      const [announcements, requests, settings] = await Promise.all([
        window.KingdomData.listAnnouncements(options.baseUrl, token),
        window.KingdomData.listFeatureRequests(options.baseUrl, token, username, { admin }),
        window.KingdomData.loadSettings(options.baseUrl, token).catch(() => defaultSettings)
      ]);
      applySettings(settings);
      renderAnnouncements(announcements);
      if (admin) {
        const kingdom = await window.KingdomData.loadKingdomData(options.baseUrl, token, username, { admin });
        const users = kingdom?.users ?? await window.KingdomData.listUsers(options.baseUrl, token);
        const players = kingdom?.players ?? {};
        renderAdminUsers(users);
        ensureNewPlayerForm(users);
        renderAdminPlayers(players, users);
        renderAdminRequests(requests);
        const activity = byId("kingdom-activity-list");
        if (activity) renderActivities(kingdom?.activity ?? {}, activity);
        await refreshWebVersions();
      } else {
        renderUserRequests(requests);
      }
      setStatus("");
    } catch (error) {
      setStatus(errorText(error, "No se pudo cargar el Reino."), "error");
    }
  }

  async function submitFeature(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = byId("kingdom-feature-input") || form.querySelector("textarea, input");
    const message = String(input?.value || "").trim();
    if (!message) return setStatus("Escribe un comentario o una solicitud.", "error");
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const { token, username } = context();
      await window.KingdomData.submitFeatureRequest(options.baseUrl, token, username, message.slice(0, 800));
      form.reset();
      setStatus("Mensaje enviado. Podrás ver aquí la respuesta.", "success");
      options.notify?.("Comentario enviado al Reino.");
      await refresh();
    } catch (error) {
      setStatus(errorText(error, "No se pudo enviar el mensaje."), "error");
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  async function submitAnnouncement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(form.elements.namedItem("title")?.value || "").trim();
    const message = String(form.elements.namedItem("message")?.value || "").trim();
    if (!title || !message) return setStatus("Completa el título y el mensaje del anuncio.", "error");
    try {
      const { token, username } = context();
      await window.KingdomData.createAnnouncement(options.baseUrl, token, username, { title, message });
      form.reset();
      setStatus("Anuncio publicado.", "success");
      await refresh();
    } catch (error) {
      setStatus(errorText(error, "No se pudo publicar el anuncio."), "error");
    }
  }

  async function submitReply(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.classList.contains("kingdom-response-form")) return;
    const message = String(form.elements.namedItem("response")?.value || "").trim();
    const requestId = form.dataset.requestId;
    if (!message || !requestId) return;
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const { token } = context();
      await window.KingdomData.respondFeatureRequest(options.baseUrl, token, requestId, message.slice(0, 800));
      setStatus("Respuesta enviada.", "success");
      await refresh();
    } catch (error) {
      setStatus(errorText(error, "No se pudo guardar la respuesta."), "error");
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  async function submitNewPlayer(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const playerId = String(form.elements.namedItem("playerId")?.value || "").trim().toLowerCase().replace(/\s+/g, "-");
    const name = String(form.elements.namedItem("name")?.value || "").trim();
    const cost = Number(form.elements.namedItem("cost")?.value);
    const value = Number(form.elements.namedItem("value")?.value);
    const owner = String(form.elements.namedItem("owner")?.value || "") || null;
    if (!playerId || /[.#$\[\]\/]/.test(playerId) || !name || !Number.isSafeInteger(cost) || cost <= 0 || !Number.isSafeInteger(value) || value <= 0) {
      return setStatus("Revisa el ID, el nombre, el coste y el valor del jugador.", "error");
    }
    try {
      const { token } = context();
      await window.KingdomData.savePlayer(options.baseUrl, token, playerId, { name, cost, value, owner });
      form.reset();
      setStatus("Jugador añadido al mercado.", "success");
      await refresh();
    } catch (error) {
      setStatus(errorText(error, "No se pudo añadir el jugador."), "error");
    }
  }

  async function submitSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = { ...kingdomSettings };
    for (const [key, oldValue] of Object.entries(defaultSettings)) {
      const input = form.querySelector(`[data-kingdom-setting="${key}"]`);
      if (!input) continue;
      if (input.type === "checkbox") {
        data[key] = input.checked;
      } else if (input.type === "number") {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < 0) return setStatus("Revisa los valores de las constantes.", "error");
        data[key] = key === "assignmentRewardRate" ? value / 100 : Math.floor(value);
      } else {
        data[key] = String(input.value || "").trim().slice(0, 70) || "Adri";
      }
    }
    if (data.maxHours < data.minHours) {
      return setStatus("Las horas máximas deben ser iguales o mayores que las mínimas.", "error");
    }
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const { token } = context();
      await window.KingdomData.saveSettings(options.baseUrl, token, data);
      applySettings(data);
      setStatus("Constantes globales actualizadas.", "success");
      options.notify?.("Configuración del Reino actualizada.");
    } catch (error) {
      setStatus(errorText(error, "No se pudieron guardar las constantes."), "error");
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  async function adminAction(event) {
    const button = event.target.closest("[data-kingdom-action]");
    if (!button) return;
    const action = button.dataset.kingdomAction;
    if (["preview-web-version", "code-web-version", "set-current-web-version", "unpublish-web", "delete-web-version"].includes(action)) {
      await webVersionAction(button, action);
      return;
    }
    if (action === "copy-agent-request") {
      await copyAgentRequest();
      return;
    }
    const targetUsername = button.dataset.username;
    const playerId = button.dataset.playerId;
    const { token, username: adminUsername } = context();
    button.disabled = true;
    try {
      if (action === "set-money") {
        const amount = Number(byId("kingdom-user-list")?.querySelector(`[data-kingdom-money="${CSS.escape(targetUsername)}"]`)?.value);
        if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("INVALID_AMOUNT");
        await window.KingdomData.setUserMoney(options.baseUrl, token, targetUsername, amount);
        options.notify?.(`Saldo actualizado para ${targetUsername}.`);
      } else if (action === "add-money") {
        const amount = Number(byId("kingdom-user-list")?.querySelector(`[data-kingdom-add-money="${CSS.escape(targetUsername)}"]`)?.value);
        if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("INVALID_AMOUNT");
        await window.KingdomData.addUserMoney(options.baseUrl, token, targetUsername, amount);
        options.notify?.(`Se añadieron monedas a ${targetUsername}.`);
      } else if (action === "save-player") {
        const root = byId("kingdom-player-list");
        const name = root.querySelector(`[data-kingdom-player-name="${CSS.escape(playerId)}"]`)?.value.trim();
        const value = Number(root.querySelector(`[data-kingdom-player-value="${CSS.escape(playerId)}"]`)?.value);
        const owner = root.querySelector(`[data-kingdom-player-owner="${CSS.escape(playerId)}"]`)?.value || null;
        if (!name || !Number.isSafeInteger(value) || value <= 0) throw new Error("INVALID_PLAYER");
        const current = await window.KingdomData.loadKingdomData(options.baseUrl, token, adminUsername, { admin: true });
        const existing = current?.players?.[playerId] || {};
        await window.KingdomData.savePlayer(options.baseUrl, token, playerId, { ...existing, name, value, cost: Number(existing.cost) || value, owner });
      }
      setStatus("Cambio guardado.", "success");
      await refresh();
    } catch (error) {
      const fallback = error?.message === "INVALID_AMOUNT" ? "Introduce una cantidad válida de monedas." : "No se pudo guardar el cambio.";
      setStatus(errorText(error, fallback), "error");
    } finally {
      button.disabled = false;
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    byId("kingdom-feature-form")?.addEventListener("submit", submitFeature);
    byId("kingdom-announcement-form")?.addEventListener("submit", submitAnnouncement);
    byId("kingdom-admin-view")?.addEventListener("submit", (event) => {
      if (event.target.id === "kingdom-settings-form") void submitSettings(event);
      else if (event.target.id === "kingdom-new-player-form") void submitNewPlayer(event);
      else if (event.target.id === "kingdom-web-upload-form") void submitWebVersion(event);
    });
    byId("kingdom-request-list")?.addEventListener("submit", submitReply);
    byId("kingdom-user-list")?.addEventListener("click", adminAction);
    byId("kingdom-player-list")?.addEventListener("click", adminAction);
    byId("kingdom-web-version-manager")?.addEventListener("click", adminAction);
  }

  function init(initOptions) {
    if (options) return;
    options = initOptions || {};
    bind();
  }

  window.KingdomUI = Object.freeze({ init, refresh });
})();
