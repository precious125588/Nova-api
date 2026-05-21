import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { apiKeys, users } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { ApiKey, User } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKey;
      apiKeyUser?: User;
    }
  }
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = (req.headers["x-api-key"] as string) || (req.query["api_key"] as string);
  if (!key) {
    res.status(401).json({ error: "API key required. Pass via x-api-key header or api_key query param." });
    return;
  }

  const keyRecord = await db.query.apiKeys.findFirst({
    where: and(eq(apiKeys.key, key), eq(apiKeys.isActive, true)),
  }).catch(() => null);

  if (!keyRecord) {
    res.status(401).json({ error: "Invalid or revoked API key" });
    return;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, keyRecord.userId),
  }).catch(() => null);

  if (!user || user.isBlocked) {
    res.status(403).json({ error: "Account is blocked or not found" });
    return;
  }

  req.apiKey = keyRecord;
  req.apiKeyUser = user;

  db.update(apiKeys)
    .set({ requestsUsed: (keyRecord.requestsUsed || 0) + 1 })
    .where(eq(apiKeys.id, keyRecord.id))
    .catch(() => {});

  next();
}

export async function optionalApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = (req.headers["x-api-key"] as string) || (req.query["api_key"] as string);
  if (key) {
    const keyRecord = await db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.key, key), eq(apiKeys.isActive, true)),
    }).catch(() => null);
    if (keyRecord) {
      req.apiKey = keyRecord;
      const user = await db.query.users.findFirst({
        where: eq(users.id, keyRecord.userId),
      }).catch(() => null);
      if (user) req.apiKeyUser = user;
    }
  }
  next();
}
