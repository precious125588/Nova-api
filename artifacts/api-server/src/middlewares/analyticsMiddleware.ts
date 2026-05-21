import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { analyticsEvents } from "@workspace/db";
import { logger } from "../lib/logger.js";

export function trackRequest(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    const duration = Date.now() - start;
    const ip = (req.ip || req.socket?.remoteAddress || "unknown").replace("::ffff:", "");

    db.insert(analyticsEvents)
      .values({
        endpoint: req.path,
        method: req.method,
        statusCode: res.statusCode,
        ip,
        userId: req.user?.id ?? req.apiKeyUser?.id ?? null,
        apiKeyId: req.apiKey?.id ?? null,
        responseTime: duration,
      })
      .catch((err) => logger.warn({ err }, "Analytics insert failed"));

    return originalJson(body);
  };

  next();
}
