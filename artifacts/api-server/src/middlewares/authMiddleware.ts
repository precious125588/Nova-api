import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/jwt.js";

export interface AuthUser {
  id: number;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Authentication required. Pass Bearer token in Authorization header." });
    return;
  }
  try {
    req.user = verifyToken(token) as unknown as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token) {
    try {
      req.user = verifyToken(token) as unknown as AuthUser;
    } catch {
      // ignore invalid token for optional auth
    }
  }
  next();
}
