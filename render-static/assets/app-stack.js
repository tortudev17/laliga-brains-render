(() => {
  const configs = {
    partidos: {
      container: ".partidos-content",
      extraContainers: ["#matches-view"],
      pages: [
        { id: "resumen", title: "Resumen", description: "Puntuación y último partido", icon: "⚽", color: "#2189ed", panels: ["#partidos-overview", "#partidos-match-column"] },
        { id: "tendencias", title: "Tendencias", description: "Puntos y goles a lo largo del tiempo", icon: "↗", color: "#11a6a1", panels: ["#partidos-trends"] },
        { id: "partidos", title: "Todos los partidos", description: "Resultados y goleadores", icon: "▤", color: "#f0a126", panels: ["#matches-view"], container: "#matches-view" },
        { id: "gestion", title: "Administrar partidos", description: "Crear y corregir resultados", icon: "⚙", color: "#8767dc", panels: ["#partidos-admin-panel"], guard: "#partidos-admin-panel" }
      ]
    },
    goles: {
      container: ".goles-content",
      startPage: "jugadores",
      pages: [
        { id: "jugadores", title: "Goleadores de 4.º ESO", noHeader: true, panels: ["#goles-screen-heading", "#goles-player-list", "#goles-status"] },
        { id: "jugador", title: "Jugador", panels: ["#goles-player-detail"] }
      ]
    },
    objetivos: {
      container: ".objetivos-content",
      pages: [
        { id: "crear", title: "Nuevo recordatorio", description: "Añade algo que quieras cumplir", icon: "＋", color: "#e9a826", panels: ["#objective-create-section", "#objetivos-status"] },
        { id: "lista", title: "Mis objetivos", description: "Revisa y marca tus recordatorios", icon: "✓", color: "#34a885", panels: ["#objective-list-section", "#objetivos-status"] }
      ]
    },
    perfil: {
      container: ".perfil-content",
      pages: [
        { id: "perfil", title: "Mi perfil", description: "Nombre, curso y monedas", icon: "◉", color: "#377bd2", panels: ["#profile-overview-section"] },
        { id: "apariencia", title: "Personalizar perfil", description: "Elige un emoji y su color", icon: "✦", color: "#8b65d9", panels: ["#profile-appearance-section"] },
        { id: "cuenta", title: "Cuenta", description: "Opciones de la cuenta", icon: "⚙", color: "#61778c", panels: ["#profile-account-section", "#profile-status"] }
      ]
    },
    fantasy: {
      container: ".fantasy-content",
      pages: [
        { id: "jugadores", title: "Ver jugadores", description: "Mercado, valor y ofertas", icon: "⚽", color: "#2489e9", panels: ["#fantasy-balance-card", "#fantasy-market-section", "#fantasy-status"] },
        { id: "plantilla", title: "Mi plantilla", description: "Jugadores, inversiones y ventas", icon: "▦", color: "#27a987", panels: ["#fantasy-balance-card", "#fantasy-roster-section", "#fantasy-status"] },
        { id: "ofertas", title: "Ofertas", description: "Enviadas y recibidas", icon: "⇄", color: "#f0a229", panels: ["#fantasy-balance-card", "#fantasy-offers-section", "#fantasy-activity-section", "#fantasy-status"] }
      ]
    },
    predicciones: {
      container: ".competition-content",
      pages: [
        { id: "resultado", title: "Apostar al resultado", description: "Elige quién ganará", icon: "⚽", color: "#2889e7", panels: ["#prediction-intro", "#prediction-balance", "#winner-prediction-card"] },
        { id: "goleador", title: "Apostar por un goleador", description: "Elige si marcará un jugador", icon: "✦", color: "#ee9d2b", panels: ["#prediction-balance", "#scorer-prediction-card"] },
        { id: "apuestas", title: "Mis apuestas", description: "Consulta tus apuestas", icon: "▤", color: "#30a982", panels: ["#prediction-balance", "#my-bets-card"] }
      ]
    },
    "en-juego": {
      container: ".competition-content",
      pages: [
        { id: "enviar", title: "Enviar jugador", description: "Elige jugador y duración", icon: "▶", color: "#e66f54", panels: ["#game-intro", "#game-balance", "#assignment-form", "#assignment-status"] },
        { id: "activos", title: "Jugadores en juego", description: "Estado y monedas generadas", icon: "◷", color: "#268add", panels: ["#game-balance", "#assignment-active-section", "#assignment-status"] }
      ]
    },
    reino: {
      container: ".kingdom-content",
      pages: [
        { id: "mensaje", title: "Enviar un mensaje a Adri", description: "Envía una idea o comentario", icon: "✉", color: "#497bdb", panels: ["#kingdom-user-message-section", "#kingdom-status"], guard: "#kingdom-user-view" },
        { id: "mis-mensajes", title: "Mis mensajes", description: "Lee las respuestas recibidas", icon: "☷", color: "#29a883", panels: ["#kingdom-user-requests-section", "#kingdom-status"], guard: "#kingdom-user-view" },
        { id: "anuncios", title: "Anuncios", description: "Avisos del Reino", icon: "♢", color: "#e7a42b", panels: ["#kingdom-announcement-section", "#kingdom-status"], guard: "#kingdom-user-view" },
        { id: "web", title: "Web y versiones", description: "Publicaciones y cambios", icon: "▣", color: "#6c66d5", panels: ["#kingdom-web-version-manager", "#kingdom-status"], guard: "#kingdom-admin-view" },
        { id: "usuarios", title: "Usuarios y jugadores", description: "Saldo y propietarios", icon: "♙", color: "#2588e6", panels: ["#kingdom-user-player-section", "#kingdom-status"], guard: "#kingdom-admin-view" },
        { id: "gestion", title: "Solicitudes y anuncios", description: "Respuestas y avisos", icon: "☷", color: "#df8b38", panels: ["#kingdom-admin-messages-section", "#kingdom-status"], guard: "#kingdom-admin-view" },
        { id: "actividad", title: "Actividad", description: "Movimientos recientes", icon: "◷", color: "#30a788", panels: ["#kingdom-activity-section", "#kingdom-status"], guard: "#kingdom-admin-view" }
      ]
    }
  };

  const states = new Map();
  const hiddenClass = "app-stack-panel-hidden";

  function resolve(root, selector) {
    try { return [...root.querySelectorAll(selector)]; } catch { return []; }
  }

  function isAvailable(root, page) {
    if (!page.guard) return true;
    const guards = resolve(root, page.guard);
    return guards.some((guard) => !guard.hidden && !guard.closest("[hidden]"));
  }

  function createRow(appId, page) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "app-stack-menu-row";
    button.dataset.appStackOpen = appId;
    button.dataset.stackPage = page.id;
    button.setAttribute("aria-label", page.description ? `${page.title}. ${page.description}` : page.title);
    const icon = document.createElement("span");
    icon.className = "app-stack-menu-icon";
    icon.style.setProperty("--menu-icon-color", page.color || "#268add");
    icon.textContent = page.icon || "›";
    const copy = document.createElement("span");
    copy.className = "app-stack-menu-copy";
    const title = document.createElement("strong");
    title.textContent = page.title;
    copy.append(title);
    if (page.description) {
      const description = document.createElement("small");
      description.textContent = page.description;
      copy.append(description);
    }
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrow.setAttribute("viewBox", "0 0 24 24");
    arrow.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m9 5 7 7-7 7");
    arrow.append(path);
    button.append(icon, copy, arrow);
    return button;
  }

  function build(appId, config) {
    const root = document.getElementById(`${appId}-app`);
    if (!root) return null;
    const menu = document.createElement("nav");
    menu.className = "app-stack-menu";
    menu.setAttribute("aria-label", `Menú de ${appId}`);
    const header = document.createElement("header");
    header.className = "app-stack-header";
    header.hidden = true;
    const back = document.createElement("button");
    back.type = "button";
    back.className = "app-stack-back";
    back.dataset.appStackBack = appId;
    back.setAttribute("aria-label", "Atrás");
    const backIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    backIcon.setAttribute("viewBox", "0 0 24 24");
    backIcon.setAttribute("aria-hidden", "true");
    const backPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    backPath.setAttribute("d", "m15 5-7 7 7 7M8 12h12");
    backIcon.append(backPath);
    back.append(backIcon);
    const heading = document.createElement("h2");
    heading.className = "app-stack-title";
    header.append(back, heading);

    const pageNodes = new Set();
    const containerNodes = new Set();
    const allContainers = [config.container, ...(config.extraContainers || [])].filter(Boolean);
    for (const selector of allContainers) {
      for (const node of resolve(root, selector)) {
        node.classList.add("app-stack-container");
        containerNodes.add(node);
      }
    }
    for (const page of config.pages) {
      if (page.menu !== false) menu.append(createRow(appId, page));
      for (const selector of page.panels || []) {
        for (const node of resolve(root, selector)) {
          node.classList.add("app-stack-panel", hiddenClass);
          pageNodes.add(node);
        }
      }
    }
    root.insertBefore(header, root.firstChild);
    root.insertBefore(menu, header);
    const state = { appId, root, config, menu, header, heading, pageNodes, containerNodes, stack: [] };
    states.set(appId, state);
    reset(appId);
    return state;
  }

  function pageById(state, pageId) {
    return state.config.pages.find((page) => page.id === pageId);
  }

  function setPage(state, page) {
    const panels = new Set((page?.panels || []).flatMap((selector) => resolve(state.root, selector)));
    for (const panel of state.pageNodes) panel.classList.toggle(hiddenClass, !panels.has(panel));
    const activeContainers = new Set((page ? [page.container || state.config.container] : []).filter(Boolean).flatMap((selector) => resolve(state.root, selector)));
    for (const container of state.containerNodes) container.classList.toggle("app-stack-container-hidden", !activeContainers.has(container));
    const matches = resolve(state.root, "#matches-view")[0];
    if (matches) matches.hidden = !(page?.id === "partidos" && state.appId === "partidos");
    state.root.dataset.stackPage = page?.id || "menu";
    state.root.classList.toggle("is-stack-detail", Boolean(page));
    state.root.classList.toggle("is-stack-list", Boolean(page?.scrollable));
    state.menu.hidden = Boolean(page);
    state.header.hidden = !page || Boolean(page.noHeader);
    state.heading.textContent = page?.title || "";
    for (const button of state.menu.querySelectorAll("[data-stack-page]")) {
      const entry = pageById(state, button.dataset.stackPage);
      button.hidden = !isAvailable(state.root, entry || {});
    }
  }

  function reset(appId) {
    const state = states.get(appId) || (configs[appId] && build(appId, configs[appId]));
    if (!state) return;
    state.stack = [];
    const startPage = state.config.startPage && pageById(state, state.config.startPage);
    if (startPage) state.stack = [startPage];
    setPage(state, state.stack.at(-1) || null);
  }

  function open(appId, pageId, options = {}) {
    const state = states.get(appId) || (configs[appId] && build(appId, configs[appId]));
    if (!state) return false;
    const page = pageById(state, pageId);
    if (!page || !isAvailable(state.root, page)) return false;
    if (options.title) page.title = options.title;
    state.stack = [...state.stack, page];
    setPage(state, page);
    return true;
  }

  function push(appId, page) {
    const state = states.get(appId) || (configs[appId] && build(appId, configs[appId]));
    if (!state || !page) return false;
    state.stack = [...state.stack, page];
    setPage(state, page);
    return true;
  }

  function back(appId) {
    const state = states.get(appId);
    if (!state || !state.stack.length) return;
    if (state.stack.length > 1) state.stack.pop();
    else if (state.config.startPage) state.stack = [pageById(state, state.config.startPage)];
    else state.stack = [];
    setPage(state, state.stack.at(-1) || null);
  }

  function sync(appId) {
    const state = states.get(appId);
    if (!state) return;
    for (const button of state.menu.querySelectorAll("[data-stack-page]")) {
      const entry = pageById(state, button.dataset.stackPage);
      button.hidden = !isAvailable(state.root, entry || {});
    }
  }

  document.addEventListener("click", (event) => {
    const row = event.target.closest("[data-app-stack-open][data-stack-page]");
    if (row) {
      event.preventDefault();
      open(row.dataset.appStackOpen, row.dataset.stackPage);
      return;
    }
    const backButton = event.target.closest("[data-app-stack-back]");
    if (backButton) {
      event.preventDefault();
      back(backButton.dataset.appStackBack);
    }
  });

  window.AppStack = Object.freeze({ reset, open, push, back, sync });
  for (const [appId, config] of Object.entries(configs)) build(appId, config);
})();
