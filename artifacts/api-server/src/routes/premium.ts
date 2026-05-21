import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { users, userLimits } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

const PLANS = {
  free: {
    name: "Free",
    price: 0,
    currency: "USD",
    features: ["100 requests/day", "1000 requests/month", "Basic downloads", "Tools & utilities", "1 API key"],
    limits: { daily: 100, monthly: 1000, apiKeys: 1, maxFileSize: "10MB" },
  },
  pro: {
    name: "Pro",
    price: 9.99,
    currency: "USD",
    features: ["1000 requests/day", "10,000 requests/month", "HD downloads", "AI features", "Booster access", "5 API keys", "Priority support"],
    limits: { daily: 1000, monthly: 10000, apiKeys: 5, maxFileSize: "100MB" },
  },
  vip: {
    name: "VIP",
    price: 29.99,
    currency: "USD",
    features: ["10,000 requests/day", "100,000 requests/month", "4K downloads", "Full AI access", "Unlimited boosts", "Unlimited API keys", "Dedicated support"],
    limits: { daily: 10000, monthly: 100000, apiKeys: -1, maxFileSize: "1GB" },
  },
};

router.get("/plan/free", (_req, res) => res.json(PLANS.free));
router.get("/plan/pro", (_req, res) => res.json(PLANS.pro));
router.get("/plan/vip", (_req, res) => res.json(PLANS.vip));

router.get("/plan/current", requireAuth, async (req, res) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, req.user!.id) }).catch(() => null);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const plan = PLANS[user.role as keyof typeof PLANS] || PLANS.free;
  const limits = await db.query.userLimits.findFirst({ where: eq(userLimits.userId, req.user!.id) }).catch(() => null);
  res.json({ plan: user.role, ...plan, usage: limits });
});

router.post("/payment/verify", requireAuth, async (req, res) => {
  const schema = z.object({
    txId: z.string().min(1),
    plan: z.enum(["pro", "vip"]),
    provider: z.enum(["stripe", "paypal", "crypto"]).optional().default("stripe"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "txId and plan required" }); return; }
  const { txId, plan, provider } = parsed.data;

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_KEY) {
    res.json({
      success: false,
      message: "Payment processing not configured",
      setup: "Set STRIPE_SECRET_KEY environment variable",
      txId, plan, provider,
    });
    return;
  }

  // Stripe verification
  try {
    const charge = await fetch(`https://api.stripe.com/v1/charges/${txId}`, {
      headers: { Authorization: `Bearer ${STRIPE_KEY}` },
    }).then((r) => r.json() as Promise<Record<string, unknown>>);

    if (charge.paid && charge.status === "succeeded") {
      const planLimits = { pro: [1000, 10000], vip: [10000, 100000] };
      const [daily, monthly] = planLimits[plan];
      await db.update(users).set({ role: plan }).where(eq(users.id, req.user!.id));
      await db.update(userLimits).set({ dailyLimit: daily, monthlyLimit: monthly }).where(eq(userLimits.userId, req.user!.id)).catch(() => {});
      res.json({ success: true, message: `Upgraded to ${plan}`, plan, txId });
    } else {
      res.status(402).json({ success: false, message: "Payment not confirmed", charge });
    }
  } catch (e: unknown) {
    res.status(400).json({ error: "Payment verification failed", details: (e as Error).message });
  }
});

router.get("/billing/history", requireAuth, async (req, res) => {
  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
  const user = await db.query.users.findFirst({ where: eq(users.id, req.user!.id) }).catch(() => null);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (!STRIPE_KEY) {
    res.json({
      userId: req.user!.id,
      plan: user.role,
      history: [],
      message: "Configure STRIPE_SECRET_KEY for billing history",
    });
    return;
  }

  res.json({ userId: req.user!.id, currentPlan: user.role, history: [], message: "Link Stripe customer ID to enable full history" });
});

export default router;
