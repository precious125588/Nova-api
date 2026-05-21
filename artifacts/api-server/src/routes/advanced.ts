import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { analyticsEvents, ipBlocks } from "@workspace/db";
import { eq, desc, gte } from "drizzle-orm";
import { requireAdmin } from "../middlewares/adminMiddleware.js";
import { optionalAuth } from "../middlewares/authMiddleware.js";
import * as cache from "../lib/cache.js";

const router = Router();

// ── Rate limit check ──────────────────────────────────────────────────────────
router.get("/rate-limit/check", optionalAuth, async (req, res) => {
  const ip = (req.ip || "").replace("::ffff:", "");
  const key = `ratelimit:${ip}`;
  const current = cache.get<number>(key) || 0;
  const limit = req.user?.role === "admin" ? Infinity : req.user?.role === "vip" ? 1000 : req.user?.role === "pro" ? 500 : 100;
  res.json({
    ip,
    requestsThisMinute: current,
    limit: limit === Infinity ? "unlimited" : limit,
    remaining: limit === Infinity ? "unlimited" : Math.max(0, limit - current),
    resetIn: "~60s",
    role: req.user?.role || "anonymous",
  });
});

router.post("/rate-limit/set", requireAdmin, async (req, res) => {
  const schema = z.object({ ip: z.string().optional(), userId: z.number().optional(), limit: z.number().int().min(0) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "limit required" }); return; }
  const { ip, userId, limit } = parsed.data;
  const key = `ratelimit_custom:${ip || userId}`;
  cache.set(key, limit, 86400);
  res.json({ success: true, message: `Rate limit set to ${limit}/min for ${ip || "userId:" + userId}` });
});

// ── IP block/unblock ──────────────────────────────────────────────────────────
router.post("/ip/block", requireAdmin, async (req, res) => {
  const schema = z.object({ ip: z.string().min(7), reason: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "ip required" }); return; }
  const { ip, reason } = parsed.data;

  await db.insert(ipBlocks).values({ ip, reason: reason || "Blocked by admin", blockedBy: "admin" })
    .onConflictDoUpdate({ target: ipBlocks.ip, set: { reason: reason || "Blocked by admin" } });

  cache.del(`ip_blocked:${ip}`);
  res.json({ success: true, message: `IP ${ip} blocked` });
});

router.post("/ip/unblock", requireAdmin, async (req, res) => {
  const { ip } = req.body;
  if (!ip) { res.status(400).json({ error: "ip required" }); return; }
  await db.delete(ipBlocks).where(eq(ipBlocks.ip, ip));
  cache.del(`ip_blocked:${ip}`);
  res.json({ success: true, message: `IP ${ip} unblocked` });
});

router.get("/ip/list", requireAdmin, async (_req, res) => {
  const blocked = await db.query.ipBlocks.findMany({ orderBy: [desc(ipBlocks.blockedAt)] }).catch(() => []);
  res.json({ total: blocked.length, blocked });
});

// ── Cache control ─────────────────────────────────────────────────────────────
router.post("/cache/clear", requireAdmin, (_req, res) => {
  const before = cache.size();
  cache.clear();
  res.json({ success: true, message: `Cache cleared`, entriesCleared: before });
});

router.get("/cache/stats", requireAdmin, (_req, res) => {
  res.json({ size: cache.size(), keys: cache.keys() });
});

// ── Request logs ──────────────────────────────────────────────────────────────
router.get("/request/logs", requireAdmin, async (req, res) => {
  const limit = Math.min(200, parseInt(String(req.query.limit ?? "50")));
  const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 3600000);

  const logs = await db.query.analyticsEvents.findMany({
    where: gte(analyticsEvents.createdAt, since),
    orderBy: [desc(analyticsEvents.createdAt)],
    limit,
  }).catch(() => []);

  res.json({
    count: logs.length,
    since: since.toISOString(),
    logs: logs.map((l) => ({
      id: l.id,
      endpoint: l.endpoint,
      method: l.method,
      status: l.statusCode,
      ip: l.ip,
      userId: l.userId,
      responseMs: l.responseTime,
      at: l.createdAt,
    })),
  });
});

export default router;
