import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import { createGzip } from "zlib";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { uploadedFiles } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { optionalAuth } from "../middlewares/authMiddleware.js";

const router = Router();

const UPLOAD_DIR = path.resolve("uploads");
fs.mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, randomBytes(16).toString("hex") + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const blocked = [".exe", ".bat", ".sh", ".ps1", ".cmd"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blocked.includes(ext)) cb(new Error("File type not allowed"));
    else cb(null, true);
  },
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + "MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + "GB";
}

router.post("/upload", optionalAuth, upload.single("file"), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "file is required (multipart/form-data, field name: file)" }); return; }

  const [record] = await db.insert(uploadedFiles).values({
    userId: req.user?.id ?? null,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    path: req.file.path,
  }).returning();

  const host = req.get("host") || "localhost";
  const proto = req.secure ? "https" : "http";
  res.status(201).json({
    success: true, id: record.id, filename: record.filename,
    originalName: record.originalName, mimeType: record.mimeType,
    size: record.size, sizeHuman: formatBytes(record.size),
    downloadUrl: `${proto}://${host}/api/file/download/${record.id}`,
    createdAt: record.createdAt,
  });
});

router.get("/download/:id", async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid file ID" }); return; }

  const record = await db.query.uploadedFiles.findFirst({ where: eq(uploadedFiles.id, id) }).catch(() => null);
  if (!record) { res.status(404).json({ error: "File not found" }); return; }

  const exists = await fs.access(record.path).then(() => true).catch(() => false);
  if (!exists) { res.status(404).json({ error: "File no longer exists on disk" }); return; }

  res.setHeader("Content-Disposition", `attachment; filename="${record.originalName}"`);
  res.setHeader("Content-Type", record.mimeType);
  createReadStream(record.path).pipe(res);
});

router.delete("/delete/:id", optionalAuth, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid file ID" }); return; }

  const record = await db.query.uploadedFiles.findFirst({ where: eq(uploadedFiles.id, id) }).catch(() => null);
  if (!record) { res.status(404).json({ error: "File not found" }); return; }

  if (req.user && record.userId !== req.user.id) {
    res.status(403).json({ error: "Not authorized to delete this file" }); return;
  }

  const where = req.user
    ? and(eq(uploadedFiles.id, id), eq(uploadedFiles.userId, req.user.id))
    : eq(uploadedFiles.id, id);

  await fs.unlink(record.path).catch(() => {});
  await db.delete(uploadedFiles).where(where);
  res.json({ success: true, message: "File deleted" });
});

router.get("/list", optionalAuth, async (req, res) => {
  const userId = req.user?.id;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const limit = Math.min(50, parseInt(String(req.query.limit ?? "20")));
  const offset = (page - 1) * limit;

  const files = userId
    ? await db.query.uploadedFiles.findMany({ where: eq(uploadedFiles.userId, userId), limit, offset }).catch(() => [])
    : [];

  const host = req.get("host") || "localhost";
  const proto = req.secure ? "https" : "http";

  res.json({
    files: files.map((f) => ({
      id: f.id, originalName: f.originalName, mimeType: f.mimeType,
      size: formatBytes(f.size),
      downloadUrl: `${proto}://${host}/api/file/download/${f.id}`,
      createdAt: f.createdAt,
    })),
    total: files.length,
  });
});

router.post("/compress", async (req, res) => {
  const { fileId } = req.body;
  if (!fileId) { res.status(400).json({ error: "fileId required" }); return; }

  const record = await db.query.uploadedFiles.findFirst({ where: eq(uploadedFiles.id, parseInt(fileId)) }).catch(() => null);
  if (!record) { res.status(404).json({ error: "File not found" }); return; }

  const gzPath = record.path + ".gz";
  await new Promise<void>((resolve, reject) => {
    const gzip = createGzip();
    const src = createReadStream(record.path);
    const dest = createWriteStream(gzPath);
    src.pipe(gzip).pipe(dest).on("finish", resolve).on("error", reject);
  });

  const stat = await fs.stat(gzPath);
  res.json({
    success: true, compressed: true,
    originalSize: formatBytes(record.size),
    compressedSize: formatBytes(stat.size),
    ratio: ((1 - stat.size / record.size) * 100).toFixed(1) + "%",
    compressedPath: gzPath,
  });
});

export default router;
