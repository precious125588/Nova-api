import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import apiKeyRouter from "./apiKey.js";
import limitRouter from "./limit.js";
import downloadRouter from "./download.js";
import socialRouter from "./social.js";
import aiRouter from "./ai.js";
import toolsRouter from "./tools.js";
import fileSystemRouter from "./fileSystem.js";
import analyticsRouter from "./analytics.js";
import advancedRouter from "./advanced.js";
import premiumRouter from "./premium.js";
import adultRouter from "./adult.js";
import freefireRouter from "./freefire.js";
import boosterRouter from "./booster.js";
import musicRouter from "./music.js";
import moviesRouter from "./movies.js";

const router: IRouter = Router();

// Existing health route
router.use(healthRouter);

// Auth (mounted under /api/auth in app.ts separately at root /auth too)
router.use("/auth", authRouter);

// API Key management
router.use("/key", apiKeyRouter);

// User limits
router.use("/limit", limitRouter);

// Core download engine
router.use(downloadRouter);    // handles /download, /download/info, etc.

// Social media downloaders
router.use(socialRouter);      // handles /tiktok, /youtube/*, /instagram, etc.

// AI system
router.use("/ai", aiRouter);

// Toolbox
router.use("/tools", toolsRouter);

// File system
router.use("/file", fileSystemRouter);

// Analytics
router.use("/analytics", analyticsRouter);

// Advanced control (rate-limit, ip, cache, request logs)
router.use(advancedRouter);

// Premium / plans / billing
router.use(premiumRouter);

// Adult content downloaders
router.use("/adult", adultRouter);

// Free Fire booster (likes, views, followers)
router.use("/freefire", freefireRouter);

// Social booster
router.use("/booster", boosterRouter);

// Music downloads (YouTube, SoundCloud, Spotify, iTunes)
router.use("/music", musicRouter);

// Movies info + downloads (TMDB + Archive.org)
router.use("/movies", moviesRouter);

export default router;
