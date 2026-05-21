import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "fallback-secret-change-me-in-production";
const ADMIN_JWT_SECRET = (process.env.JWT_SECRET || process.env.SESSION_SECRET || "fallback") + "_admin";

export function signToken(payload: object, expiresIn = "24h"): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): Record<string, unknown> {
  return jwt.verify(token, JWT_SECRET) as Record<string, unknown>;
}

export function signAdminToken(payload: object, expiresIn = "8h"): string {
  return jwt.sign(payload, ADMIN_JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

export function verifyAdminToken(token: string): Record<string, unknown> {
  return jwt.verify(token, ADMIN_JWT_SECRET) as Record<string, unknown>;
}
