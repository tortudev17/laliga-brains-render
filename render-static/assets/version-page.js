(() => {
  const apiKey = document.querySelector('meta[name="firebase-api-key"]')?.content?.trim() || "";
  const databaseUrl = `${window.location.origin}/firebase/database`;
  const authUrl = `${window.location.origin}/securetoken.googleapis.com/v1/token`;
  const sessionKey = "laligaBrainsAuthSession";
  const appUrl = "./index.html?manageWeb=1";
  let releasePreview = null;

  function showStatus(message, loginLink = false, error = false) {
    const main = document.querySelector("main");
    if (!main) return;
    if (releasePreview) { releasePreview(); releasePreview = null; }
    main.replaceChildren();
    const panel = document.createElement("div");
    panel.id = "page-status";
    panel.style.color = error ? "#a53037" : "";
    panel.append(document.createTextNode(message));
    if (loginLink) {
      const link = document.createElement("a");
      link.href = appUrl;
      link.textContent = "Iniciar sesión";
      panel.append(document.createElement("br"), link);
    }
    main.append(panel);
  }

  function updatePageStatus(message) {
    const status = document.querySelector("#page-status");
    if (status) status.textContent = message;
  }

  async function sessionToken() {
    let session;
    try { session = JSON.parse(localStorage.getItem(sessionKey) || "null"); } catch { session = null; }
    if (!session?.refreshToken) return "";
    const response = await fetch(`${authUrl}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error?.message || "SESSION_REFRESH_FAILED");
    try { localStorage.setItem(sessionKey, JSON.stringify({ username: session.username || "", refreshToken: result.refresh_token || session.refreshToken })); } catch { /* The active token is still usable. */ }
    return result.id_token || "";
  }

  async function showVersion(version, token, { code = false } = {}) {
    const content = document.querySelector("main");
    const header = document.querySelector("#version-header");
    if (!content) return;
    const id = String(version.id || new URLSearchParams(location.search).get("id") || "");
    if (header) {
      document.querySelector("#version-id").textContent = id;
      document.querySelector("#preview-link").href = `./version-preview.html?id=${encodeURIComponent(id)}&view=preview`;
      document.querySelector("#code-link").href = `./version-preview.html?id=${encodeURIComponent(id)}&view=code`;
      document.querySelector("#preview-link").setAttribute("aria-current", String(!code));
      document.querySelector("#code-link").setAttribute("aria-current", String(code));
      header.hidden = false;
    }
    updatePageStatus(`Descargando los archivos de la versión ${id}…`);
    const files = await window.SiteVersions.readVersion(databaseUrl, version, token);
    if (!code) {
      updatePageStatus("Preparando la vista previa…");
      const iframe = document.createElement("iframe");
      iframe.title = `Previsualización de la versión ${id}`;
      iframe.setAttribute("sandbox", "allow-scripts allow-forms");
      iframe.setAttribute("referrerpolicy", "no-referrer");
      const shell = document.createElement("div");
      shell.className = "version-frame-shell";
      const loader = document.createElement("div");
      loader.className = "version-frame-loading";
      loader.setAttribute("role", "status");
      loader.setAttribute("aria-live", "polite");
      loader.innerHTML = '<span class="version-loader-spinner" aria-hidden="true"></span><span>Cargando la web y sus imágenes…</span>';
      iframe.addEventListener("load", () => { loader.hidden = true; });
      iframe.addEventListener("error", () => { loader.textContent = "No se pudo cargar la vista previa."; });
      shell.append(iframe, loader);
      content.replaceChildren(shell);
      releasePreview = window.SiteVersions.createPreview(files, iframe);
      return;
    }
    content.replaceChildren();
    const pane = document.createElement("div");
    pane.id = "code-pane";
    const fileList = document.createElement("nav");
    fileList.id = "file-list";
    const source = document.createElement("pre");
    source.id = "source";
    const textual = [...files.entries()].filter(([name]) => /\.(?:html?|css|mjs?|json|txt|md|xml|webmanifest)$/i.test(name));
    if (!textual.length) source.textContent = "No hay archivos de código de texto en esta versión.";
    for (const [filename, contents] of textual) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = filename;
      button.addEventListener("click", () => {
        source.textContent = new TextDecoder().decode(contents);
        [...fileList.querySelectorAll("button")].forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      });
      fileList.append(button);
    }
    if (textual[0]) {
      source.textContent = new TextDecoder().decode(textual[0][1]);
      fileList.firstElementChild?.setAttribute("aria-pressed", "true");
    }
    pane.append(fileList, source);
    content.append(pane);
  }

  async function start() {
    const isPublished = location.pathname.endsWith("published.html");
    const query = new URLSearchParams(location.search);
    const status = document.querySelector("#page-status");
    try {
      updatePageStatus("Comprobando la sesión…");
      const token = await sessionToken();
      if (!token) { showStatus("Inicia sesión para ver esta versión de la web.", true); return; }
      let version;
      if (isPublished) {
        updatePageStatus("Buscando la versión actual…");
        version = await window.SiteVersions.getCurrentVersion(databaseUrl, token);
        if (!version) { window.location.replace("./index.html"); return; }
        document.querySelector("#published-id").textContent = `Versión ${version.id}`;
        document.querySelector("#published-header").hidden = false;
        try {
          const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
          const claims = JSON.parse(decodeURIComponent(Array.from(atob(payload), (character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")));
          document.querySelector("#manage-link").hidden = String(claims.email || "").toLowerCase() !== "adri@laligabrains.com";
        } catch { /* Keep the management link hidden when the session claim cannot be read. */ }
      } else {
        updatePageStatus("Buscando la versión solicitada…");
        const id = query.get("id");
        if (!id) throw new Error("Falta el identificador de la versión.");
        version = await window.SiteVersions.getVersion(databaseUrl, token, id);
        if (!version) throw new Error("No se encontró esa versión.");
      }
      await showVersion(version, token, { code: !isPublished && query.get("view") === "code" });
      if (isPublished) {
        const activeId = version.id;
        window.setInterval(async () => {
          try {
            const latest = await window.SiteVersions.getCurrentVersion(databaseUrl, await sessionToken());
            if ((latest?.id || "") !== activeId) window.location.reload();
          } catch { /* Retain the last loaded site during a brief network interruption. */ }
        }, 30000);
      }
    } catch (error) {
      if (status) showStatus(error?.message || "No se pudo cargar esta versión.", false, true);
    }
  }

  void start();
})();
