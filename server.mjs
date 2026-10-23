import express from "express";
import Redis from "ioredis";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { onRequest } from "./functions/api/[[path]].ts";

const app = express();
const port = Number(process.env.PORT ?? 10000);
const distDirectory = resolve("dist");
const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("REDIS_URL is required. Connect this service to the Render Key Value instance.");
}

const redis = new Redis(redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
});
redis.on("error", () => console.warn("Render Key Value connection error."));

const env = {
  FIREBASE_API_KEY: process.env.FIREBASE_API_KEY ?? "",
  FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL ?? "",
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? "",
  PIERO_EMAIL: process.env.PIERO_EMAIL ?? "",
  PIERO_PIN_SHA512: process.env.PIERO_PIN_SHA512 ?? "",
  PIERO_TOKEN_ENCRYPTION_KEY: process.env.PIERO_TOKEN_ENCRYPTION_KEY ?? "",
  CRON_SECRET: process.env.CRON_SECRET,
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
  PIERO_KV: {
    async get(key) {
      return redis.get(key);
    },
    async put(key, value, options = {}) {
      const ttl = Number(options.expirationTtl);
      if (Number.isFinite(ttl) && ttl > 0) await redis.set(key, value, "EX", Math.ceil(ttl));
      else await redis.set(key, value);
    },
    async delete(key) {
      await redis.del(key);
    },
  },
};

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.get("/healthz", async (_request, response) => {
  try {
    await redis.ping();
    response.status(200).json({ ok: true });
  } catch {
    response.status(503).json({ ok: false });
  }
});

app.use(["/identitytoolkit.googleapis.com", "/securetoken.googleapis.com"], express.raw({ type: "*/*", limit: "1mb" }));
app.use(async (request, response, next) => {
  const match = request.path.match(/^\/(identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com)\/v1\/(.+)$/);
  if (!match) return next();
  const host = match[1];
  const endpoint = match[2];
  const allowed = host === "identitytoolkit.googleapis.com" ? /^accounts:[A-Za-z]+$/.test(endpoint) : endpoint === "token";
  if (!allowed || request.method !== "POST") return response.status(404).json({ error: "No se encontró el recurso." });

  try {
    const target = new URL(`https://${host}/v1/${endpoint}${new URL(request.originalUrl, "http://render.internal").search}`);
    const headers = new Headers({ "Content-Type": request.get("content-type") ?? "application/json" });
    const locale = request.get("x-firebase-locale");
    if (locale) headers.set("X-Firebase-Locale", locale);
    const body = Buffer.isBuffer(request.body) ? request.body : undefined;
    const upstream = await fetch(target, { method: "POST", headers, ...(body ? { body } : {}) });
    response.status(upstream.status);
    response.setHeader("Content-Type", upstream.headers.get("Content-Type") ?? "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    const origin = request.get("origin");
    if (origin && origin === `${request.protocol}://${request.get("host")}`) response.setHeader("Access-Control-Allow-Origin", origin);
    response.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error("Firebase Authentication proxy failed:", error instanceof Error ? error.message : "unknown error");
    response.status(502).json({ error: { message: "Firebase Authentication no está disponible." } });
  }
});

app.use("/api", express.raw({ type: "*/*", limit: "6mb" }));
app.use("/api", async (request, response) => {
  try {
    const origin = `${request.protocol}://${request.get("host")}`;
    const url = new URL(request.originalUrl, origin);
    const headers = new Headers();
    const hopByHopHeaders = new Set([
      "connection", "content-length", "host", "keep-alive", "proxy-authenticate",
      "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
    ]);

    for (const [name, value] of Object.entries(request.headers)) {
      if (!hopByHopHeaders.has(name.toLowerCase()) && value !== undefined) {
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
    }
    if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", request.ip || "unknown");

    const body = Buffer.isBuffer(request.body) ? request.body : undefined;
    const webRequest = new Request(url, {
      method: request.method,
      headers,
      ...(body && request.method !== "GET" && request.method !== "HEAD" ? { body } : {}),
    });
    const path = url.pathname.replace(/^\/api\/?/, "");
    const result = await onRequest({ request: webRequest, env, params: { path } });

    response.status(result.status);
    result.headers.forEach((value, name) => response.setHeader(name, value));
    response.send(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    console.error("API request failed:", error instanceof Error ? error.message : "unknown error");
    response.status(500).json({ error: "No se pudo completar la operación. Inténtalo de nuevo más tarde." });
  }
});

app.use(express.static(distDirectory, {
  index: false,
  maxAge: "1y",
  immutable: true,
  setHeaders(response, filePath) {
    if (filePath.endsWith("index.html")) response.setHeader("Cache-Control", "no-cache");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  },
}));

app.use(async (request, response, next) => {
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  if (extname(request.path)) return next();
  try {
    const indexHtml = await readFile(resolve(distDirectory, "index.html"));
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.type("html").send(indexHtml);
  } catch {
    next();
  }
});

if (env.CRON_SECRET) {
  let schedulerRunning = false;
  const runScheduler = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const request = new Request("https://render.internal/api/school-scheduler", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.CRON_SECRET}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await onRequest({ request, env, params: { path: "school-scheduler" } });
      if (!result.ok) console.warn(`Scheduled school maintenance returned HTTP ${result.status}.`);
    } catch {
      console.warn("Scheduled school maintenance did not complete.");
    } finally {
      schedulerRunning = false;
    }
  };
  setTimeout(runScheduler, 15_000).unref();
  setInterval(runScheduler, 60 * 60 * 1000).unref();
}

app.listen(port, "0.0.0.0", () => {
  console.log(`LaLiga Brains Render service listening on port ${port}.`);
});
