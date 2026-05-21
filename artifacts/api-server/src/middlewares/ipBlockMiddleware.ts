import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { ipBlocks } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as cache from "../lib/cache.js";

export async function checkIpBlock(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = (req.ip || req.socket?.remoteAddress || "").replace("::ffff:", "");
  if (!ip) { next(); return; }

  const cacheKey = `ip_blocked:${ip}`;
  let isBlocked = cache.get<boolean>(cacheKey);

  if (isBlocked === null) {
    const block = await db.query.ipBlocks.findFirst({
      where: eq(ipBlocks.ip, ip),
    }).catch(() => null);
    isBlocked = !!block;
    cache.set(cacheKey, isBlocked, 60);
  }

  if (isBlocked) {
    res.status(403).json({ error: "Your IP address has been blocked." });
    return;
  }

  next();
}
