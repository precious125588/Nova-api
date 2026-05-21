import { Router } from "express";
import { db } from "@workspace/db";
import { analyticsEvents, users, apiKeys } from "@workspace/db";
import { desc, gte, sql, and, count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/adminMiddleware.js";
import { optionalAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.get("/requests", requireAdmin, async (req, res) => {
  const hours = parseInt(String(req.query.hours ?? "24"));
  const since = new Date(Date.now() - hours * 3600000);

  const events = await db
    .select({
      endpoint: analyticsEvents.endpoint,
      method: analyticsEvents.method,
      hits: count(),
      avgResponseMs: sql<number>`coalesce(round(avg(${analyticsEvents.responseTime})),0)::int`,
    })
    .from(analyticsEvents)
    .where(gte(analyticsEvents.createdAt, since))
    .groupBy(analyticsEvents.endpoint, analyticsEvents.method)
    .orderBy(desc(count()))
    .limit(50)
    .catch(() => [] as { endpoint: string; method: string; hits: number; avgResponseMs: number }[]);

  const total = events.reduce((s, e) => s + (Number(e.hits) || 0), 0);
  res.json({
    period: `Last ${hours}h`,
    total,
    endpoints: events.map((e) => ({ endpoint: e.endpoint, method: e.method, hits: e.hits, avgResponseMs: e.avgResponseMs })),
  });
});

router.get("/users", requireAdmin, async (req, res) => {
  const hours = parseInt(String(req.query.hours ?? "24"));
  const since = new Date(Date.now() - hours * 3600000);

  const activeUsers = await db
    .select({
      userId: analyticsEvents.userId,
      requests: count(),
    })
    .from(analyticsEvents)
    .where(gte(analyticsEvents.createdAt, since))
    .groupBy(analyticsEvents.userId)
    .orderBy(desc(count()))
    .limit(20)
    .catch(() => [] as { userId: number | null; requests: number }[]);

  res.json({ period: `Last ${hours}h`, activeUsers: activeUsers.filter((u) => u.userId != null) });
});

router.get("/endpoints", optionalAuth, async (_req, res) => {
  const events = await db
    .select({
      endpoint: analyticsEvents.endpoint,
      hits: count(),
      errors: sql<number>`coalesce(sum(case when ${analyticsEvents.statusCode} >= 400 then 1 else 0 end),0)::int`,
    })
    .from(analyticsEvents)
    .groupBy(analyticsEvents.endpoint)
    .orderBy(desc(count()))
    .limit(30)
    .catch(() => [] as { endpoint: string; hits: number; errors: number }[]);

  res.json({
    endpoints: events.map((e) => ({
      endpoint: e.endpoint,
      totalHits: e.hits,
      errors: e.errors,
      errorRate: e.hits > 0 ? (((e.errors || 0) / e.hits) * 100).toFixed(1) + "%" : "0%",
    })),
  });
});

router.get("/errors", requireAdmin, async (req, res) => {
  const hours = parseInt(String(req.query.hours ?? "24"));
  const since = new Date(Date.now() - hours * 3600000);

  const errors = await db
    .select({
      endpoint: analyticsEvents.endpoint,
      statusCode: analyticsEvents.statusCode,
      hits: count(),
    })
    .from(analyticsEvents)
    .where(and(gte(analyticsEvents.createdAt, since), sql`${analyticsEvents.statusCode} >= 400`))
    .groupBy(analyticsEvents.endpoint, analyticsEvents.statusCode)
    .orderBy(desc(count()))
    .limit(20)
    .catch(() => [] as { endpoint: string; statusCode: number | null; hits: number }[]);

  res.json({ period: `Last ${hours}h`, errors });
});

router.get("/usage", optionalAuth, async (req, res) => {
  const days = parseInt(String(req.query.days ?? "7"));
  const since = new Date(Date.now() - days * 86400000);

  const daily = await db
    .select({
      date: sql<string>`date_trunc('day', ${analyticsEvents.createdAt})::date`,
      requests: sql<number>`count(*)::int`,
      errors: sql<number>`sum(case when ${analyticsEvents.statusCode} >= 400 then 1 else 0 end)::int`,
    })
    .from(analyticsEvents)
    .where(gte(analyticsEvents.createdAt, since))
    .groupBy(sql`date_trunc('day', ${analyticsEvents.createdAt})`)
    .orderBy(sql`date_trunc('day', ${analyticsEvents.createdAt})`)
    .catch(() => []);

  const [rCount] = await db.select({ total: sql<number>`count(*)::int` }).from(analyticsEvents).catch(() => [{ total: 0 }]);
  const [uCount] = await db.select({ total: sql<number>`count(*)::int` }).from(users).catch(() => [{ total: 0 }]);
  const [kCount] = await db.select({ total: sql<number>`count(*)::int` }).from(apiKeys).catch(() => [{ total: 0 }]);

  res.json({
    period: `Last ${days} days`,
    totals: { requests: rCount?.total, users: uCount?.total, apiKeys: kCount?.total },
    daily: daily.map((d) => ({ date: d.date, requests: d.requests, errors: d.errors || 0 })),
  });
});

export default router;
