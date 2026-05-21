import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import QRCode from "qrcode";
import { db } from "@workspace/db";
import { shortUrls } from "@workspace/db";
import { eq } from "drizzle-orm";
import { optionalAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/qr", async (req, res) => {
  const schema = z.object({
    text: z.string().min(1),
    size: z.number().int().min(100).max(1000).optional().default(300),
    format: z.enum(["png", "svg", "dataURL"]).optional().default("dataURL"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "text is required" }); return; }

  const { text, size, format } = parsed.data;

  if (format === "svg") {
    const svg = await QRCode.toString(text, { type: "svg", width: size });
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  } else if (format === "png") {
    const buffer = await QRCode.toBuffer(text, { width: size });
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } else {
    const dataUrl = await QRCode.toDataURL(text, { width: size });
    res.json({ success: true, dataUrl, text, size });
  }
});

router.post("/url-short", optionalAuth, async (req, res) => {
  const schema = z.object({ url: z.string().url(), customCode: z.string().min(3).max(20).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Valid url is required" }); return; }

  const { url, customCode } = parsed.data;
  const code = customCode || randomBytes(4).toString("hex");

  const existing = await db.query.shortUrls.findFirst({ where: eq(shortUrls.code, code) }).catch(() => null);
  if (existing) { res.status(409).json({ error: "Code already taken" }); return; }

  await db.insert(shortUrls).values({
    code,
    originalUrl: url,
    userId: req.user?.id ?? null,
  });

  const domain = process.env.APP_DOMAIN || req.get("host") || "localhost";
  const protocol = req.secure ? "https" : "http";
  res.json({ success: true, code, shortUrl: `${protocol}://${domain}/api/tools/url-short/${code}`, originalUrl: url });
});

router.get("/url-short/:code", async (req, res) => {
  const { code } = req.params;
  const record = await db.query.shortUrls.findFirst({ where: eq(shortUrls.code, code) }).catch(() => null);
  if (!record) { res.status(404).json({ error: "Short URL not found" }); return; }

  db.update(shortUrls).set({ clickCount: record.clickCount + 1 }).where(eq(shortUrls.id, record.id)).catch(() => {});
  res.redirect(301, record.originalUrl);
});

router.post("/password", (req, res) => {
  const schema = z.object({
    length: z.number().int().min(8).max(128).optional().default(16),
    includeUppercase: z.boolean().optional().default(true),
    includeLowercase: z.boolean().optional().default(true),
    includeNumbers: z.boolean().optional().default(true),
    includeSymbols: z.boolean().optional().default(true),
    count: z.number().int().min(1).max(20).optional().default(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid options" }); return; }

  const { length, includeUppercase, includeLowercase, includeNumbers, includeSymbols, count } = parsed.data;
  let charset = "";
  if (includeLowercase) charset += "abcdefghijklmnopqrstuvwxyz";
  if (includeUppercase) charset += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (includeNumbers) charset += "0123456789";
  if (includeSymbols) charset += "!@#$%^&*()_+-=[]{}|;:,.<>?";
  if (!charset) charset = "abcdefghijklmnopqrstuvwxyz0123456789";

  const passwords = Array.from({ length: count }, () => {
    const bytes = randomBytes(length);
    return Array.from(bytes).map((b) => charset[b % charset.length]).join("");
  });

  res.json({ success: true, passwords: count === 1 ? undefined : passwords, password: count === 1 ? passwords[0] : undefined, length, strength: length >= 16 && includeSymbols ? "strong" : length >= 12 ? "medium" : "weak" });
});

router.post("/base64", (req, res) => {
  const { text, data, action } = req.body;
  if (!action || !["encode", "decode"].includes(action)) { res.status(400).json({ error: "action must be 'encode' or 'decode'" }); return; }

  if (action === "encode") {
    const input = text || data;
    if (!input) { res.status(400).json({ error: "text or data required" }); return; }
    res.json({ success: true, action: "encode", result: Buffer.from(input).toString("base64"), input });
  } else {
    const input = text || data;
    if (!input) { res.status(400).json({ error: "text or data required" }); return; }
    try {
      res.json({ success: true, action: "decode", result: Buffer.from(input, "base64").toString("utf-8"), input });
    } catch {
      res.status(400).json({ error: "Invalid base64 string" });
    }
  }
});

router.post("/hash", (req, res) => {
  const schema = z.object({
    text: z.string().min(1),
    algorithm: z.enum(["md5", "sha1", "sha256", "sha512", "sha224", "sha384"]).optional().default("sha256"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "text is required" }); return; }

  const { text, algorithm } = parsed.data;
  const hash = createHash(algorithm).update(text).digest("hex");
  res.json({ success: true, hash, algorithm, input: text });
});

router.post("/ip-lookup", async (req, res) => {
  const rawIp = req.body.ip || (req.ip || "").replace("::ffff:", "") || "8.8.8.8";
  const ip = rawIp === "::1" || rawIp === "127.0.0.1" ? "8.8.8.8" : rawIp;

  const cacheKey = `ip_lookup:${ip}`;
  const { get: cacheGet, set: cacheSet } = await import("../lib/cache.js");
  const cached = cacheGet(cacheKey);
  if (cached) { res.json(cached); return; }

  const data = await fetch(`http://ip-api.com/json/${ip}?fields=66846719`)
    .then((r) => r.json() as Promise<Record<string, unknown>>)
    .catch((): Record<string, unknown> | null => null);

  if (!data || data.status === "fail") {
    res.status(400).json({ error: "IP lookup failed", ip });
    return;
  }

  const result = {
    success: true, ip,
    country: data.country, countryCode: data.countryCode, region: data.regionName,
    city: data.city, zip: data.zip, lat: data.lat, lon: data.lon,
    timezone: data.timezone, isp: data.isp, org: data.org, as: data.as,
    mobile: data.mobile, proxy: data.proxy, hosting: data.hosting,
  };
  cacheSet(cacheKey, result, 3600);
  res.json(result);
});

router.post("/whois", async (req, res) => {
  const { domain } = req.body;
  if (!domain) { res.status(400).json({ error: "domain is required" }); return; }
  const clean = domain.replace(/^https?:\/\//, "").split("/")[0];

  type RdapEntity = { roles?: string[]; vcardArray?: unknown[][] };
  type RdapEvent  = { eventAction?: string; eventDate?: string };
  type RdapNS     = { ldhName?: string };

  const rdap = await fetch(`https://rdap.org/domain/${clean}`)
    .then((r) => (r.ok ? r.json() as Promise<Record<string, unknown>> : null))
    .catch((): Record<string, unknown> | null => null);

  if (!rdap) {
    res.json({ success: false, domain: clean, message: "WHOIS lookup failed or domain not found" });
    return;
  }

  const entities  = Array.isArray(rdap.entities)  ? rdap.entities  as RdapEntity[] : [];
  const events    = Array.isArray(rdap.events)     ? rdap.events    as RdapEvent[]  : [];
  const nameservers = Array.isArray(rdap.nameservers) ? rdap.nameservers as RdapNS[] : [];

  const registrar  = entities.find((e) => e.roles?.includes("registrar"));
  const registrant = entities.find((e) => e.roles?.includes("registrant"));
  const vcard1 = (vcArr: unknown[] | undefined, key: string): string | undefined =>
    (vcArr as Array<[string, unknown, unknown, string]> | undefined)?.find((f) => f[0] === key)?.[3];

  res.json({
    success: true, domain: clean,
    registrar:        vcard1(registrar?.vcardArray?.[1],  "fn") ?? "Unknown",
    registrationDate: events.find((e) => e.eventAction === "registration")?.eventDate,
    expirationDate:   events.find((e) => e.eventAction === "expiration")?.eventDate,
    updatedDate:      events.find((e) => e.eventAction === "last changed")?.eventDate,
    status:      rdap.status,
    nameServers: nameservers.map((ns) => ns.ldhName),
    registrant:  vcard1(registrant?.vcardArray?.[1], "fn") ?? "Protected",
  });
});

export default router;
