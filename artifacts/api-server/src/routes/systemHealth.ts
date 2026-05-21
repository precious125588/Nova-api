import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import * as cache from "../lib/cache.js";
import os from "os";

const router = Router();
const SERVER_START = Date.now();
const VERSION = process.env.npm_package_version || "1.0.0";

router.get("/health", async (_req, res) => {
  const dbOk = await db.execute(sql`SELECT 1`).then(() => true).catch(() => false);
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "healthy" : "degraded",
    database: dbOk ? "connected" : "disconnected",
    uptime: Math.round((Date.now() - SERVER_START) / 1000) + "s",
    timestamp: new Date().toISOString(),
  });
});

router.get("/status", async (_req, res) => {
  const dbOk = await db.execute(sql`SELECT 1`).then(() => true).catch(() => false);
  const mem = process.memoryUsage();
  res.json({
    status: "operational",
    version: VERSION,
    environment: process.env.NODE_ENV || "development",
    database: dbOk ? "connected" : "disconnected",
    cache: { entries: cache.size() },
    memory: {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + "MB",
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + "MB",
    },
    os: { platform: os.platform(), cpus: os.cpus().length },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

router.get("/ping", (_req, res) => {
  res.json({ pong: true, timestamp: Date.now() });
});

router.get("/version", (_req, res) => {
  res.json({
    version: VERSION,
    api: "ZeroAPI",
    node: process.version,
    environment: process.env.NODE_ENV || "development",
    endpoints: {
      auth: ["/auth/register", "/auth/login", "/auth/logout", "/auth/verify", "/auth/me"],
      apiKey: ["/api/key/generate", "/api/key/validate", "/api/key/revoke", "/api/key/info"],
      limits: ["/api/limit/check", "/api/limit/status"],
      admin: ["/admin/login", "/admin/users", "/admin/stats", "/admin/system/status"],
      download: ["/api/download", "/api/download/info", "/api/download/stream", "/api/download/formats"],
      social: ["/api/tiktok", "/api/youtube/video", "/api/youtube/audio", "/api/instagram", "/api/twitter", "/api/soundcloud"],
      adult: ["/api/adult/xvideos", "/api/adult/pornhub", "/api/adult/redtube", "/api/adult/xhamster", "/api/adult/youporn", "/api/adult/spankbang", "/api/adult/scrape"],
      ai: ["/api/ai/chat", "/api/ai/generate", "/api/ai/summarize", "/api/ai/translate", "/api/ai/code", "/api/ai/image-describe"],
      tools: ["/api/tools/qr", "/api/tools/url-short", "/api/tools/password", "/api/tools/base64", "/api/tools/hash", "/api/tools/ip-lookup", "/api/tools/whois"],
      files: ["/api/file/upload", "/api/file/download/:id", "/api/file/delete/:id", "/api/file/list"],
      booster: ["/api/freefire/likes", "/api/freefire/views", "/api/freefire/followers", "/api/freefire/comments", "/api/freefire/info", "/api/freefire/order/:id", "/api/freefire/orders", "/api/freefire/services"],
      analytics: ["/api/analytics/requests", "/api/analytics/usage", "/api/analytics/endpoints"],
      health: ["/health", "/status", "/ping", "/version"],
      premium: ["/api/plan/free", "/api/plan/pro", "/api/plan/vip"],
    },
  });
});

router.get("/logs", (_req, res) => {
  res.json({
    message: "Live logs available via server stdout",
    hint: "Use Railway/Render dashboard to view streaming logs",
    logLevel: process.env.LOG_LEVEL || "info",
    cacheKeys: cache.keys().slice(0, 20),
    uptime: process.uptime(),
  });
});

export default router;
