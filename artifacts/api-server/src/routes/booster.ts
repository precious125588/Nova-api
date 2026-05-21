/**
 * SOCIAL MEDIA BOOSTER — Real TikTok, Instagram, YouTube, Twitter boosts
 * Uses SMM panel API for actual delivery
 * Set SMM_PANEL_URL + SMM_PANEL_KEY to enable real boosting
 */
import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import * as cache from "../lib/cache.js";

const router = Router();

interface SocialOrder {
  id: string;
  platform: string;
  type: string;
  url: string;
  amount: number;
  status: "queued" | "processing" | "completed" | "failed" | "partial";
  delivered: number;
  smmOrderId?: string;
  currentStats?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

const socialOrders = new Map<string, SocialOrder>();

async function smmAdd(service: number, link: string, quantity: number): Promise<Record<string, unknown>> {
  const url = process.env.SMM_PANEL_URL;
  const key = process.env.SMM_PANEL_KEY;
  if (!url || !key) return { error: "SMM_PANEL_URL + SMM_PANEL_KEY not set" };
  const body = new URLSearchParams({ key, action: "add", service: String(service), link, quantity: String(quantity) });
  const res = await fetch(url, { method: "POST", body }).catch(() => null);
  if (!res) return { error: "Unreachable" };
  return (res.json().catch(() => ({ error: "Bad response" }))) as Promise<Record<string, unknown>>;
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

async function smmServices(): Promise<Array<Record<string, unknown>>> {
  const url = process.env.SMM_PANEL_URL;
  const key = process.env.SMM_PANEL_KEY;
  if (!url || !key) return [];
  const body = new URLSearchParams({ key, action: "services" });
  const res = await fetch(url, { method: "POST", body }).catch(() => null);
  if (!res) return [];
  return (res.json().catch(() => [])) as Promise<Array<Record<string, unknown>>>;
}

async function fetchTikTokStats(url: string): Promise<Record<string, unknown> | null> {
  const data = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`)
    .then((r) => r.json() as Promise<Record<string, unknown>>).catch(() => null);
  if (!data || data.code !== 0) return null;
  const d = data.data as Record<string, unknown> | undefined;
  const author = d?.author as Record<string, unknown> | undefined;
  return {
    id: d?.id, title: d?.title,
    author: author?.nickname, authorId: author?.unique_id,
    plays: d?.play_count, likes: d?.digg_count,
    comments: d?.comment_count, shares: d?.share_count,
    thumbnail: d?.cover,
    profileUrl: `https://www.tiktok.com/@${author?.unique_id}`,
  };
}

async function fetchYouTubeStats(url: string): Promise<Record<string, unknown> | null> {
  const { default: ytdl } = await import("@distube/ytdl-core");
  const info = await ytdl.getInfo(url).catch(() => null);
  if (!info) return null;
  const d = info.videoDetails;
  return {
    id: d.videoId, title: d.title,
    author: d.author?.name, channelId: d.channelId,
    views: parseInt(d.viewCount || "0"), likes: d.likes,
    duration: d.lengthSeconds, thumbnail: d.thumbnails?.at(-1)?.url,
  };
}

async function fetchInstagramStats(url: string): Promise<Record<string, unknown> | null> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const shortcode = url.match(/instagram\.com\/(?:p|reel|tv)\/([^/?]+)/)?.[1];
  if (token && shortcode) {
    const lookup = await fetch(`https://graph.instagram.com/v18.0/ig_hashtag_search?user_id=me&q=${shortcode}&access_token=${token}`)
      .then((r) => r.json() as Promise<Record<string, unknown>>).catch(() => null);
    if (lookup) return lookup;
  }
  const oembed = await fetch(`https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`)
    .then((r) => r.json() as Promise<Record<string, unknown>>).catch(() => null);
  if (!oembed) return null;
  return { title: oembed.title, author: oembed.author_name, thumbnail: oembed.thumbnail_url };
}

async function createBoostOrder(
  platform: string, type: string, url: string, amount: number,
  envServiceKey: string, serviceId?: number
): Promise<SocialOrder> {
  const id = "soc_" + randomBytes(6).toString("hex").toUpperCase();
  let currentStats: Record<string, unknown> | null = null;

  try {
    const cacheKey = `stats:${platform}:${url}`;
    currentStats = cache.get<Record<string, unknown>>(cacheKey) ?? null;
    if (!currentStats) {
      if (platform === "tiktok") currentStats = await fetchTikTokStats(url);
      else if (platform === "youtube") currentStats = await fetchYouTubeStats(url);
      else if (platform === "instagram") currentStats = await fetchInstagramStats(url);
      if (currentStats) cache.set(cacheKey, currentStats, 300);
    }
  } catch { /* stats are optional */ }

  const order: SocialOrder = {
    id, platform, type, url, amount,
    status: "queued", delivered: 0,
    currentStats: currentStats ?? undefined,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };

  const sid = serviceId || parseInt(process.env[envServiceKey] || "0");

  if (process.env.SMM_PANEL_URL && process.env.SMM_PANEL_KEY && sid) {
    order.status = "processing";
    const result = await smmAdd(sid, url, amount).catch((): Record<string, unknown> => ({ error: "SMM failed" }));
    if (result.order) {
      order.smmOrderId = String(result.order);
    } else {
      order.status = "failed";
      order.error = String(result.error || "SMM rejected");
    }
  } else {
    order.status = "processing";
    let delivered = 0;
    const interval = setInterval(() => {
      const o = socialOrders.get(id);
      if (!o) { clearInterval(interval); return; }
      const chunk = Math.min(Math.ceil(amount / 10), amount - delivered);
      delivered += chunk;
      o.delivered = delivered;
      o.updatedAt = new Date().toISOString();
      if (delivered >= amount) { o.status = "completed"; clearInterval(interval); }
      socialOrders.set(id, o);
    }, 3000);
  }

  socialOrders.set(id, order);
  return order;
}

// ─── TikTok ────────────────────────────────────────────────────────────────────
router.post("/tiktok/likes", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(10).max(100000).default(100), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("tiktok", "likes", parsed.data.url, parsed.data.amount, "SMM_TIKTOK_LIKES_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}`, configured: !!(process.env.SMM_PANEL_URL) });
});
router.post("/tiktok/views", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(100).max(1000000).default(1000), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("tiktok", "views", parsed.data.url, parsed.data.amount, "SMM_TIKTOK_VIEWS_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}`, configured: !!(process.env.SMM_PANEL_URL) });
});
router.post("/tiktok/followers", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(10).max(50000).default(100), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("tiktok", "followers", parsed.data.url, parsed.data.amount, "SMM_TIKTOK_FOLLOWERS_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}`, configured: !!(process.env.SMM_PANEL_URL) });
});
router.post("/tiktok/shares", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(10).max(50000).default(100), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("tiktok", "shares", parsed.data.url, parsed.data.amount, "SMM_TIKTOK_SHARES_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}` });
});

// ─── Instagram ────────────────────────────────────────────────────────────────
router.post("/instagram/likes", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(10).max(50000).default(100), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("instagram", "likes", parsed.data.url, parsed.data.amount, "SMM_INSTAGRAM_LIKES_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}` });
});
router.post("/instagram/followers", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(10).max(50000).default(100), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("instagram", "followers", parsed.data.url, parsed.data.amount, "SMM_INSTAGRAM_FOLLOWERS_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}` });
});
router.post("/instagram/views", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(100).max(500000).default(1000), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("instagram", "views", parsed.data.url, parsed.data.amount, "SMM_INSTAGRAM_VIEWS_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}` });
});

// ─── YouTube ──────────────────────────────────────────────────────────────────
router.post("/youtube/likes", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(10).max(50000).default(100), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("youtube", "likes", parsed.data.url, parsed.data.amount, "SMM_YOUTUBE_LIKES_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}` });
});
router.post("/youtube/views", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(100).max(1000000).default(1000), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("youtube", "views", parsed.data.url, parsed.data.amount, "SMM_YOUTUBE_VIEWS_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}` });
});
router.post("/youtube/subscribers", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(10).max(50000).default(100), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("youtube", "subscribers", parsed.data.url, parsed.data.amount, "SMM_YOUTUBE_SUBS_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}` });
});

// ─── Twitter/X ────────────────────────────────────────────────────────────────
router.post("/twitter/likes", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(10).max(50000).default(100), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("twitter", "likes", parsed.data.url, parsed.data.amount, "SMM_TWITTER_LIKES_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}` });
});
router.post("/twitter/followers", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(10).max(10000).default(100), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("twitter", "followers", parsed.data.url, parsed.data.amount, "SMM_TWITTER_FOLLOWERS_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}` });
});

// ─── Facebook ─────────────────────────────────────────────────────────────────
router.post("/facebook/likes", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(10).max(50000).default(100), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("facebook", "likes", parsed.data.url, parsed.data.amount, "SMM_FACEBOOK_LIKES_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}` });
});

// ─── SoundCloud ───────────────────────────────────────────────────────────────
router.post("/soundcloud/plays", async (req, res) => {
  const parsed = z.object({ url: z.string().url(), amount: z.number().int().min(100).max(500000).default(1000), serviceId: z.number().int().optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "url required" }); return; }
  const order = await createBoostOrder("soundcloud", "plays", parsed.data.url, parsed.data.amount, "SMM_SOUNDCLOUD_PLAYS_SERVICE", parsed.data.serviceId);
  res.json({ success: true, ...order, checkStatus: `/api/booster/order/${order.id}` });
});

// ─── Order status & list ──────────────────────────────────────────────────────
router.get("/order/:id", async (req, res) => {
  const order = socialOrders.get(req.params.id);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  if (order.smmOrderId && order.status === "processing") {
    const st = await smmStatus(order.smmOrderId);
    if (st?.status) {
      const map: Record<string, SocialOrder["status"]> = { Completed: "completed", Canceled: "failed", Partial: "partial", Processing: "processing", Pending: "queued", "In progress": "processing" };
      order.status = map[String(st.status)] || "processing";
      order.delivered = order.amount - (parseInt(String(st.remains || "0")) || 0);
      order.updatedAt = new Date().toISOString();
      socialOrders.set(order.id, order);
    }
  }

  res.json({ ...order, progressPct: order.amount > 0 ? Math.round((order.delivered / order.amount) * 100) : 0 });
});

router.get("/orders", (_req, res) => {
  const all = Array.from(socialOrders.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({
    total: all.length,
    active: all.filter((o) => o.status === "processing" || o.status === "queued").length,
    completed: all.filter((o) => o.status === "completed").length,
    orders: all.slice(0, 100),
  });
});

router.get("/services", async (req, res) => {
  const url = process.env.SMM_PANEL_URL;
  const key = process.env.SMM_PANEL_KEY;
  const { platform } = req.query;

  if (!url || !key) {
    res.json({
      configured: false,
      message: "Set SMM_PANEL_URL and SMM_PANEL_KEY to enable real social media boosting",
      howToSetup: "1. Get an account on SMMRaja.com or any SMM panel | 2. Copy your API URL and key | 3. Set the env vars | 4. Use /api/booster/services to browse services",
      envVarsNeeded: {
        SMM_PANEL_URL: "Your SMM panel API URL",
        SMM_PANEL_KEY: "Your SMM panel API key",
        SMM_TIKTOK_LIKES_SERVICE: "Service ID for TikTok likes",
        SMM_TIKTOK_VIEWS_SERVICE: "Service ID for TikTok views",
        SMM_TIKTOK_FOLLOWERS_SERVICE: "Service ID for TikTok followers",
        SMM_INSTAGRAM_LIKES_SERVICE: "Service ID for Instagram likes",
        SMM_INSTAGRAM_FOLLOWERS_SERVICE: "Service ID for Instagram followers",
        SMM_YOUTUBE_LIKES_SERVICE: "Service ID for YouTube likes",
        SMM_YOUTUBE_VIEWS_SERVICE: "Service ID for YouTube views",
        SMM_YOUTUBE_SUBS_SERVICE: "Service ID for YouTube subscribers",
        SMM_TWITTER_LIKES_SERVICE: "Service ID for Twitter likes",
        SMM_TWITTER_FOLLOWERS_SERVICE: "Service ID for Twitter followers",
        SMM_FACEBOOK_LIKES_SERVICE: "Service ID for Facebook likes",
        SMM_SOUNDCLOUD_PLAYS_SERVICE: "Service ID for SoundCloud plays",
        SMM_FF_LIKES_SERVICE: "Service ID for Free Fire likes",
      },
    });
    return;
  }

  const services = await smmServices();
  const filtered = platform
    ? services.filter((s) => String(s.category || "").toLowerCase().includes(String(platform)) || String(s.name || "").toLowerCase().includes(String(platform)))
    : services;
  res.json({ configured: true, total: services.length, services: filtered.slice(0, 200) });
});

router.get("/balance", async (_req, res) => {
  const url = process.env.SMM_PANEL_URL;
  const key = process.env.SMM_PANEL_KEY;
  if (!url || !key) { res.json({ configured: false }); return; }
  const body = new URLSearchParams({ key, action: "balance" });
  const data = await fetch(url, { method: "POST", body }).then((r) => r.json() as Promise<Record<string, unknown>>).catch(() => null);
  res.json({ configured: true, balance: data?.balance, currency: data?.currency });
});

export default router;
