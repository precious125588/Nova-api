import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { users, apiKeys, analyticsEvents, userLimits, endpointConfig, ipBlocks } from "@workspace/db";
import { eq, desc, count, sql } from "drizzle-orm";
import { signAdminToken } from "../lib/jwt.js";
import { requireAdmin } from "../middlewares/adminMiddleware.js";
import * as cache from "../lib/cache.js";
import os from "os";

const router = Router();
let emergencyShutdownFlag = false;

router.post("/login", (req, res) => {
  const { secret } = req.body;
  const ADMIN_SECRET = process.env.ADMIN_SECRET;
  if (!ADMIN_SECRET) { res.status(500).json({ error: "Admin secret not configured" }); return; }
  if (!secret || secret !== ADMIN_SECRET) { res.status(401).json({ error: "Invalid admin secret" }); return; }

  const token = signAdminToken({ id: 0, role: "admin" });
  res.json({
    success: true,
    token,
    usage: "Pass as Authorization: Bearer <token>",
    expiresIn: "8h",
  });
});

router.get("/users", requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const limit = Math.min(100, parseInt(String(req.query.limit ?? "50")));
  const offset = (page - 1) * limit;

  const allUsers = await db.query.users.findMany({
    orderBy: [desc(users.createdAt)],
    limit,
    offset,
  }).catch(() => []);

  const [{ total }] = await db.select({ total: count() }).from(users);

  res.json({
    users: allUsers.map((u) => ({
      id: u.id, username: u.username, email: u.email,
      role: u.role, isBlocked: u.isBlocked, emailVerified: u.emailVerified,
      createdAt: u.createdAt,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

router.post("/user/block", requireAdmin, async (req, res) => {
  const { userId, reason } = req.body;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  await db.update(users).set({ isBlocked: true }).where(eq(users.id, userId));
  res.json({ success: true, message: `User ${userId} blocked`, reason });
});

router.post("/user/unblock", requireAdmin, async (req, res) => {
  const { userId } = req.body;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  await db.update(users).set({ isBlocked: false }).where(eq(users.id, userId));
  res.json({ success: true, message: `User ${userId} unblocked` });
});

router.post("/user/upgrade", requireAdmin, async (req, res) => {
  const schema = z.object({ userId: z.number(), plan: z.enum(["free", "pro", "vip", "admin"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "userId and plan required" }); return; }
  await db.update(users).set({ role: parsed.data.plan }).where(eq(users.id, parsed.data.userId));
  const limitMap = { free: [100, 1000], pro: [1000, 10000], vip: [10000, 100000], admin: [999999, 9999999] };
  const [daily, monthly] = limitMap[parsed.data.plan];
  await db.update(userLimits).set({ dailyLimit: daily, monthlyLimit: monthly }).where(eq(userLimits.userId, parsed.data.userId)).catch(() => {});
  res.json({ success: true, message: `User ${parsed.data.userId} upgraded to ${parsed.data.plan}` });
});

router.post("/user/downgrade", requireAdmin, async (req, res) => {
  const { userId } = req.body;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  await db.update(users).set({ role: "free" }).where(eq(users.id, userId));
  await db.update(userLimits).set({ dailyLimit: 100, monthlyLimit: 1000 }).where(eq(userLimits.userId, userId)).catch(() => {});
  res.json({ success: true, message: `User ${userId} downgraded to free` });
});

router.post("/user/limit", requireAdmin, async (req, res) => {
  const schema = z.object({ userId: z.number(), dailyLimit: z.number().optional(), monthlyLimit: z.number().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "userId required" }); return; }
  const updates: Record<string, number> = {};
  if (parsed.data.dailyLimit !== undefined) updates.dailyLimit = parsed.data.dailyLimit;
  if (parsed.data.monthlyLimit !== undefined) updates.monthlyLimit = parsed.data.monthlyLimit;
  await db.update(userLimits).set(updates).where(eq(userLimits.userId, parsed.data.userId));
  res.json({ success: true, message: "Limits updated" });
});

router.get("/stats", requireAdmin, async (req, res) => {
  const [userCount] = await db.select({ total: count() }).from(users);
  const [keyCount] = await db.select({ total: count() }).from(apiKeys);
  const [eventCount] = await db.select({ total: count() }).from(analyticsEvents);
  const [blockedCount] = await db.select({ total: count() }).from(users).where(eq(users.isBlocked, true));

  const topEndpoints = await db
    .select({ endpoint: analyticsEvents.endpoint, hits: count() })
    .from(analyticsEvents)
    .groupBy(analyticsEvents.endpoint)
    .orderBy(desc(count()))
    .limit(10);

  res.json({
    users: { total: userCount.total, blocked: blockedCount.total },
    apiKeys: { total: keyCount.total },
    requests: { total: eventCount.total },
    topEndpoints,
    cacheStats: cache.stats(),
  });
});

router.get("/system/status", requireAdmin, async (_req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: emergencyShutdownFlag ? "shutdown_pending" : "operational",
    uptime: process.uptime(),
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + "MB",
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + "MB",
      rss: Math.round(memUsage.rss / 1024 / 1024) + "MB",
    },
    os: {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      freeMemory: Math.round(os.freemem() / 1024 / 1024) + "MB",
      totalMemory: Math.round(os.totalmem() / 1024 / 1024) + "MB",
      loadAvg: os.loadavg(),
    },
    node: process.version,
    cacheEntries: cache.size(),
    timestamp: new Date().toISOString(),
  });
});

router.post("/emergency/shutdown", requireAdmin, (_req, res) => {
  emergencyShutdownFlag = true;
  res.json({ success: true, message: "Emergency shutdown flag set. Server will stop accepting new requests." });
  setTimeout(() => process.exit(1), 5000);
});

router.post("/endpoints/enable", requireAdmin, async (req, res) => {
  const { path: p } = req.body;
  if (!p) { res.status(400).json({ error: "path required" }); return; }
  await db.insert(endpointConfig).values({ path: p, isEnabled: true })
    .onConflictDoUpdate({ target: endpointConfig.path, set: { isEnabled: true, updatedAt: new Date() } });
  cache.del(`endpoint_enabled:${p}`);
  res.json({ success: true, message: `Endpoint ${p} enabled` });
});

router.post("/endpoints/disable", requireAdmin, async (req, res) => {
  const { path: p } = req.body;
  if (!p) { res.status(400).json({ error: "path required" }); return; }
  await db.insert(endpointConfig).values({ path: p, isEnabled: false })
    .onConflictDoUpdate({ target: endpointConfig.path, set: { isEnabled: false, updatedAt: new Date() } });
  cache.del(`endpoint_enabled:${p}`);
  res.json({ success: true, message: `Endpoint ${p} disabled` });
});

export default router;
