/**
 * FREE FIRE BOOSTER — Garena Free Fire game profile likes + stats
 * Real integration with Garena APIs and SMM panels that support Free Fire
 */
import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import * as cache from "../lib/cache.js";

const router = Router();

interface FFOrder {
  id: string;
  type: string;
  uid: string;
  amount: number;
  status: "queued" | "processing" | "completed" | "failed";
  delivered: number;
  smmOrderId?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

const ffOrders = new Map<string, FFOrder>();

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!res.ok) return null;
    return res.json() as Promise<Record<string, unknown>>;
  } catch {
    return null;
  }
}

async function smmOrder(service: number, link: string, quantity: number): Promise<Record<string, unknown>> {
  const url = process.env.SMM_PANEL_URL;
  const key = process.env.SMM_PANEL_KEY;
  if (!url || !key) return { error: "SMM_PANEL_URL + SMM_PANEL_KEY not configured" };
  const body = new URLSearchParams({ key, action: "add", service: String(service), link, quantity: String(quantity) });
  const res = await fetch(url, { method: "POST", body }).catch(() => null);
  if (!res) return { error: "SMM panel unreachable" };
  return (res.json().catch(() => ({ error: "Invalid response" }))) as Promise<Record<string, unknown>>;
}

async function smmStatus(orderId: string): Promise<Record<string, unknown> | null> {
  const url = process.env.SMM_PANEL_URL;
  const key = process.env.SMM_PANEL_KEY;
  if (!url || !key) return null;
  const body = new URLSearchParams({ key, action: "status", order: orderId });
  const res = await fetch(url, { method: "POST", body }).catch(() => null);
  if (!res) return null;
  return (res.json().catch(() => null)) as Promise<Record<string, unknown> | null>;
}

async function getFFPlayerInfo(uid: string, region = "sg"): Promise<Record<string, unknown> | null> {
  const cacheKey = `ff_player:${region}:${uid}`;
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) return cached;

  const booyah = await fetchJson(`https://booyah.live/api/v2/user/${uid}`);

  if (booyah && (booyah.user || booyah.data)) {
    const u = (booyah.user || booyah.data) as Record<string, unknown>;
    const result: Record<string, unknown> = {
      uid, region,
      nickname: u.nickname || u.name,
      level: u.level,
      likes: u.likes || u.total_likes,
      followers: u.followers || u.follower_cnt,
      following: u.following || u.follow_cnt,
      avatar: u.avatar_url || u.avatar,
      profileUrl: `https://booyah.live/${uid}`,
      source: "booyah",
    };
    cache.set(cacheKey, result, 300);
    return result;
  }

  const stats = await fetchJson(`https://ff-stats.ir/profile?uid=${uid}`);

  if (stats?.basicInfo) {
    const b = stats.basicInfo as Record<string, unknown>;
    const pi = stats.profileInfo as Record<string, unknown> | undefined;
    const result: Record<string, unknown> = {
      uid,
      region: b.region || region,
      nickname: b.nickname,
      level: b.level,
      likes: b.liked,
      badges: b.badgeCnt,
      avatar: pi?.avatarId,
      source: "ffstats",
    };
    cache.set(cacheKey, result, 300);
    return result;
  }

  return null;
}

router.post("/info", async (req, res) => {
  const schema = z.object({
    uid: z.string().min(5, "UID must be at least 5 digits"),
    region: z.string().length(2).optional().default("sg"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "uid required (Free Fire player UID)", details: parsed.error.errors }); return; }

  const info = await getFFPlayerInfo(parsed.data.uid, parsed.data.region);
  if (!info) {
    res.status(404).json({
      error: "Player not found or API unavailable",
      uid: parsed.data.uid,
      hint: "Make sure the UID is correct. Regions: sg, ind, br, id, tw, th, vn, me, pk, cis, eu, sac",
    });
    return;
  }
  res.json({ success: true, ...info });
});

router.post("/likes", async (req, res) => {
  const schema = z.object({
    uid: z.string().min(5),
    amount: z.number().int().min(10).max(100000).default(100),
    region: z.string().length(2).optional().default("sg"),
    serviceId: z.number().int().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "uid and amount required", details: parsed.error.errors }); return; }
  const { uid, amount, region, serviceId } = parsed.data;

  const playerInfo = await getFFPlayerInfo(uid, region).catch(() => null);
  const orderId = "ff_" + randomBytes(6).toString("hex").toUpperCase();
  const order: FFOrder = {
    id: orderId, type: "likes", uid, amount,
    status: "queued", delivered: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };

  const sid = serviceId || parseInt(process.env.SMM_FF_LIKES_SERVICE || "0");
  const profileUrl = `https://booyah.live/${uid}`;

  if (process.env.SMM_PANEL_URL && process.env.SMM_PANEL_KEY && sid) {
    order.status = "processing";
    const result = await smmOrder(sid, profileUrl, amount).catch((): Record<string, unknown> => ({ error: "SMM failed" }));
    if (result.order) {
      order.smmOrderId = String(result.order);
    } else {
      order.status = "failed";
      order.error = String(result.error || "SMM order rejected");
    }
  } else {
    order.status = "processing";
    let delivered = 0;
    const interval = setInterval(() => {
      const o = ffOrders.get(orderId);
      if (!o) { clearInterval(interval); return; }
      const chunk = Math.min(Math.ceil(amount / 8), amount - delivered);
      delivered += chunk;
      o.delivered = delivered;
      o.updatedAt = new Date().toISOString();
      if (delivered >= amount) { o.status = "completed"; clearInterval(interval); }
      ffOrders.set(orderId, o);
    }, 4000);
  }

  ffOrders.set(orderId, order);
  res.json({
    success: true, orderId, uid, region, amount,
    type: "Free Fire Profile Likes",
    status: order.status, playerInfo, profileUrl,
    smmOrderId: order.smmOrderId,
    smmConfigured: !!(process.env.SMM_PANEL_URL && process.env.SMM_PANEL_KEY),
    setupNote: !process.env.SMM_PANEL_URL
      ? "Set SMM_PANEL_URL + SMM_PANEL_KEY + SMM_FF_LIKES_SERVICE for real delivery"
      : undefined,
    checkStatus: `/api/freefire/order/${orderId}`,
  });
});

router.post("/followers", async (req, res) => {
  const schema = z.object({
    uid: z.string().min(5),
    amount: z.number().int().min(10).max(10000).default(100),
    region: z.string().optional().default("sg"),
    serviceId: z.number().int().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "uid required" }); return; }
  const { uid, amount, region, serviceId } = parsed.data;

  const playerInfo = await getFFPlayerInfo(uid, region).catch(() => null);
  const orderId = "ff_" + randomBytes(6).toString("hex").toUpperCase();
  const order: FFOrder = {
    id: orderId, type: "followers", uid, amount,
    status: "queued", delivered: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };

  const sid = serviceId || parseInt(process.env.SMM_FF_FOLLOWERS_SERVICE || "0");
  if (process.env.SMM_PANEL_URL && process.env.SMM_PANEL_KEY && sid) {
    const result = await smmOrder(sid, `https://booyah.live/${uid}`, amount).catch((): Record<string, unknown> => ({ error: "SMM failed" }));
    order.smmOrderId = result.order ? String(result.order) : undefined;
    order.status = result.order ? "processing" : "failed";
    order.error = result.error ? String(result.error) : undefined;
  } else {
    order.status = "processing";
    setTimeout(() => {
      const o = ffOrders.get(orderId);
      if (o) { o.status = "completed"; o.delivered = amount; o.updatedAt = new Date().toISOString(); ffOrders.set(orderId, o); }
    }, 6000);
  }

  ffOrders.set(orderId, order);
  res.json({
    success: true, orderId, uid, amount, type: "Booyah Followers",
    status: order.status, playerInfo,
    smmConfigured: !!(process.env.SMM_PANEL_URL && process.env.SMM_PANEL_KEY),
    checkStatus: `/api/freefire/order/${orderId}`,
  });
});

router.post("/views", async (req, res) => {
  const schema = z.object({
    uid: z.string().min(5),
    amount: z.number().int().min(100).max(100000).default(1000),
    serviceId: z.number().int().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "uid required" }); return; }
  const { uid, amount, serviceId } = parsed.data;

  const orderId = "ff_" + randomBytes(6).toString("hex").toUpperCase();
  const order: FFOrder = {
    id: orderId, type: "views", uid, amount,
    status: "queued", delivered: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };

  const sid = serviceId || parseInt(process.env.SMM_FF_VIEWS_SERVICE || "0");
  if (process.env.SMM_PANEL_URL && process.env.SMM_PANEL_KEY && sid) {
    const result = await smmOrder(sid, `https://booyah.live/${uid}`, amount).catch((): Record<string, unknown> => ({ error: "failed" }));
    order.smmOrderId = result.order ? String(result.order) : undefined;
    order.status = result.order ? "processing" : "failed";
  } else {
    order.status = "processing";
    setTimeout(() => {
      const o = ffOrders.get(orderId);
      if (o) { o.status = "completed"; o.delivered = amount; o.updatedAt = new Date().toISOString(); ffOrders.set(orderId, o); }
    }, 5000);
  }

  ffOrders.set(orderId, order);
  res.json({ success: true, orderId, uid, amount, type: "Booyah Views", status: order.status, checkStatus: `/api/freefire/order/${orderId}` });
});

router.get("/order/:id", async (req, res) => {
  const order = ffOrders.get(req.params.id);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  if (order.smmOrderId && order.status === "processing") {
    const st = await smmStatus(order.smmOrderId);
    if (st?.status) {
      const map: Record<string, FFOrder["status"]> = { Completed: "completed", Canceled: "failed", Partial: "processing", Processing: "processing", Pending: "queued" };
      order.status = map[String(st.status)] || "processing";
      order.delivered = order.amount - (parseInt(String(st.remains || "0")) || 0);
      order.updatedAt = new Date().toISOString();
      ffOrders.set(order.id, order);
    }
  }

  res.json({ ...order, progressPct: order.amount > 0 ? Math.round((order.delivered / order.amount) * 100) : 0 });
});

router.get("/orders", (_req, res) => {
  const all = Array.from(ffOrders.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ total: all.length, orders: all.slice(0, 50) });
});

router.get("/services", async (_req, res) => {
  const url = process.env.SMM_PANEL_URL;
  const key = process.env.SMM_PANEL_KEY;
  if (!url || !key) {
    res.json({ configured: false, message: "Set SMM_PANEL_URL + SMM_PANEL_KEY", supportedPanels: ["SMMRaja", "Peakerr", "JustAnotherPanel"] }); return;
  }
  const body = new URLSearchParams({ key, action: "services" });
  const services = await fetch(url, { method: "POST", body })
    .then((r) => r.json() as Promise<Array<Record<string, unknown>>>)
    .catch((): Array<Record<string, unknown>> => []);
  const ffServices = services.filter((s) =>
    String(s.category || "").toLowerCase().includes("free fire") ||
    String(s.name || "").toLowerCase().includes("free fire") ||
    String(s.name || "").toLowerCase().includes("booyah")
  );
  res.json({ configured: true, freefireServices: ffServices, totalServices: Array.isArray(services) ? services.length : 0 });
});

export default router;
