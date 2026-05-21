import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import authRouter from "./routes/auth.js";
import adminRouter from "./routes/admin.js";
import systemHealthRouter from "./routes/systemHealth.js";
import { logger } from "./lib/logger.js";
import { trackRequest } from "./middlewares/analyticsMiddleware.js";
import { checkIpBlock } from "./middlewares/ipBlockMiddleware.js";
import rateLimit from "express-rate-limit";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Global rate limiter
const globalLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down" },
  skip: (req) => req.path === "/ping" || req.path === "/health",
});
app.use(globalLimit);

// IP block check
app.use(checkIpBlock);

// Analytics tracking
app.use(trackRequest);

// ── Root-level routes (no /api prefix) ────────────────────────────────────────
app.use("/auth", authRouter);
app.use("/admin", adminRouter);
app.use(systemHealthRouter);   // /health, /status, /ping, /version, /logs

// ── API routes (under /api) ───────────────────────────────────────────────────
app.use("/api", router);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint not found", hint: "GET /version for full endpoint list" });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error", message: err.message });
});

export default app;
