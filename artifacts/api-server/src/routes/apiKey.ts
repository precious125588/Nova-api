import { Router } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import { apiKeys } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/generate", requireAuth, async (req, res) => {
  const { name } = req.body;
  const key = "zapi_" + randomBytes(32).toString("hex");

  const [record] = await db.insert(apiKeys).values({
    userId: req.user!.id,
    key,
    name: name || "Default Key",
    isActive: true,
  }).returning();

  res.status(201).json({
    success: true,
    apiKey: {
      id: record.id,
      key: record.key,
      name: record.name,
      createdAt: record.createdAt,
    },
    usage: "Pass as x-api-key header or ?api_key= query param",
  });
});

router.post("/validate", async (req, res) => {
  const { key } = req.body;
  if (!key) { res.status(400).json({ error: "key is required" }); return; }

  const record = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.key, key), eq(apiKeys.isActive, true)),
  }).catch(() => null);

  if (!record) {
    res.json({ valid: false, message: "Key is invalid or revoked" });
    return;
  }

  res.json({
    valid: true,
    id: record.id,
    name: record.name,
    requestsUsed: record.requestsUsed,
    createdAt: record.createdAt,
  });
});

router.post("/revoke", requireAuth, async (req, res) => {
  const schema = z.object({ keyId: z.number().int().positive() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "keyId (number) is required" }); return; }

  const record = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.id, parsed.data.keyId), eq(apiKeys.userId, req.user!.id)),
  }).catch(() => null);

  if (!record) { res.status(404).json({ error: "API key not found or not owned by you" }); return; }

  await db.update(apiKeys)
    .set({ isActive: false, revokedAt: new Date() })
    .where(eq(apiKeys.id, record.id));

  res.json({ success: true, message: "API key revoked" });
});

router.get("/info", requireAuth, async (req, res) => {
  const userKeys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.userId, req.user!.id),
  }).catch(() => []);

  res.json({
    keys: userKeys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPreview: k.key.slice(0, 12) + "...",
      isActive: k.isActive,
      requestsUsed: k.requestsUsed,
      createdAt: k.createdAt,
      revokedAt: k.revokedAt,
    })),
    total: userKeys.length,
    active: userKeys.filter((k) => k.isActive).length,
  });
});

export default router;
