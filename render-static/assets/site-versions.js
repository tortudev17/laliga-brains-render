(() => {
  const META_PATH = "kingdom/webVersions/versions";
  const ARCHIVE_PATH = "kingdom/webVersions/archives";
  const IMAGE_PATH = "kingdom/webVersions/imageAssets";
  const CURRENT_PATH = "kingdom/webVersions/currentId";
  const ZIP_LIMIT = 5 * 1024 * 1024;
  const EXPANDED_LIMIT = 12 * 1024 * 1024;
  const IMAGE_RECORD_LIMIT = 700 * 1024;
  const FILE_LIMIT = 50;
  const IMAGE_EXTENSIONS = /\.(?:avif|gif|heic|jpe?g|png|svg|webp)$/i;
  const UNSUPPORTED_IMAGE_EXTENSIONS = /\.(?:bmp|dng|heif|ico|j2k|jp2|jpf|jpx|jxl|psd|raw|tif|tiff|svgz)$/i;
  const VIDEO_EXTENSIONS = /\.(?:3gp|avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|mts|m2ts|ogv|webm|wmv)$/i;
  const TEXT_EXTENSIONS = /\.(?:html?|css|js|mjs|json|txt|md|xml|webmanifest)$/i;
  const apiKey = document.querySelector('meta[name="firebase-api-key"]')?.content?.trim() || "";

  function firebasePath(baseUrl, token, path) {
    if (!token) throw new Error("Inicia sesión para continuar.");
    const root = String(baseUrl || "").replace(/\/+$/, "");
    return `${root}/${path.split("/").map(encodeURIComponent).join("/")}.json?auth=${encodeURIComponent(token)}`;
  }

  async function database(baseUrl, token, path, method = "GET", value) {
    const response = await fetch(firebasePath(baseUrl, token, path), {
      method,
      headers: value === undefined ? {} : { "Content-Type": "application/json" },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      cache: "no-store"
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof body === "string" ? body : body?.error || `Firebase devolvió el error ${response.status}.`);
    return body;
  }

  function encodeBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x7ffe;
    const parts = [];
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))));
    }
    return parts.join("");
  }

  function decodeBase64(value) {
    if (typeof value !== "string") throw new Error("No se encontró el archivo de esta versión en Firebase Realtime Database.");
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  function pathSegment(value) {
    const id = String(value || "").trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("El identificador de versión no es válido.");
    return id;
  }

  function cleanArchivePath(value) {
    const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
    const pieces = normalized.split("/").filter((part) => part && part !== ".");
    if (!pieces.length || pieces.some((part) => part === ".." || part.includes("\0"))) return "";
    return pieces.join("/");
  }

  function imageMimeType(filename, content) {
    const bytes = new Uint8Array(content, 0, Math.min(content.byteLength, 24));
    const starts = (...values) => values.every((value, index) => bytes[index] === value);
    if (starts(0x42, 0x4d)) return "image/bmp";
    if (starts(0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
    if (starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a)) return "image/tiff";
    if (starts(0x38, 0x42, 0x50, 0x53)) return "image/vnd.adobe.photoshop";
    if (UNSUPPORTED_IMAGE_EXTENSIONS.test(filename)) return "image/unsupported";
    if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
    if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
    if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
    if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
    if (String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
      const brand = String.fromCharCode(...bytes.slice(8, 12));
      if (/^(?:avif|avis)$/.test(brand)) return "image/avif";
      if (/^(?:heic|heif|heix|mif1|msf1)$/.test(brand)) return "image/heic";
    }
    const sample = new TextDecoder().decode(new Uint8Array(content, 0, Math.min(content.byteLength, 4096))).trimStart();
    if (IMAGE_EXTENSIONS.test(filename) || /^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(sample)) {
      const ext = filename.split(".").pop().toLowerCase();
      return ({ svg: "image/svg+xml", avif: "image/avif", heic: "image/heic", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" })[ext] || "image/octet-stream";
    }
    return "";
  }

  function looksLikeVideo(filename, content) {
    if (VIDEO_EXTENSIONS.test(filename)) return true;
    const bytes = new Uint8Array(content, 0, Math.min(content.byteLength, 16));
    const signature = String.fromCharCode(...bytes);
    return (signature.startsWith("RIFF") && /AVI /.test(signature))
      || (signature.slice(4, 8) === "ftyp" && /^(?:isom|iso2|mp4|M4V|qt  |3gp\d|MSNV)$/.test(signature.slice(8, 12)))
      || signature.startsWith("\u001aE\xdf\xa3");
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== "function") throw new Error("Este navegador no puede abrir ZIP comprimidos. Prueba con Safari o Chrome actualizado.");
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(stream).arrayBuffer();
    } catch {
      throw new Error("No se pudo leer el ZIP. Comprueba que sea un archivo ZIP válido.");
    }
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream !== "function") throw new Error("Este navegador no puede volver a comprimir el ZIP después de optimizar las imágenes. Actualiza Safari o Chrome.");
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      throw new Error("No se pudo preparar el ZIP actualizado para Firebase.");
    }
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  async function buildArchive(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    let centralSize = 0;
    let expandedSize = 0;
    for (const [filename, content] of files) {
      const name = encoder.encode(filename);
      const bytes = new Uint8Array(content);
      const compressed = await deflateRaw(bytes);
      const checksum = crc32(bytes);
      if (name.byteLength > 65535 || localOffset > 0xffffffff) throw new Error("El ZIP contiene una ruta demasiado larga.");
      expandedSize += bytes.byteLength;

      const localHeader = new Uint8Array(30 + name.byteLength);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 8, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, compressed.byteLength, true);
      localView.setUint32(22, bytes.byteLength, true);
      localView.setUint16(26, name.byteLength, true);
      localHeader.set(name, 30);
      localParts.push(localHeader, compressed);

      const centralHeader = new Uint8Array(46 + name.byteLength);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 8, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, compressed.byteLength, true);
      centralView.setUint32(24, bytes.byteLength, true);
      centralView.setUint16(28, name.byteLength, true);
      centralView.setUint32(42, localOffset, true);
      centralHeader.set(name, 46);
      centralParts.push(centralHeader);
      localOffset += localHeader.byteLength + compressed.byteLength;
      centralSize += centralHeader.byteLength;
    }
    if (!files.size || files.size > FILE_LIMIT) throw new Error("El ZIP final debe contener entre 1 y 50 archivos.");
    if (expandedSize > EXPANDED_LIMIT) throw new Error("El sitio supera el límite de 12 MB sin comprimir.");
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, files.size, true);
    endView.setUint16(10, files.size, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, localOffset, true);
    const archive = new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
    if (archive.size > ZIP_LIMIT) throw new Error("El ZIP final supera el límite de 5 MB después de separar las imágenes.");
    return { blob: archive, expandedSize, fileCount: files.size };
  }

  async function compressImageForRealtimeDatabase(filename, image) {
    if (image.content.byteLength <= IMAGE_RECORD_LIMIT) return image;
    if (image.type === "image/gif") {
      throw new Error(`El GIF ${filename} no cabe en un registro de Firebase menor de 1 MB. Optimiza el GIF para conservar su animación y vuelve a subirlo.`);
    }
    if (typeof createImageBitmap !== "function") throw new Error(`No se puede comprimir ${filename} en este navegador. Prueba con Safari o Chrome actualizado.`);
    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([image.content], { type: image.type }));
      if (!bitmap.width || !bitmap.height) throw new Error("La imagen no tiene dimensiones válidas.");
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("No se pudo preparar la compresión de la imagen.");
      let width = bitmap.width;
      let height = bitmap.height;
      const qualities = [0.88, 0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46, 0.4];
      for (let pass = 0; pass < 28; pass += 1) {
        canvas.width = width;
        canvas.height = height;
        context.clearRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);
        for (const quality of qualities) {
          const compressed = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
          if (compressed?.type === "image/webp" && compressed.size <= IMAGE_RECORD_LIMIT) {
            return { content: await compressed.arrayBuffer(), type: compressed.type };
          }
        }
        width = Math.max(1, Math.round(width * 0.82));
        height = Math.max(1, Math.round(height * 0.82));
      }
      throw new Error(`No se pudo comprimir ${filename} para que su registro de Firebase quede por debajo de 1 MB. Reduce sus dimensiones y vuelve a subirlo.`);
    } catch (error) {
      if (/No se pudo comprimir|no cabe en un registro|no tiene dimensiones|No se pudo preparar/.test(error?.message || "")) throw error;
      throw new Error(`No se pudo comprimir ${filename}. Convierte la imagen a JPEG, PNG o WebP y vuelve a subirla.`);
    } finally {
      bitmap?.close?.();
    }
  }

  async function readArchive(input) {
    const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
    if (buffer.byteLength > ZIP_LIMIT) throw new Error("El ZIP no puede superar 5 MB.");
    if (buffer.byteLength < 22) throw new Error("El archivo no parece un ZIP válido.");
    const view = new DataView(buffer);
    let endOffset = -1;
    const scanStart = Math.max(0, buffer.byteLength - 65557);
    for (let offset = buffer.byteLength - 22; offset >= scanStart; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) { endOffset = offset; break; }
    }
    if (endOffset < 0) throw new Error("El ZIP está incompleto o no tiene una tabla de archivos válida.");
    const count = view.getUint16(endOffset + 10, true);
    const centralSize = view.getUint32(endOffset + 12, true);
    const centralOffset = view.getUint32(endOffset + 16, true);
    if (count > FILE_LIMIT || centralOffset + centralSize > buffer.byteLength) throw new Error("El ZIP supera el límite de 50 archivos o está dañado.");

    const decoder = new TextDecoder();
    const files = new Map();
    const images = new Map();
    let offset = centralOffset;
    let totalSize = 0;
    for (let index = 0; index < count; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("La lista de archivos del ZIP está dañada.");
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const size = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const filename = cleanArchivePath(decoder.decode(new Uint8Array(buffer, offset + 46, nameLength)));
      offset += 46 + nameLength + extraLength + commentLength;
      if (!filename || filename.endsWith("/") || filename.startsWith("__MACOSX/") || filename === ".DS_Store") continue;
      if ((flags & 1) !== 0) throw new Error("El ZIP está protegido con contraseña; súbelo sin cifrar.");
      if (method !== 0 && method !== 8) throw new Error(`El ZIP usa un método de compresión no admitido (${filename}).`);
      if (size > EXPANDED_LIMIT || totalSize + size > EXPANDED_LIMIT) throw new Error("El contenido del sitio no puede superar 12 MB sin comprimir.");
      totalSize += size;

      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`No se pudo leer ${filename} dentro del ZIP.`);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = new Uint8Array(buffer, dataStart, compressedSize);
      let content;
      if (method === 0) content = compressed.slice().buffer;
      else content = await inflateRaw(compressed);
      if (content.byteLength !== size) throw new Error(`El tamaño de ${filename} no coincide con el contenido del ZIP.`);
      if (looksLikeVideo(filename, content)) throw new Error(`No se admiten vídeos (${filename}). Sube imágenes y código web en el ZIP.`);
      const imageType = imageMimeType(filename, content);
      if (imageType) {
        if (!/^image\/(?:avif|gif|heic|jpeg|png|svg\+xml|webp)$/.test(imageType)) {
          throw new Error(`No se admite el formato de imagen de ${filename}. Convierte la imagen a JPEG, PNG, GIF, WebP, SVG, AVIF o HEIC.`);
        }
        if (content.byteLength > EXPANDED_LIMIT) throw new Error(`La imagen ${filename} supera el límite de 12 MB antes de comprimirla.`);
        images.set(filename, { content, type: imageType });
      } else {
        files.set(filename, content);
      }
    }
    if (files.size === 0 || !files.has("index.html")) throw new Error("El ZIP debe incluir index.html en su carpeta raíz.");
    for (const [filename, content] of files) {
      if (TEXT_EXTENSIONS.test(filename)) {
        const source = new TextDecoder().decode(content);
        if (/data:image\//i.test(source)) throw new Error(`El archivo ${filename} incluye una imagen incrustada. Pon la imagen como archivo separado dentro del ZIP.`);
      }
    }
    return { files, images, totalSize, fileCount: files.size + images.size };
  }

  function mimeType(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    return ({
      html: "text/html;charset=utf-8", htm: "text/html;charset=utf-8", css: "text/css;charset=utf-8",
      js: "text/javascript;charset=utf-8", mjs: "text/javascript;charset=utf-8", json: "application/json;charset=utf-8",
      txt: "text/plain;charset=utf-8", xml: "application/xml;charset=utf-8", webmanifest: "application/manifest+json",
      apng: "image/apng", avif: "image/avif", bmp: "image/bmp", gif: "image/gif", heic: "image/heic", ico: "image/x-icon",
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", svg: "image/svg+xml", tif: "image/tiff", tiff: "image/tiff", webp: "image/webp",
      woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", mp3: "audio/mpeg", mp4: "video/mp4"
    })[ext] || "application/octet-stream";
  }

  function resolveFileReference(reference, currentFile, urls) {
    const value = String(reference || "").trim();
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return value;
    try {
      const base = new URL(`https://preview.invalid/${currentFile}`);
      const parsed = new URL(value, base);
      const key = decodeURIComponent(parsed.pathname.slice(1));
      const url = urls.get(key);
      if (!url) return value;
      return `${url}${parsed.search}${parsed.hash}`;
    } catch {
      return value;
    }
  }

  function createPreview(files, iframe) {
    const urls = new Map();
    const created = [];
    for (const [filename, content] of files) {
      const url = URL.createObjectURL(new Blob([content], { type: files.mimeTypes?.get(filename) || mimeType(filename) }));
      urls.set(filename, url);
      created.push(url);
    }
    for (const [filename, content] of files) {
      if (!/\.css$/i.test(filename)) continue;
      let css = new TextDecoder().decode(content);
      css = css.replace(/url\((\s*)(["']?)([^"')]+)\2(\s*)\)/gi, (match, before, quote, reference, after) =>
        `url(${before}${quote}${resolveFileReference(reference, filename, urls)}${quote}${after})`);
      css = css.replace(/@import\s+(["'])([^"']+)\1/gi, (match, quote, reference) => `@import ${quote}${resolveFileReference(reference, filename, urls)}${quote}`);
      const url = URL.createObjectURL(new Blob([css], { type: "text/css;charset=utf-8" }));
      urls.set(filename, url);
      created.push(url);
    }
    for (const [filename, content] of files) {
      if (!/\.html?$/i.test(filename)) continue;
      const parsed = new DOMParser().parseFromString(new TextDecoder().decode(content), "text/html");
      parsed.querySelectorAll("base").forEach((node) => node.remove());
      parsed.querySelectorAll("[src], [href], [poster]").forEach((node) => {
        for (const attr of ["src", "href", "poster"]) {
          const value = node.getAttribute(attr);
          if (value) node.setAttribute(attr, resolveFileReference(value, filename, urls));
        }
      });
      parsed.querySelectorAll("[srcset]").forEach((node) => {
        const value = node.getAttribute("srcset") || "";
        node.setAttribute("srcset", value.split(",").map((candidate) => {
          const parts = candidate.trim().split(/\s+/, 2);
          return `${resolveFileReference(parts[0], filename, urls)}${parts[1] ? ` ${parts[1]}` : ""}`;
        }).join(", "));
      });
      const rewritten = new Blob(["<!doctype html>\n", parsed.documentElement.outerHTML], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(rewritten);
      urls.set(filename, url);
      created.push(url);
    }
    iframe.src = urls.get("index.html");
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }

  async function uploadArchive(baseUrl, token, username, file, onProgress = () => {}) {
    if (!file || !/\.zip$/i.test(file.name)) throw new Error("Selecciona un archivo ZIP.");
    if (file.size > ZIP_LIMIT) throw new Error("El ZIP no puede superar 5 MB.");
    onProgress({ stage: "check", percent: 3, detail: "Revisando el ZIP…" });
    const parsed = await readArchive(file);
    const id = `web-${Date.now()}-${(crypto.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 8)}`;
    const filename = file.name.slice(0, 120);
    const archivePath = `${ARCHIVE_PATH}/${id}`;
    const imageRoot = `${IMAGE_PATH}/${id}`;
    let archiveSaved = false;
    try {
      const sourceImages = [...parsed.images.entries()];
      const images = [];
      for (let index = 0; index < sourceImages.length; index += 1) {
        const [path, sourceImage] = sourceImages[index];
        onProgress({ stage: "compress", percent: 5 + (index / Math.max(sourceImages.length, 1)) * 22, detail: `Optimizando imagen ${index + 1} de ${sourceImages.length} para que su registro no supere 1 MB…` });
        const image = await compressImageForRealtimeDatabase(path, sourceImage);
        const imageId = `image-${String(index + 1).padStart(2, "0")}`;
        images.push({ id: imageId, path, filename: path.split("/").pop(), type: image.type, size: image.content.byteLength, content: image.content });
      }

      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        onProgress({ stage: "images", percent: 28 + ((index + 0.2) / images.length) * 48, detail: `Guardando imagen ${index + 1} de ${images.length} en Firebase Realtime Database…` });
        const record = {
          path: image.path,
          contentType: image.type,
          size: image.size,
          data: encodeBase64(image.content)
        };
        if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 1024 * 1024) throw new Error(`Los datos codificados de ${image.filename} superan 1 MB. Reduce la imagen y vuelve a subirla.`);
        await database(baseUrl, token, `${imageRoot}/${image.id}`, "PUT", record);
        onProgress({ stage: "images", percent: 28 + ((index + 1) / images.length) * 48, detail: `Imagen ${index + 1} de ${images.length} guardada en Firebase Realtime Database.` });
      }

      onProgress({ stage: "archive", percent: 78, detail: "Preparando el ZIP de código sin los archivos de imagen…" });
      const zipped = await buildArchive(parsed.files);
      onProgress({ stage: "firebase", percent: 84, detail: "Guardando el ZIP de código en Firebase Realtime Database…" });
      await database(baseUrl, token, archivePath, "PUT", encodeBase64(await zipped.blob.arrayBuffer()));
      archiveSaved = true;
      const version = {
        id,
        filename,
        archivePath,
        archiveEncoding: "base64",
        size: zipped.blob.size,
        expandedSize: parsed.totalSize,
        fileCount: zipped.fileCount,
        images: images.map(({ id: imageId, path, filename: imageFilename, type, size }) => ({ id: imageId, path, filename: imageFilename, type, size })),
        uploadedBy: String(username || "adri").slice(0, 80),
        createdAt: Date.now()
      };
      await database(baseUrl, token, `${META_PATH}/${id}`, "PUT", version);
      onProgress({ stage: "done", percent: 100, detail: "Versión y archivos guardados en Firebase Realtime Database. Aún no es la versión actual." });
      return version;
    } catch (error) {
      await database(baseUrl, token, `${META_PATH}/${id}`, "PUT", null).catch(() => {});
      if (archiveSaved) await database(baseUrl, token, archivePath, "PUT", null).catch(() => {});
      await database(baseUrl, token, imageRoot, "PUT", null).catch(() => {});
      throw error;
    }
  }

  async function listVersions(baseUrl, token) {
    const [collection, currentId] = await Promise.all([
      database(baseUrl, token, META_PATH),
      database(baseUrl, token, CURRENT_PATH)
    ]);
    const versions = Object.entries(collection && typeof collection === "object" ? collection : {})
      .filter(([, value]) => value && typeof value === "object" && value.id && value.archivePath)
      .map(([id, value]) => ({ ...value, id: value.id || id }))
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
    return { versions, currentId: typeof currentId === "string" ? currentId : currentId?.id || "" };
  }

  async function getVersion(baseUrl, token, id) {
    return database(baseUrl, token, `${META_PATH}/${pathSegment(id)}`);
  }

  async function getCurrentVersion(baseUrl, token) {
    const id = await database(baseUrl, token, CURRENT_PATH);
    if (!id) return null;
    const versionId = typeof id === "string" ? id : id?.id;
    if (!versionId) return null;
    const version = await getVersion(baseUrl, token, versionId);
    return version?.archivePath ? version : null;
  }

  async function setCurrent(baseUrl, token, id) {
    const versionId = id ? pathSegment(id) : "";
    if (versionId) {
      const version = await getVersion(baseUrl, token, versionId);
      if (!version?.archivePath) throw new Error("No se encontró esa versión en Firebase Realtime Database.");
    }
    await database(baseUrl, token, CURRENT_PATH, "PUT", versionId || null);
  }

  async function deleteVersion(baseUrl, token, id) {
    const versionId = pathSegment(id);
    const version = await getVersion(baseUrl, token, versionId);
    if (!version) return;
    const currentId = await database(baseUrl, token, CURRENT_PATH);
    if ((typeof currentId === "string" ? currentId : currentId?.id) === versionId) throw new Error("No puedes borrar la versión actual. Publica otra o retírala primero.");
    await database(baseUrl, token, `${IMAGE_PATH}/${versionId}`, "PUT", null);
    await database(baseUrl, token, version.archivePath || `${ARCHIVE_PATH}/${versionId}`, "PUT", null);
    await database(baseUrl, token, `${META_PATH}/${versionId}`, "PUT", null);
  }

  async function downloadArchive(baseUrl, token, version) {
    const archivePath = version.archivePath || `${ARCHIVE_PATH}/${pathSegment(version.id)}`;
    const archive = await database(baseUrl, token, archivePath);
    return decodeBase64(archive);
  }

  async function readVersion(baseUrl, version, token) {
    const buffer = await downloadArchive(baseUrl, token, version);
    const parsed = await readArchive(buffer);
    const mimeTypes = new Map();
    for (const [path, image] of parsed.images) {
      parsed.files.set(path, image.content);
      mimeTypes.set(path, image.type);
    }
    const versionId = pathSegment(version.id);
    const assets = Array.isArray(version.images) ? version.images : [];
    const records = await Promise.all(assets.map(async (asset) => {
      const imageId = pathSegment(asset?.id);
      const record = await database(baseUrl, token, `${IMAGE_PATH}/${versionId}/${imageId}`);
      if (!record || typeof record.data !== "string") throw new Error(`No se encontró la imagen ${asset.filename || asset.path || imageId} en Firebase Realtime Database.`);
      const imagePath = cleanArchivePath(record.path || asset.path);
      if (!imagePath || imagePath !== asset.path) throw new Error(`La ruta de la imagen ${asset.filename || imageId} no es válida.`);
      const imageBuffer = decodeBase64(record.data);
      if (imageBuffer.byteLength > IMAGE_RECORD_LIMIT) throw new Error(`La imagen ${asset.filename || imagePath} supera el límite de 1 MB guardado.`);
      if (record.size !== undefined && Number(record.size) !== imageBuffer.byteLength) throw new Error(`El tamaño de la imagen ${asset.filename || imagePath} no coincide con los datos guardados.`);
      return { path: imagePath, content: imageBuffer, type: String(record.contentType || asset.type || mimeType(imagePath)) };
    }));
    for (const image of records) {
      parsed.files.set(image.path, image.content);
      mimeTypes.set(image.path, image.type);
    }
    parsed.files.mimeTypes = mimeTypes;
    return parsed.files;
  }

  window.SiteVersions = Object.freeze({
    readArchive,
    buildArchive,
    createPreview,
    uploadArchive,
    listVersions,
    getVersion,
    getCurrentVersion,
    setCurrent,
    deleteVersion,
    readVersion,
    zipLimit: ZIP_LIMIT
  });
})();
