import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import { users, userLimits } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken } from "../lib/jwt.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

const registerSchema = z.object({
  username: z.string().min(3).max(30),
  email: z.string().email(),
  password: z.string().min(6),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.errors });
    return;
  }
  const { username, email, password } = parsed.data;

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) }).catch(() => null);
  if (existing) { res.status(409).json({ error: "Email already registered" }); return; }

  const existingUsername = await db.query.users.findFirst({ where: eq(users.username, username) }).catch(() => null);
  if (existingUsername) { res.status(409).json({ error: "Username already taken" }); return; }

  const passwordHash = await bcrypt.hash(password, 12);
  const verifyToken = randomBytes(32).toString("hex");

  const [user] = await db.insert(users).values({ username, email, passwordHash, verifyToken }).returning();

  await db.insert(userLimits).values({ userId: user.id }).catch(() => {});

  const token = signToken({ id: user.id, email: user.email, role: user.role });

  res.status(201).json({
    success: true,
    token,
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
    message: "Registration successful. Use the verifyToken to verify your email.",
    verifyToken,
  });
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { email, password } = parsed.data;

  const user = await db.query.users.findFirst({ where: eq(users.email, email) }).catch(() => null);
  if (!user) { res.status(401).json({ error: "Invalid credentials" }); return; }
  if (user.isBlocked) { res.status(403).json({ error: "Account is blocked" }); return; }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) { res.status(401).json({ error: "Invalid credentials" }); return; }

  const token = signToken({ id: user.id, email: user.email, role: user.role });

  res.json({
    success: true,
    token,
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
  });
});

router.post("/logout", requireAuth, (_req, res) => {
  res.json({ success: true, message: "Logged out. Discard your Bearer token on the client side." });
});

router.get("/verify", async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== "string") { res.status(400).json({ error: "Verification token required" }); return; }

  const user = await db.query.users.findFirst({ where: eq(users.verifyToken, token) }).catch(() => null);
  if (!user) { res.status(404).json({ error: "Invalid or expired verification token" }); return; }

  await db.update(users).set({ emailVerified: true, verifyToken: null }).where(eq(users.id, user.id));
  res.json({ success: true, message: "Email verified successfully" });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, req.user!.id) }).catch(() => null);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    isBlocked: user.isBlocked,
    createdAt: user.createdAt,
  });
});

export default router;
