import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { userLimits } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/authMiddleware.js";
import { requireAdmin } from "../middlewares/adminMiddleware.js";

const router = Router();

router.get("/check", requireAuth, async (req, res) => {
  const limit = await db.query.userLimits.findFirst({
    where: eq(userLimits.userId, req.user!.id),
  }).catch(() => null);

  if (!limit) { res.status(404).json({ error: "No limit record found for this user" }); return; }

  const dailyRemaining = Math.max(0, limit.dailyLimit - limit.requestsToday);
  const monthlyRemaining = Math.max(0, limit.monthlyLimit - limit.requestsThisMonth);

  res.json({
    dailyLimit: limit.dailyLimit,
    dailyUsed: limit.requestsToday,
    dailyRemaining,
    monthlyLimit: limit.monthlyLimit,
    monthlyUsed: limit.requestsThisMonth,
    monthlyRemaining,
    lastDailyReset: limit.lastDailyReset,
    lastMonthlyReset: limit.lastMonthlyReset,
  });
});

router.post("/increase", requireAdmin, async (req, res) => {
  const schema = z.object({ userId: z.number(), dailyIncrease: z.number().optional(), monthlyIncrease: z.number().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "userId required" }); return; }

  const limit = await db.query.userLimits.findFirst({ where: eq(userLimits.userId, parsed.data.userId) }).catch(() => null);
  if (!limit) { res.status(404).json({ error: "User limit not found" }); return; }

  await db.update(userLimits).set({
    dailyLimit: limit.dailyLimit + (parsed.data.dailyIncrease ?? 100),
    monthlyLimit: limit.monthlyLimit + (parsed.data.monthlyIncrease ?? 1000),
  }).where(eq(userLimits.userId, parsed.data.userId));

  res.json({ success: true, message: "Limits increased" });
});

router.post("/decrease", requireAdmin, async (req, res) => {
  const schema = z.object({ userId: z.number(), dailyDecrease: z.number().optional(), monthlyDecrease: z.number().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "userId required" }); return; }

  const limit = await db.query.userLimits.findFirst({ where: eq(userLimits.userId, parsed.data.userId) }).catch(() => null);
  if (!limit) { res.status(404).json({ error: "User limit not found" }); return; }

  await db.update(userLimits).set({
    dailyLimit: Math.max(0, limit.dailyLimit - (parsed.data.dailyDecrease ?? 10)),
    monthlyLimit: Math.max(0, limit.monthlyLimit - (parsed.data.monthlyDecrease ?? 100)),
  }).where(eq(userLimits.userId, parsed.data.userId));

  res.json({ success: true, message: "Limits decreased" });
});

router.post("/reset", requireAuth, async (req, res) => {
  const targetUserId = req.body.userId && req.user!.role === "admin" ? req.body.userId : req.user!.id;

  await db.update(userLimits).set({
    requestsToday: 0,
    requestsThisMonth: 0,
    lastDailyReset: new Date(),
    lastMonthlyReset: new Date(),
  }).where(eq(userLimits.userId, targetUserId));

  res.json({ success: true, message: "Usage counters reset" });
});

router.get("/status", requireAuth, async (req, res) => {
  const limit = await db.query.userLimits.findFirst({
    where: eq(userLimits.userId, req.user!.id),
  }).catch(() => null);

  res.json({
    userId: req.user!.id,
    role: req.user!.role,
    limits: limit ?? { error: "No limit record found" },
  });
});

export default router;
