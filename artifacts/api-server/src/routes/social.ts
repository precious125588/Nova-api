import { Router } from "express";
import ytdl from "@distube/ytdl-core";
import * as cache from "../lib/cache.js";

const router = Router();

async function fetchJson(url: string, options?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "application/json,*/*", ...options?.headers },
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json() as Promise<Record<string, unknown>>;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }

// TikTok — tikwm.com public API
router.post("/tiktok", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  const cacheKey = `tiktok:${url}`;
  const cached = cache.get(cacheKey);
  if (cached) { res.json(cached); return; }

  const data = await fetchJson(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`)
    .catch((e: Error) => { res.status(400).json({ error: "Failed to fetch TikTok info", details: e.message }); return null; });
  if (!data) return;

  if (Number(data.code) !== 0) { res.status(400).json({ error: data.msg || "TikTok download failed" }); return; }

  const d = obj(data.data);
  const author = obj(d.author);
  const result = {
    success: true, platform: "tiktok",
    title: d.title, author: author.nickname,
    duration: d.duration, thumbnail: d.cover,
    plays: d.play_count, likes: d.digg_count,
    downloads: { video_hd: d.hdplay || d.play, video_sd: d.play, audio: d.music, video_no_watermark: d.wmplay },
  };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

// YouTube Video
router.post("/youtube/video", async (req, res) => {
  const { url, quality = "720p" } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }
  if (!/youtube\.com|youtu\.be/.test(url)) { res.status(400).json({ error: "Invalid YouTube URL" }); return; }

  const info = await ytdl.getInfo(url).catch((e: Error) => { res.status(400).json({ error: e.message }); return null; });
  if (!info) return;

  const formats = info.formats
    .filter((f) => f.hasVideo && f.hasAudio)
    .map((f) => ({ quality: f.qualityLabel, url: f.url, container: f.container, size: f.contentLength }));

  const qualityMap: Record<string, string> = { best: "1080p", "720p": "720p", "480p": "480p", "360p": "360p" };
  const target = qualityMap[quality] || "720p";
  const chosen = formats.find((f) => f.quality?.includes(target.replace("p", ""))) || formats[0];

  res.json({
    success: true, platform: "youtube",
    title: info.videoDetails.title, author: info.videoDetails.author?.name,
    duration: info.videoDetails.lengthSeconds + "s",
    thumbnail: info.videoDetails.thumbnails?.at(-1)?.url,
    views: info.videoDetails.viewCount,
    selectedQuality: chosen?.quality, downloadUrl: chosen?.url,
    allFormats: formats.slice(0, 8),
  });
});

// YouTube Audio/MP3
router.post("/youtube/audio", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }
  if (!/youtube\.com|youtu\.be/.test(url)) { res.status(400).json({ error: "Invalid YouTube URL" }); return; }

  const info = await ytdl.getInfo(url).catch((e: Error) => { res.status(400).json({ error: e.message }); return null; });
  if (!info) return;

  const audioFormats = info.formats
    .filter((f) => f.hasAudio && !f.hasVideo)
    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));
  const best = audioFormats[0];
  res.json({
    success: true, platform: "youtube",
    title: info.videoDetails.title, author: info.videoDetails.author?.name,
    duration: info.videoDetails.lengthSeconds + "s",
    thumbnail: info.videoDetails.thumbnails?.at(-1)?.url,
    audioUrl: best?.url, bitrate: best?.audioBitrate ? best.audioBitrate + "kbps" : "unknown",
    container: best?.container, streamEndpoint: `/api/social/youtube/audio/stream?url=${encodeURIComponent(url)}`,
  });
});

// YouTube Audio Stream
router.get("/youtube/audio/stream", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") { res.status(400).json({ error: "url required" }); return; }
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Transfer-Encoding", "chunked");
  ytdl(url, { filter: "audioonly", quality: "highestaudio" }).pipe(res);
});

// Instagram — public oEmbed
router.post("/instagram", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  const cacheKey = `instagram:${url}`;
  const cached = cache.get(cacheKey);
  if (cached) { res.json(cached); return; }

  const oembed = await fetchJson(`https://api.instagram.com/oembed?url=${encodeURIComponent(url)}&omitscript=true`).catch(() => null);
  if (!oembed) {
    res.json({ success: false, platform: "instagram", message: "Instagram requires authentication for private posts.", url, hint: "Use Instagram Graph API with a user token for full media access." });
    return;
  }

  const result = { success: true, platform: "instagram", title: oembed.title, author: oembed.author_name, thumbnail: oembed.thumbnail_url, html: oembed.html, url };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

// Facebook — public video
router.post("/facebook", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  const oembed = await fetchJson(`https://www.facebook.com/plugins/video/oembed.json/?url=${encodeURIComponent(url)}`).catch(() => null);
  if (!oembed) {
    res.json({ success: false, platform: "facebook", message: "Could not fetch public Facebook video. Facebook requires app tokens for full media access.", hint: "Set FACEBOOK_ACCESS_TOKEN env var for authenticated access.", url });
    return;
  }
  res.json({ success: true, platform: "facebook", title: oembed.title, author: oembed.author_name, thumbnail: oembed.thumbnail_url, html: oembed.html });
});

// Twitter/X — requires Bearer token
router.post("/twitter", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  const BEARER = process.env.TWITTER_BEARER_TOKEN;
  const tweetId = url.match(/status\/(\d+)/)?.[1];
  if (!tweetId) { res.status(400).json({ error: "Invalid Twitter/X URL. Must contain a tweet ID." }); return; }

  if (!BEARER) {
    res.status(503).json({ success: false, platform: "twitter", error: "Twitter API requires a Bearer token", setup: "Set TWITTER_BEARER_TOKEN environment variable", docs: "https://developer.twitter.com/en/docs/authentication/oauth-2-0/bearer-tokens" });
    return;
  }

  const data = await fetchJson(
    `https://api.twitter.com/2/tweets/${tweetId}?expansions=attachments.media_keys&media.fields=url,preview_image_url,duration_ms,type`,
    { headers: { Authorization: `Bearer ${BEARER}` } }
  ).catch((e: Error) => { res.status(400).json({ error: e.message }); return null; });
  if (!data) return;

  const includes = obj(data.includes);
  const media = arr<Record<string, unknown>>(includes.media)[0];
  const dataObj = obj(data.data);
  res.json({ success: true, platform: "twitter", tweetId, text: dataObj.text, mediaType: media?.type, mediaUrl: media?.url || media?.preview_image_url, duration: media?.duration_ms });
});

// Pinterest — oEmbed
router.post("/pinterest", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  const data = await fetchJson(`https://www.pinterest.com/oembed.json?url=${encodeURIComponent(url)}`)
    .catch((e: Error) => { res.status(400).json({ error: "Could not fetch Pinterest pin", details: e.message }); return null; });
  if (!data) return;

  res.json({ success: true, platform: "pinterest", title: data.title, author: data.author_name, thumbnail: data.thumbnail_url, html: data.html });
});

// SoundCloud — public oEmbed
router.post("/soundcloud", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  const data = await fetchJson(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`)
    .catch((e: Error) => { res.status(400).json({ error: "Could not fetch SoundCloud track", details: e.message }); return null; });
  if (!data) return;

  res.json({ success: true, platform: "soundcloud", title: data.title, author: data.author_name, description: data.description, thumbnail: data.thumbnail_url, duration: data.duration, html: data.html });
});

// Threads — Meta oEmbed
router.post("/threads", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  const data = await fetchJson(`https://www.threads.net/oembed?url=${encodeURIComponent(url)}`)
    .catch((e: Error) => { res.status(400).json({ error: "Could not fetch Threads post", details: e.message }); return null; });
  if (!data) return;

  res.json({ success: true, platform: "threads", title: data.title, author: data.author_name, thumbnail: data.thumbnail_url, html: data.html });
});

export default router;
