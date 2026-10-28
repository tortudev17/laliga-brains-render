(() => {
  const shape = document.querySelector("#duo-device");
  const canvas = document.querySelector("#phone-screen");
  const phoneContent = document.querySelector("#phone-content");
  const foldToggle = document.querySelector("#fold-toggle");
  const appShell = document.querySelector(".app-shell");
  const prompt = document.querySelector("#username-prompt");
  const form = document.querySelector("#username-form");
  const usernameCard = document.querySelector(".username-card");
  const usernameInput = document.querySelector("#username");
  const passwordInput = document.querySelector("#password");
  const passwordRepeatInput = document.querySelector("#password-repeat");
  const passwordLabel = document.querySelector("#password-label");
  const passwordRepeatLabel = document.querySelector("#password-repeat-label");
  const membershipSelect = document.querySelector("#membership");
  const membershipWrap = document.querySelector("#membership-wrap");
  const membershipLabel = document.querySelector("#membership-label");
  const usernameStatus = document.querySelector("#username-status");
  const continueButton = document.querySelector("#username-continue");
  const backButton = document.querySelector("#auth-back");
  const createAccountLink = document.querySelector("#create-account-link");
  const authNotice = document.querySelector("#auth-notice");

  const firebaseApiKey = document.querySelector('meta[name="firebase-api-key"]').content.trim();
  const firebaseBaseUrl = window.location.origin + "/firebase/database";
  const firebaseAuthUrl = window.location.origin + "/identitytoolkit.googleapis.com/v1/accounts";
  const firebaseTokenUrl = window.location.origin + "/securetoken.googleapis.com/v1/token";
  const authSessionKey = "laligaBrainsAuthSession";
  const maxMainContentBytes = 12 * 1024 * 1024;
  const authTransitionMs = 260;
  const closedRatio = 84.1 / 117.8;
  const openRatio = closedRatio * 2;

  let promptStage = "username";
  let requestPending = false;
  let currentUsername = "";
  let currentIdToken = "";
  let currentVersionNumber = "";
  let currentRouteId = "";
  let versionLoadError = "";
  let signOutPending = false;
  let routeLoadSequence = 0;
  let authNoticeTimer = 0;
  let settleTimer = 0;
  let canvasContext = null;
  let initialDeviceSizeApplied = false;

  function sizeDevice() {
    const viewportWidth = document.documentElement.clientWidth;
    const widthBudget = Math.max(0, viewportWidth - (viewportWidth <= 360 ? 24 : 32));
    const height = Math.max(160, Math.min(window.innerHeight * .94, window.innerHeight - 32, 840, widthBudget / openRatio));
    if (!initialDeviceSizeApplied) shape.style.transition = "none";
    shape.style.setProperty("--device-height", height + "px");
    shape.style.setProperty("--closed-width", (height * closedRatio) + "px");
    shape.style.setProperty("--open-width", (height * openRatio) + "px");
    shape.style.setProperty("--panel-width", (height * closedRatio) + "px");
    shape.style.setProperty("--closed-corner-radius", (height * .075) + "px");
    shape.style.setProperty("--open-corner-radius", (height * .125) + "px");
    renderCanvas();
    if (!initialDeviceSizeApplied) {
      shape.getBoundingClientRect();
      window.requestAnimationFrame(() => shape.style.removeProperty("transition"));
      initialDeviceSizeApplied = true;
    }
  }

  function renderCanvas() {
    const rect = shape.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvasContext = canvas.getContext("2d", { alpha: false });
    if (!canvasContext) return;
    canvasContext.fillStyle = "#030405";
    canvasContext.fillRect(0, 0, width, height);
  }

  const resizeObserver = new ResizeObserver(renderCanvas);
  resizeObserver.observe(shape);
  window.addEventListener("resize", sizeDevice, { passive: true });
  sizeDevice();

  function settleFoldState() {
    const open = shape.classList.contains("is-open");
    shape.classList.toggle("is-settled", open);
    shape.classList.toggle("is-closed-settled", !open);
  }

  function setFoldState(open) {
    if (shape.classList.contains("is-open") === open) return;
    window.clearTimeout(settleTimer);
    shape.classList.remove("is-settled", "is-closed-settled");
    shape.classList.toggle("is-open", open);
    appShell.classList.toggle("phone-open", open);
    foldToggle.disabled = open;
    foldToggle.setAttribute("aria-pressed", String(open));
    foldToggle.setAttribute("aria-label", open ? "iPhone Duo abierto" : "Abrir iPhone Duo");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      settleFoldState();
      return;
    }
    settleTimer = window.setTimeout(settleFoldState, 1100);
  }

  function toggleFold() {
    if (!shape.classList.contains("is-open")) setFoldState(true);
  }

  foldToggle.addEventListener("click", toggleFold);
  shape.addEventListener("transitionend", (event) => {
    if (event.target === shape && event.propertyName === "width") {
      window.clearTimeout(settleTimer);
      settleFoldState();
    }
  });

  function showNotice(message) {
    window.clearTimeout(authNoticeTimer);
    authNotice.textContent = message;
    authNotice.hidden = false;
    authNoticeTimer = window.setTimeout(() => {
      authNotice.hidden = true;
      authNotice.textContent = "";
      authNoticeTimer = 0;
    }, 4000);
  }

  function requestUsernameName(username) {
    return new Promise((resolve, reject) => {
      const callbackName = "firebaseUsernameLookup_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      const script = document.createElement("script");
      let timeoutId = 0;
      function cleanup() {
        window.clearTimeout(timeoutId);
        script.remove();
        delete window[callbackName];
      }
      window[callbackName] = (name) => { cleanup(); resolve(name); };
      script.onerror = () => { cleanup(); reject(new Error("DATABASE_LOOKUP_FAILED")); };
      script.src = firebaseBaseUrl + "/users/" + encodeURIComponent(username) + "/name.json?callback=" + callbackName;
      script.async = true;
      timeoutId = window.setTimeout(() => { cleanup(); reject(new Error("DATABASE_LOOKUP_TIMEOUT")); }, 10000);
      document.head.append(script);
    });
  }

  function looksLikeHtml(value) {
    return typeof value === "string" && /^\uFEFF?\s*</.test(value);
  }

  function decodeBase64(value) {
    let encoded = String(value || "").trim();
    if (/^data:/i.test(encoded)) {
      const comma = encoded.indexOf(",");
      if (comma < 0 || !/;base64/i.test(encoded.slice(0, comma))) return null;
      encoded = encoded.slice(comma + 1);
    }
    encoded = encoded.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!encoded || !/^[a-z\d+/]*={0,2}$/i.test(encoded)) return null;
    encoded = encoded.replace(/=+$/, "");
    if (encoded.length % 4 === 1) return null;
    encoded += "=".repeat((4 - encoded.length % 4) % 4);
    try {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    } catch {
      return null;
    }
  }

  function isZip(bytes) {
    return bytes?.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
      && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06) || (bytes[2] === 0x07 && bytes[3] === 0x08));
  }

  function isGzip(bytes) {
    return bytes?.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  }

  async function decompress(bytes, format) {
    if (typeof DecompressionStream !== "function") return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      const result = await new Response(stream).arrayBuffer();
      if (result.byteLength > maxMainContentBytes) throw new Error("CODE_MAIN_TOO_LARGE");
      return new Uint8Array(result);
    } catch (error) {
      if (error?.message === "CODE_MAIN_TOO_LARGE") throw error;
      return null;
    }
  }

  async function extractHtmlFromZip(bytes) {
    if (bytes.byteLength > 5 * 1024 * 1024 || bytes.byteLength < 22) return "";
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let endOffset = -1;
    const scanStart = Math.max(0, bytes.byteLength - 65557);
    for (let offset = bytes.byteLength - 22; offset >= scanStart; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) { endOffset = offset; break; }
    }
    if (endOffset < 0) return "";
    const entryCount = view.getUint16(endOffset + 10, true);
    const centralSize = view.getUint32(endOffset + 12, true);
    const centralOffset = view.getUint32(endOffset + 16, true);
    if (entryCount > 50 || centralOffset + centralSize > bytes.byteLength) return "";
    const decoder = new TextDecoder();
    const entries = [];
    let offset = centralOffset;
    let expandedSize = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) return "";
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const size = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, "/");
      offset += 46 + nameLength + extraLength + commentLength;
      if (!name || name.endsWith("/") || name.startsWith("/") || name.split("/").includes("..")) continue;
      if ((flags & 1) !== 0 || (method !== 0 && method !== 8)) continue;
      expandedSize += size;
      if (size > maxMainContentBytes || expandedSize > maxMainContentBytes) throw new Error("CODE_MAIN_TOO_LARGE");
      entries.push({ name, method, compressedSize, size, localOffset });
    }
    const htmlEntry = entries.find((entry) => entry.name.toLowerCase() === "index.html")
      || entries.find((entry) => entry.name.toLowerCase().endsWith("/index.html"))
      || entries.find((entry) => /\.html?$/i.test(entry.name));
    if (!htmlEntry || htmlEntry.localOffset + 30 > bytes.byteLength) return "";
    const local = htmlEntry.localOffset;
    if (view.getUint32(local, true) !== 0x04034b50) return "";
    const localNameLength = view.getUint16(local + 26, true);
    const localExtraLength = view.getUint16(local + 28, true);
    const start = local + 30 + localNameLength + localExtraLength;
    const end = start + htmlEntry.compressedSize;
    if (end > bytes.byteLength) return "";
    const content = bytes.subarray(start, end);
    const expanded = htmlEntry.method === 0 ? content : await decompress(content, "deflate-raw");
    if (!expanded || expanded.byteLength !== htmlEntry.size) return "";
    const html = decoder.decode(expanded).replace(/^\uFEFF/, "");
    return looksLikeHtml(html) ? html : "";
  }

  async function decodeCompressedContent(bytes, hint = "") {
    if (!bytes?.length || bytes.byteLength > 5 * 1024 * 1024) return "";
    if (isZip(bytes)) return extractHtmlFromZip(bytes);
    const decoder = new TextDecoder();
    const directText = decoder.decode(bytes).replace(/^\uFEFF/, "");
    if (looksLikeHtml(directText)) return directText;

    const normalizedHint = String(hint || "").toLowerCase();
    const formats = [];
    if (isGzip(bytes) || /gzip|gz/.test(normalizedHint)) formats.push("gzip");
    if (/deflate-raw|raw/.test(normalizedHint)) formats.push("deflate-raw");
    if (/deflate|zlib/.test(normalizedHint) || (bytes[0] & 0x0f) === 8) formats.push("deflate");
    if (/zip|archive/.test(normalizedHint)) formats.push("deflate-raw");
    formats.push("gzip", "deflate", "deflate-raw");
    for (const format of [...new Set(formats)]) {
      const expanded = await decompress(bytes, format);
      if (!expanded) continue;
      if (isZip(expanded)) {
        const html = await extractHtmlFromZip(expanded);
        if (html) return html;
      }
      const text = decoder.decode(expanded).replace(/^\uFEFF/, "");
      if (looksLikeHtml(text)) return text;
      const nested = decodeBase64(text);
      if (nested) {
        const html = await decodeCompressedContent(nested, hint);
        if (html) return html;
      }
    }
    return "";
  }

  async function decodeHtmlString(value, hint = "") {
    const text = String(value || "").trim();
    if (!text) return "";
    if (looksLikeHtml(text)) return text;
    if (/^data:text\/html/i.test(text) && !/;base64/i.test(text.slice(0, text.indexOf(",")))) {
      const comma = text.indexOf(",");
      if (comma >= 0) {
        try { return decodeURIComponent(text.slice(comma + 1)); } catch {}
      }
    }
    const bytes = decodeBase64(text);
    if (bytes) return decodeCompressedContent(bytes, hint);
    return "";
  }

  function databaseNodeUrl(path, idToken) {
    const normalizedPath = String(path || "").replace(/^\/+|\/+$/g, "").replace(/\.json$/i, "");
    const encodedPath = normalizedPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    return firebaseBaseUrl + "/" + encodedPath + ".json?auth=" + encodeURIComponent(idToken);
  }

  async function readDatabaseNode(path, idToken) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(databaseNodeUrl(path, idToken), { cache: "no-store", signal: controller.signal });
      const value = await response.json().catch(() => null);
      if (!response.ok) throw new Error("CODE_DATABASE_READ_FAILED");
      return value;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function readHtmlReference(reference, idToken, depth, hint = "", basePath = "") {
    if (depth > 2 || typeof reference !== "string" || !reference.trim()) return "";
    const value = reference.trim();
    const decoded = await decodeHtmlString(value, hint);
    if (decoded) return decoded;
    if (/^https?:\/\//i.test(value)) {
      const response = await fetch(value, { cache: "no-store" });
      if (!response.ok) throw new Error("CODE_MAIN_FILE_READ_FAILED");
      const contentType = response.headers.get("content-type") || "";
      if (/json/i.test(contentType)) return readHtmlPayload(await response.json().catch(() => null), idToken, depth + 1, hint, basePath);
      return readHtmlPayload(await response.text(), idToken, depth + 1, response.headers.get("content-encoding") || hint, basePath);
    }
    const relativePath = value.replace(/^\/+/, "");
    const path = value.startsWith("/") || relativePath.startsWith("code/") || !basePath
      ? relativePath
      : basePath.replace(/\/+$/, "") + "/" + relativePath;
    return readHtmlPayload(await readDatabaseNode(path, idToken), idToken, depth + 1, hint, basePath);
  }

  async function readHtmlPayload(value, idToken, depth = 0, inheritedHint = "", basePath = "") {
    if (typeof value === "string") {
      const decoded = await decodeHtmlString(value, inheritedHint);
      if (decoded) return decoded;
      const jsonPayload = await parseJsonText(value, idToken, depth, inheritedHint, basePath);
      return jsonPayload || readHtmlReference(value, idToken, depth, inheritedHint, basePath);
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) return "";

    const hint = [value.compression, value.compressedFormat, value.contentEncoding, value.encoding, value.archiveEncoding, value.compressed ? "compressed" : "", inheritedHint].filter(Boolean).join(" ");
    const inlineCandidates = [value.html, value.content, value.source, value.code, value.data, value.payload, value.archive, value.base64, value.contentBase64, value.compressedData, value.archiveData, value.data?.base64, value["index.html"], value["main.html"], value.files?.["index.html"], value.files?.["main.html"]];
    for (const candidate of inlineCandidates) {
      if (typeof candidate === "string" && looksLikeHtml(candidate)) return candidate;
    }
    for (const candidate of inlineCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        const html = await decodeHtmlString(candidate, hint);
        if (html) return html;
      }
      if (candidate && typeof candidate === "object") {
        const html = await readHtmlPayload(candidate, idToken, depth + 1, hint, basePath);
        if (html) return html;
      }
    }
    const reference = value.url || value.path || value.filePath || value.file || value.archivePath || value.dataPath;
    if (typeof reference === "string") return readHtmlReference(reference, idToken, depth + 1, hint, basePath);
    for (const candidate of inlineCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        const html = await readHtmlReference(candidate, idToken, depth + 1, hint, basePath);
        if (html) return html;
      }
    }
    return "";
  }

  async function parseJsonText(value, idToken, depth, hint, basePath) {
    const text = String(value || "").trim();
    if (!/^[{[]/.test(text)) return "";
    try { return readHtmlPayload(JSON.parse(text), idToken, depth + 1, hint, basePath); }
    catch { return ""; }
  }

  function mainRouteId(username = currentUsername) {
    return "$main@" + String(username || "").toLowerCase();
  }

  function appRouteId(version, username = currentUsername) {
    return "$" + String(version) + "@" + String(username || "").toLowerCase();
  }

  function parseRouteId(value) {
    if (typeof value !== "string" || !value.startsWith("$")) return null;
    const match = value.match(/^\$(main|[0-9]+)@([^@]+)$/);
    if (!match) return null;
    return { value, route: match[1] === "main" ? "main" : "version", version: match[1] === "main" ? "" : match[1], username: match[2] };
  }

  function scriptJson(value) {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => ({
      "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029"
    })[character]);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  }

  function normalizeVersionNumber(value) {
    let candidate = value;
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      candidate = candidate.number ?? candidate.version ?? candidate.currentVersion ?? candidate.current ?? candidate.id ?? candidate.main;
    }
    if (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0) return String(candidate);
    const number = String(candidate ?? "").trim();
    return /^[0-9]{1,12}$/.test(number) ? number : "";
  }

  async function readCurrentCodeVersion(idToken) {
    const mainRecord = await readDatabaseNode("code/main", idToken);
    const version = normalizeVersionNumber(mainRecord);
    if (!version) throw new Error("CODE_VERSION_NOT_FOUND");
    return version;
  }

  async function readVersionedMain(version, idToken) {
    const safeVersion = normalizeVersionNumber(version);
    if (!safeVersion) throw new Error("CODE_VERSION_NOT_FOUND");
    const candidates = [
      "code/version" + safeVersion + "/main",
      "code/" + safeVersion + "/main",
      "code/version/" + safeVersion + "/main",
      "code/versions/" + safeVersion + "/main"
    ];
    for (const path of candidates) {
      try {
        const record = await readDatabaseNode(path, idToken);
        const html = await readHtmlPayload(record, idToken, 0, "", path);
        if (html) return html;
      } catch {}
    }
    throw new Error("CODE_VERSION_NOT_FOUND");
  }

  function homeScreenHtml(infoMessage = "", autoLaunch = false) {
    const routeId = mainRouteId();
    const appId = currentVersionNumber ? appRouteId(currentVersionNumber) : "";
    const wallpaperUrl = new URL("./assets/duo-wallpaper.jpg", window.location.href).href;
    const safeInfo = escapeHtml(infoMessage || versionLoadError);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Inicio</title><style>
      *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{position:relative;display:grid;place-items:center;background:#071b20;color:#fff;font-family:Inter,"Avenir Next",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .wallpaper{position:fixed;inset:-2%;width:104%;height:104%;object-fit:cover;filter:blur(5px) saturate(.82);transform:scale(1.02)}.wash{position:fixed;inset:0;background:linear-gradient(145deg,rgba(4,17,21,.25),rgba(4,17,21,.39))}
      .home{position:relative;z-index:1;display:grid;place-items:center;width:100%;height:100%;padding:24px}.football-app{display:grid;place-items:center;width:clamp(78px,13vw,116px);aspect-ratio:1;border:0;border-radius:26px;background:#fff;color:#111;box-shadow:0 18px 42px rgba(0,0,0,.24);cursor:pointer;transition:transform 180ms ease,box-shadow 180ms ease}.football-app:hover{transform:translateY(-3px) scale(1.035);box-shadow:0 24px 52px rgba(0,0,0,.3)}.football-app:focus-visible{outline:3px solid #fff;outline-offset:5px}.football-app span{font-size:clamp(42px,7vw,64px);line-height:1}
      .info{position:fixed;z-index:2;left:50%;bottom:22px;width:min(460px,calc(100% - 32px));padding:14px 18px;border:1px solid rgba(255,255,255,.2);border-radius:16px;background:rgba(13,24,28,.78);color:#fff;text-align:center;font-size:14px;line-height:1.45;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);transform:translateX(-50%)}.info[hidden]{display:none}
      .launch-cover{position:fixed;z-index:10;width:96px;height:96px;border-radius:26px;background:#fff;pointer-events:none;transform:scale(0);transform-origin:center;box-shadow:0 18px 42px rgba(0,0,0,.22)}
      body.launching .football-app{opacity:0;transition:opacity 120ms ease}
      @media(prefers-reduced-motion:reduce){.football-app{transition:none}.football-app:hover{transform:none}}
    </style></head><body><img class="wallpaper" src="${escapeHtml(wallpaperUrl)}" alt=""><div class="wash" aria-hidden="true"></div><main class="home"><button class="football-app" id="football-app" type="button" aria-label="Abrir aplicación de fútbol"><span aria-hidden="true">⚽</span></button><div class="launch-cover" id="launch-cover" aria-hidden="true"></div><p class="info" id="home-info" role="status" ${safeInfo ? "" : "hidden"}>${safeInfo}</p></main><script>
      let routeId=${scriptJson(routeId)};const appId=${scriptJson(appId)};const autoLaunch=${autoLaunch ? "true" : "false"};Object.defineProperty(window,"ID",{configurable:false,enumerable:true,get(){return routeId},set(value){routeId=String(value);parent.postMessage({channel:"duo-phone",type:"route-id",id:routeId},"*")}});parent.postMessage({channel:"duo-phone",type:"route-id",id:window.ID},"*");
      const icon=document.getElementById("football-app"),cover=document.getElementById("launch-cover"),info=document.getElementById("home-info");let launchStarted=false;function launchApp(){if(launchStarted)return;if(!appId){info.hidden=false;info.textContent="No hay una versión numérica configurada en /code/main.";return}launchStarted=true;const bounds=icon.getBoundingClientRect();cover.style.left=bounds.left+"px";cover.style.top=bounds.top+"px";cover.style.transform="scale(1)";document.body.classList.add("launching");const scale=Math.max(innerWidth,innerHeight)/96*1.5;const animation=cover.animate([{transform:"scale(1)",borderRadius:"26px"},{transform:"scale("+scale+")",borderRadius:"0px"}],{duration:720,easing:"cubic-bezier(.2,.75,.2,1)",fill:"forwards"});animation.finished.then(()=>{window.ID=appId}).catch(()=>{})}icon.addEventListener("click",launchApp);if(autoLaunch)setTimeout(launchApp,950);
    </script></body></html>`;
  }

  function injectIdentityIntoScripts(html, routeId) {
    const literal = scriptJson(routeId);
    return html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (block, open, code, close) => {
      const rewritten = code
        .replace(/\b(?:var|let|const)\s+ID\s*(?:=\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[^;\r\n]+))?\s*;?/g, `window.ID=${literal};`)
        .replace(/\bwindow\s*\.\s*ID\s*=\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[^;\r\n]+);?/g, `window.ID=${literal};`);
      return open + rewritten + close;
    });
  }

  function appScreenHtml(html, routeId) {
    const mainId = mainRouteId();
    let output = injectIdentityIntoScripts(html, routeId);
    const bootstrap = `<script>window.ID=${scriptJson(routeId)};</script>`;
    if (/<head\b[^>]*>/i.test(output)) output = output.replace(/<head\b[^>]*>/i, (head) => head + bootstrap);
    else output = bootstrap + output;
    const controls = `<style>#duo-app-home{position:fixed;top:14px;left:14px;z-index:2147483647;display:grid;place-items:center;width:44px;height:44px;padding:0;border:1px solid rgba(255,255,255,.3);border-radius:15px;background:rgba(14,20,24,.78);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.2);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);cursor:pointer}#duo-app-home:focus-visible{outline:3px solid #fff;outline-offset:3px}#duo-app-home svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}</style><button id="duo-app-home" type="button" aria-label="Volver al inicio" title="Volver al inicio"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7M5.5 9v11h13V9M9.5 20v-6h5v6"/></svg></button><script>(function(){const main=${scriptJson(mainId)};let route=String(window.ID||${scriptJson(routeId)});function report(value){parent.postMessage({channel:"duo-phone",type:"route-id",id:String(value)},"*")}try{Object.defineProperty(window,"ID",{configurable:false,enumerable:true,get(){return route},set(value){route=String(value);report(route)}})}catch{};const home=document.getElementById("duo-app-home");home.addEventListener("click",()=>{window.ID=main});report(window.ID);setInterval(()=>report(window.ID),700)})();</script>`;
    if (/<\/body>/i.test(output)) output = output.replace(/<\/body>/i, controls + "</body>");
    else output += controls;
    return output;
  }

  async function showMainScreen(infoMessage = "") {
    currentRouteId = mainRouteId();
    window.ID = currentRouteId;
    shape.classList.remove("is-app-open");
    shape.classList.remove("is-app-launching");
    phoneContent.srcdoc = homeScreenHtml(infoMessage, false);
    shape.classList.add("has-content");
    shape.inert = false;
    setFoldState(true);
  }

  async function loadVersionRoute(version, sequence) {
    const routeId = appRouteId(version);
    currentRouteId = routeId;
    window.ID = routeId;
    try {
      const html = await readVersionedMain(version, currentIdToken);
      if (sequence !== routeLoadSequence || !currentUsername || currentRouteId !== routeId) return;
      const frameReady = new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          phoneContent.removeEventListener("load", finish);
          resolve();
        };
        const timeout = window.setTimeout(finish, 5000);
        phoneContent.addEventListener("load", finish, { once: true });
      });
      phoneContent.srcdoc = appScreenHtml(html, routeId);
      shape.classList.add("has-content", "is-app-open", "is-app-launching");
      shape.inert = false;
      await frameReady;
      if (sequence === routeLoadSequence && currentUsername && currentRouteId === routeId) {
        shape.classList.remove("is-app-launching");
      }
    } catch {
      if (sequence !== routeLoadSequence || !currentUsername) return;
      shape.classList.remove("is-app-launching");
      versionLoadError = `No existe la versión ${version}. Se ha vuelto a ${mainRouteId()}.`;
      currentVersionNumber = "";
      routeLoadSequence += 1;
      await showMainScreen(versionLoadError);
    }
  }

  async function acceptRouteId(value) {
    if (!currentUsername) return;
    const route = parseRouteId(value);
    if (!route || route.username !== currentUsername) {
      await signOutForInvalidId();
      return;
    }
    if (route.value === currentRouteId) return;
    const sequence = ++routeLoadSequence;
    if (route.route === "main") {
      currentVersionNumber = currentVersionNumber || "";
      versionLoadError = "";
      await showMainScreen();
      return;
    }
    shape.classList.add("is-app-launching");
    await loadVersionRoute(route.version, sequence);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== phoneContent.contentWindow || !currentUsername) return;
    const message = event.data;
    if (!message || message.channel !== "duo-phone" || message.type !== "route-id") return;
    void acceptRouteId(message.id);
  });

  async function showAuthenticatedHome(idToken) {
    currentIdToken = idToken;
    signOutPending = false;
    const sequence = ++routeLoadSequence;
    appShell.classList.add("is-auth-transition");
    prompt.classList.remove("is-visible");
    prompt.setAttribute("aria-hidden", "true");
    shape.inert = true;
    phoneContent.srcdoc = "";
    shape.classList.remove("has-content", "is-app-open");
    await new Promise((resolve) => window.setTimeout(resolve, authTransitionMs));
    if (sequence !== routeLoadSequence || !currentUsername) return;
    prompt.hidden = true;
    appShell.classList.remove("auth-active", "is-auth-transition");
    currentRouteId = mainRouteId();
    window.ID = currentRouteId;
    currentVersionNumber = "";
    versionLoadError = "";
    try { currentVersionNumber = await readCurrentCodeVersion(currentIdToken); }
    catch { versionLoadError = "No se pudo leer la versión activa en /code/main."; }
    if (sequence !== routeLoadSequence || !currentUsername) return;
    phoneContent.srcdoc = homeScreenHtml(versionLoadError, true);
    shape.classList.add("has-content");
    shape.classList.remove("is-app-open");
    shape.inert = false;
    setFoldState(true);
  }

  async function signOutForInvalidId() {
    if (signOutPending) return;
    signOutPending = true;
    routeLoadSequence += 1;
    forgetAuthSession();
    currentUsername = "";
    currentIdToken = "";
    currentVersionNumber = "";
    currentRouteId = "";
    versionLoadError = "";
    window.ID = "";
    phoneContent.srcdoc = "";
    shape.classList.remove("has-content", "is-app-open");
    shape.inert = true;
    appShell.classList.add("is-auth-transition");
    setFoldState(false);
    await new Promise((resolve) => window.setTimeout(resolve, authTransitionMs + 920));
    appShell.classList.remove("is-auth-transition");
    appShell.classList.add("auth-active");
    prompt.hidden = false;
    prompt.classList.add("is-visible");
    prompt.setAttribute("aria-hidden", "false");
    shape.inert = false;
    usernameCard.classList.remove("is-restoring", "is-loading");
    returnToUsername(true);
    signOutPending = false;
  }

  function setContinueText() {
    continueButton.textContent = promptStage === "login" ? "Iniciar sesión" : "Continuar";
  }

  function clearCredentialFields() {
    passwordInput.value = "";
    passwordInput.hidden = true;
    passwordInput.autocomplete = "current-password";
    passwordLabel.hidden = true;
    passwordLabel.textContent = "Contraseña";
    passwordRepeatInput.value = "";
    passwordRepeatInput.hidden = true;
    passwordRepeatLabel.hidden = true;
    membershipSelect.value = "";
    membershipWrap.hidden = true;
    membershipLabel.hidden = true;
    createAccountLink.hidden = true;
  }

  function returnToUsername(clearUsername) {
    promptStage = "username";
    usernameInput.readOnly = false;
    if (clearUsername) usernameInput.value = "";
    clearCredentialFields();
    usernameStatus.textContent = "";
    backButton.hidden = true;
    setContinueText();
    usernameInput.focus({ preventScroll: true });
  }

  function showLogin(name) {
    promptStage = "login";
    usernameInput.readOnly = true;
    passwordInput.autocomplete = "current-password";
    passwordLabel.textContent = "Contraseña";
    passwordLabel.hidden = false;
    passwordInput.hidden = false;
    passwordRepeatInput.hidden = true;
    passwordRepeatLabel.hidden = true;
    membershipWrap.hidden = true;
    membershipLabel.hidden = true;
    createAccountLink.hidden = false;
    backButton.hidden = false;
    usernameStatus.textContent = "¡Te damos la bienvenida, " + name + "!";
    setContinueText();
    passwordInput.focus({ preventScroll: true });
  }

  function showRegistration() {
    promptStage = "registration";
    usernameInput.readOnly = true;
    passwordInput.autocomplete = "new-password";
    passwordLabel.textContent = "Crea una contraseña";
    passwordLabel.hidden = false;
    passwordInput.hidden = false;
    passwordRepeatInput.hidden = false;
    passwordRepeatLabel.hidden = false;
    membershipLabel.hidden = false;
    membershipWrap.hidden = false;
    createAccountLink.hidden = true;
    backButton.hidden = false;
    usernameStatus.textContent = "No existe una cuenta con este nombre de usuario. Crea una cuenta para continuar.";
    setContinueText();
    passwordInput.focus({ preventScroll: true });
  }

  function firebaseErrorMessage(code) {
    const messages = {
      FIREBASE_API_KEY_MISSING: "Falta configurar la clave web de Firebase.",
      WEAK_PASSWORD: "La contraseña debe tener al menos 6 caracteres.",
      INVALID_PASSWORD: "La contraseña no es correcta.",
      INVALID_LOGIN_CREDENTIALS: "El nombre de usuario o la contraseña no son correctos.",
      API_KEY_INVALID: "La clave de Firebase no es válida.",
      EMAIL_NOT_FOUND: "No existe una cuenta con ese nombre de usuario.",
      USER_DISABLED: "Esta cuenta está desactivada.",
      EMAIL_EXISTS: "Ese nombre de usuario ya está registrado.",
      OPERATION_NOT_ALLOWED: "El acceso con contraseña no está activado en Firebase.",
      TOO_MANY_ATTEMPTS_TRY_LATER: "Hay demasiados intentos. Espera un momento y vuelve a intentarlo.",
      PROFILE_SAVE_FAILED: "No se pudo guardar el perfil en Firebase."
    };
    const normalizedCode = String(code || "").split(/\s*:/, 1)[0];
    return messages[normalizedCode] || "No se ha podido completar la solicitud. Inténtalo de nuevo.";
  }

  async function requestFirebaseAuth(action, payload) {
    if (!firebaseApiKey) throw new Error("FIREBASE_API_KEY_MISSING");
    const response = await fetch(firebaseAuthUrl + ":" + action + "?key=" + encodeURIComponent(firebaseApiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({}, payload, { returnSecureToken: true }))
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result && result.error && result.error.message || "AUTH_REQUEST_FAILED");
    return result;
  }

  async function saveUserProfile(username, membership, idToken) {
    const response = await fetch(firebaseBaseUrl + "/users/" + encodeURIComponent(username) + ".json?auth=" + encodeURIComponent(idToken), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: username, membership: membership })
    });
    if (!response.ok) throw new Error("PROFILE_SAVE_FAILED");
  }

  function validateUsername(username) {
    return username.length > 0 && !/[.#$\[\]\/\s@]/.test(username);
  }

  function rememberAuthSession(username, authResult) {
    if (!authResult || !authResult.refreshToken) return false;
    try {
      localStorage.setItem(authSessionKey, JSON.stringify({ username: username, refreshToken: authResult.refreshToken }));
      return true;
    } catch {
      return false;
    }
  }

  function forgetAuthSession() {
    try { localStorage.removeItem(authSessionKey); } catch {}
  }

  async function refreshFirebaseSession(refreshToken) {
    let response;
    try {
      response = await fetch(firebaseTokenUrl + "?key=" + encodeURIComponent(firebaseApiKey), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
      });
    } catch {
      throw new Error("SESSION_NETWORK_ERROR");
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result && result.error && result.error.message || "SESSION_REFRESH_FAILED");
    return result;
  }

  async function restoreRememberedSession() {
    let rememberedSession = null;
    try { rememberedSession = JSON.parse(localStorage.getItem(authSessionKey) || "null"); }
    catch { forgetAuthSession(); }
    if (!rememberedSession || !rememberedSession.refreshToken) {
      usernameInput.focus({ preventScroll: true });
      return;
    }
    usernameInput.value = String(rememberedSession.username || "").toLowerCase();
    usernameCard.classList.add("is-restoring");
    usernameStatus.textContent = "Comprobando sesión…";
    try {
      const refreshedSession = await refreshFirebaseSession(rememberedSession.refreshToken);
      currentUsername = String(rememberedSession.username || "").toLowerCase();
      currentIdToken = refreshedSession.id_token || "";
      try {
        localStorage.setItem(authSessionKey, JSON.stringify({
          username: rememberedSession.username || "",
          refreshToken: refreshedSession.refresh_token || rememberedSession.refreshToken
        }));
      } catch {}
      usernameCard.classList.remove("is-restoring");
      await showAuthenticatedHome(currentIdToken);
    } catch (error) {
      usernameCard.classList.remove("is-restoring");
      if (error.message !== "SESSION_NETWORK_ERROR") {
        forgetAuthSession();
        usernameStatus.textContent = "Tu sesión ha caducado. Inicia sesión de nuevo.";
      } else {
        usernameStatus.textContent = "No se ha podido comprobar la sesión. Inicia sesión para continuar.";
      }
      usernameInput.focus({ preventScroll: true });
    }
  }

  async function continueAuth() {
    if (requestPending) return;
    if (promptStage === "username") {
      const username = usernameInput.value.trim().toLowerCase();
      usernameInput.value = username;
      if (!username) {
        usernameStatus.textContent = "Escribe tu nombre de usuario para continuar.";
        usernameInput.focus();
        return;
      }
      if (!validateUsername(username)) {
        usernameStatus.textContent = "El nombre no puede contener espacios, @, puntos ni # $ [ ] /.";
        usernameInput.focus();
        return;
      }
      requestPending = true;
      usernameCard.classList.add("is-loading");
      continueButton.disabled = true;
      continueButton.textContent = "Comprobando…";
      usernameStatus.textContent = "Comprobando…";
      try {
        const name = await requestUsernameName(username);
        usernameInput.value = username;
        if (typeof name === "string" && name.trim()) showLogin(name.trim());
        else if (username === "adri") {
          showLogin("Adri");
          usernameStatus.textContent = "Inicia sesión con la cuenta de administración.";
        }
        else showRegistration();
      } catch {
        usernameStatus.textContent = "No se ha podido comprobar el nombre de usuario. Inténtalo de nuevo.";
      } finally {
        requestPending = false;
        usernameCard.classList.remove("is-loading");
        continueButton.disabled = false;
        setContinueText();
      }
      return;
    }

    const username = usernameInput.value.trim().toLowerCase();
    usernameInput.value = username;
    const email = username + "@laligabrains.com";
    if (promptStage === "login") {
      if (!passwordInput.value) {
        usernameStatus.textContent = "Introduce tu contraseña para iniciar sesión.";
        passwordInput.focus();
        return;
      }
      requestPending = true;
      usernameCard.classList.add("is-loading");
      continueButton.disabled = true;
      continueButton.textContent = "Iniciando sesión…";
      usernameStatus.textContent = "Iniciando sesión…";
      try {
        const account = await requestFirebaseAuth("signInWithPassword", { email: email, password: passwordInput.value });
        currentUsername = username;
        currentIdToken = account.idToken || "";
        const sessionSaved = rememberAuthSession(username, account);
        passwordInput.value = "";
        await showAuthenticatedHome(currentIdToken);
        if (!sessionSaved) showNotice("Has iniciado sesión, pero no se pudo guardar la sesión en este navegador.");
      } catch (error) {
        usernameStatus.textContent = firebaseErrorMessage(error.message);
      } finally {
        requestPending = false;
        usernameCard.classList.remove("is-loading");
        continueButton.disabled = false;
        setContinueText();
      }
      return;
    }

    if (promptStage === "registration") {
      if (passwordInput.value !== passwordRepeatInput.value) {
        usernameStatus.textContent = "Las contraseñas no coinciden.";
        passwordRepeatInput.focus();
        return;
      }
      if (!membershipSelect.value) {
        usernameStatus.textContent = "Selecciona un perfil para continuar.";
        membershipSelect.focus();
        return;
      }
      if (passwordInput.value.length < 6) {
        usernameStatus.textContent = "La contraseña debe tener al menos 6 caracteres.";
        passwordInput.focus();
        return;
      }
      const membership = membershipSelect.value;
      const password = passwordInput.value;
      requestPending = true;
      usernameCard.classList.add("is-loading");
      continueButton.disabled = true;
      continueButton.textContent = "Creando cuenta…";
      usernameStatus.textContent = "Creando cuenta…";
      try {
        const account = await requestFirebaseAuth("signUp", { email: email, password: password });
        currentUsername = username;
        currentIdToken = account.idToken || "";
        let profileSaved = true;
        try { await saveUserProfile(username, membership, account.idToken); }
        catch { profileSaved = false; }
        const sessionSaved = rememberAuthSession(username, account);
        await showAuthenticatedHome(currentIdToken);
        if (!profileSaved) showNotice("La cuenta se creó y ya puedes usar el móvil, pero no se pudo guardar el perfil.");
        else if (!sessionSaved) showNotice("La cuenta se creó, pero no se pudo guardar la sesión en este navegador.");
      } catch (error) {
        if (error.message === "EMAIL_EXISTS") {
          passwordInput.value = "";
          showLogin(username);
          usernameStatus.textContent = "Esta cuenta ya existe. Introduce tu contraseña para iniciar sesión.";
        } else {
          usernameStatus.textContent = firebaseErrorMessage(error.message);
        }
      } finally {
        requestPending = false;
        usernameCard.classList.remove("is-loading");
        continueButton.disabled = false;
        setContinueText();
      }
    }
  }

  usernameInput.addEventListener("input", () => {
    const start = usernameInput.selectionStart;
    const end = usernameInput.selectionEnd;
    const normalized = usernameInput.value.toLowerCase();
    if (normalized === usernameInput.value) return;
    usernameInput.value = normalized;
    usernameInput.setSelectionRange(start, end);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void continueAuth();
  });

  backButton.addEventListener("click", () => returnToUsername(false));
  createAccountLink.addEventListener("click", (event) => {
    event.preventDefault();
    returnToUsername(true);
  });

  document.addEventListener("keydown", (event) => {
    if (prompt.hidden || event.key !== "Tab") return;
    const controls = [...prompt.querySelectorAll("input:not([hidden]), select:not([hidden]), button:not([hidden]), a:not([hidden])")]
      .filter((element) => !element.disabled && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!prompt.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  });

  shape.inert = false;
  usernameInput.focus({ preventScroll: true });
  void restoreRememberedSession();
})();
