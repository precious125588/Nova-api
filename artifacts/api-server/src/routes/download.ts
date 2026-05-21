import { Router } from "express";
import ytdl from "@distube/ytdl-core";
import * as cache from "../lib/cache.js";

const router = Router();

const QUALITY_MAP: Record<string, string> = {
  best: "highestvideo",
  "144p": "144p", "360p": "360p", "480p": "480p",
  "720p": "720p", "1080p": "1080p", "2k": "1440p", "4k": "2160p",
};
const QUALITY_FALLBACK = ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"];

function isYouTubeUrl(url: string) {
  return /youtube\.com|youtu\.be/.test(url);
}

async function getVideoInfo(url: string) {
  const cacheKey = `video_info:${url}`;
  const cached = cache.get<Awaited<ReturnType<typeof ytdl.getInfo>>>(cacheKey);
  if (cached) return cached;
  const info = await ytdl.getInfo(url);
  cache.set(cacheKey, info, 300);
  return info;
}

router.post("/", async (req, res) => {
  const { url, quality = "best", format = "mp4", mode = "download" } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }
  if (!isYouTubeUrl(url)) {
    res.status(400).json({ error: "Currently supports YouTube URLs. Use /api/tiktok, /api/instagram etc. for other platforms." });
    return;
  }

  const info = await getVideoInfo(url).catch((e: Error) => {
    res.status(400).json({ error: "Failed to fetch video info", details: e.message }); return null;
  });
  if (!info) return;

  const qtag = QUALITY_MAP[quality] || "highestvideo";
  const videoFormat = ytdl.chooseFormat(info.formats, {
    quality: qtag as "highestvideo",
    filter: format === "mp3" ? "audioonly" : "videoandaudio",
  });

  const filename = `${info.videoDetails.title.replace(/[^a-zA-Z0-9]/g, "_")}.${format === "mp3" ? "mp3" : "mp4"}`;
  res.setHeader("Content-Disposition", `${mode === "stream" ? "inline" : "attachment"}; filename="${filename}"`);
  res.setHeader("Content-Type", format === "mp3" ? "audio/mpeg" : "video/mp4");
  ytdl(url, { quality: qtag as "highestvideo", format: videoFormat }).pipe(res);
});

router.get("/info", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") { res.status(400).json({ error: "url query param required" }); return; }
  if (!isYouTubeUrl(url)) { res.status(400).json({ error: "Currently supports YouTube URLs" }); return; }

  const info = await getVideoInfo(url).catch((e: Error) => { res.status(400).json({ error: e.message }); return null; });
  if (!info) return;

  res.json({
    title: info.videoDetails.title,
    author: info.videoDetails.author?.name,
    description: info.videoDetails.description,
    duration: info.videoDetails.lengthSeconds,
    views: info.videoDetails.viewCount,
    thumbnail: info.videoDetails.thumbnails?.at(-1)?.url,
    uploadDate: info.videoDetails.uploadDate,
    isLive: info.videoDetails.isLiveContent,
    formats: info.formats.slice(0, 10).map((f) => ({
      quality: f.qualityLabel, container: f.container,
      hasAudio: !!f.audioBitrate, hasVideo: !!f.qualityLabel,
      contentLength: f.contentLength,
    })),
  });
});

router.get("/metadata", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") { res.status(400).json({ error: "url query param required" }); return; }
  if (!isYouTubeUrl(url)) { res.status(400).json({ error: "Currently supports YouTube URLs" }); return; }

  const info = await getVideoInfo(url).catch((e: Error) => { res.status(400).json({ error: e.message }); return null; });
  if (!info) return;

  res.json({
    id: info.videoDetails.videoId, title: info.videoDetails.title,
    author: info.videoDetails.author, keywords: info.videoDetails.keywords,
    category: info.videoDetails.category, publishDate: info.videoDetails.publishDate,
    likes: info.videoDetails.likes, isFamilySafe: info.videoDetails.isFamilySafe,
    availableCountries: info.videoDetails.availableCountries?.slice(0, 20),
  });
});

router.get("/stream", async (req, res) => {
  const { url, quality = "best" } = req.query;
  if (!url || typeof url !== "string") { res.status(400).json({ error: "url query param required" }); return; }
  if (!isYouTubeUrl(url)) { res.status(400).json({ error: "Currently supports YouTube URLs" }); return; }

  const qtag = QUALITY_MAP[quality as string] || "highestvideo";
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Transfer-Encoding", "chunked");
  ytdl(url, { quality: qtag as "highestvideo" }).pipe(res);
});

router.get("/formats", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") { res.status(400).json({ error: "url query param required" }); return; }

  const info = await getVideoInfo(url).catch((e: Error) => { res.status(400).json({ error: e.message }); return null; });
  if (!info) return;

  const formats = info.formats.map((f) => ({
    itag: f.itag, quality: f.qualityLabel || "audio", container: f.container, codecs: f.codecs,
    bitrate: f.bitrate, hasAudio: !!f.audioBitrate, hasVideo: !!f.qualityLabel,
    contentLength: f.contentLength,
    approxSizeMB: f.contentLength ? (parseInt(f.contentLength) / 1024 / 1024).toFixed(1) + "MB" : "unknown",
  }));
  res.json({ title: info.videoDetails.title, formats });
});

router.get("/fallback-quality", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") { res.status(400).json({ error: "url query param required" }); return; }

  const info = await getVideoInfo(url).catch((e: Error) => { res.status(400).json({ error: e.message }); return null; });
  if (!info) return;

  const availableQualities = info.formats.filter((f) => f.qualityLabel).map((f) => f.qualityLabel);
  const bestAvailable = QUALITY_FALLBACK.find((q) => availableQualities.some((aq) => aq?.includes(q.replace("p", ""))));
  res.json({ requested: "best", bestAvailable: bestAvailable || "360p", availableQualities: [...new Set(availableQualities)] });
});

export default router;
