import { Request, Response, NextFunction } from "express";
import { verifyAdminToken } from "../lib/jwt.js";

export interface AdminUser {
  id: number;
  role: "admin";
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminUser;
    }
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Admin authentication required" });
    return;
  }
  try {
    const payload = verifyAdminToken(token) as unknown as AdminUser;
    if (payload.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired admin token" });
  }
}
