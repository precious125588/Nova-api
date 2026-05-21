import { Router } from "express";
import * as cache from "../lib/cache.js";

const router = Router();

async function getHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

function extractM3u8(html: string): string | null {
  const patterns = [
    /videoUrl\s*[:=]\s*["']([^"']+\.m3u8[^"']*)/,
    /hlsManifest\s*[:=]\s*["']([^"']+\.m3u8[^"']*)/,
    /"hls"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/,
    /setVideoHLS\(['"]([^'"]+\.m3u8[^'"]*)['"]\)/,
    /flashvars\.hls_url\s*=\s*["']([^"']+)/,
    /player_mp4_url\s*=\s*["']([^"']+)/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return decodeURIComponent(m[1].replace(/\\/g, ""));
  }
  return null;
}

function extractMp4Urls(html: string): string[] {
  const results: string[] = [];
  const patterns = [/["']([^"']*quality_[^"']*\.mp4[^"']*)/g, /["']([^"']+\.mp4[^"']*)/g];
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(html)) !== null) {
      if (m[1] && !results.includes(m[1])) results.push(m[1]);
      if (results.length > 10) break;
    }
    p.lastIndex = 0;
  }
  return results;
}

// XVideos
router.post("/xvideos", async (req, res) => {
  const { url, videoId } = req.body;
  if (!url && !videoId) { res.status(400).json({ error: "url or videoId required" }); return; }
  let id = videoId;
  if (!id && url) {
    const match = url.match(/xvideos\.com\/video(\d+)\//);
    if (!match) { res.status(400).json({ error: "Invalid XVideos URL" }); return; }
    id = match[1];
  }

  const cacheKey = `xv:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) { res.json(cached); return; }

  const html = await getHtml(`https://www.xvideos.com/video${id}/x`).catch((e: Error) => {
    res.status(400).json({ error: "Could not fetch video page", details: e.message }); return null;
  });
  if (!html) return;

  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch?.[1]?.replace(" - XVIDEOS.COM", "").trim() || "Unknown";
  const thumbMatch = html.match(/setThumbUrl\(['"]([^'"]+)['"]\)/);
  const hlsUrl = extractM3u8(html);
  const mp4Urls = extractMp4Urls(html);
  const lowMatch = html.match(/url_low\s*[:=]\s*["']([^"']+)/);
  const highMatch = html.match(/url_high\s*[:=]\s*["']([^"']+)/);

  const result = {
    success: true, platform: "xvideos", videoId: id, title,
    thumbnail: thumbMatch?.[1],
    streams: { hls: hlsUrl, mp4_low: lowMatch?.[1], mp4_high: highMatch?.[1], mp4_urls: mp4Urls.slice(0, 5) },
    watchUrl: `https://www.xvideos.com/video${id}/`,
  };
  if (hlsUrl || mp4Urls.length > 0) cache.set(cacheKey, result, 600);
  res.json(result);
});

// RedTube
router.post("/redtube", async (req, res) => {
  const { url, videoId } = req.body;
  if (!url && !videoId) { res.status(400).json({ error: "url or videoId required" }); return; }
  let id = videoId;
  if (!id && url) {
    const match = url.match(/redtube\.com\/(\d+)/);
    if (!match) { res.status(400).json({ error: "Invalid RedTube URL" }); return; }
    id = match[1];
  }

  const cacheKey = `rt:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) { res.json(cached); return; }

  const data = await getJson(`https://api.redtube.com/?data=redtube.Videos.getVideoById&id=${id}&output=json&thumbsize=medium`)
    .catch((e: Error) => { res.status(400).json({ error: "RedTube API failed", details: e.message }); return null; });
  if (!data) return;

  if (data.error) { res.status(400).json({ error: String(data.error) }); return; }

  const v = data.video as Record<string, unknown>;
  const result = {
    success: true, platform: "redtube", videoId: id,
    title: v?.title, duration: v?.duration, views: v?.views, ratings: v?.ratings,
    thumbnail: v?.thumb,
    tags: (v?.tags as { tag: string }[])?.map((t) => t.tag),
    watchUrl: `https://www.redtube.com/${id}`,
    embedUrl: v?.embed_url,
  };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

// Pornhub
router.post("/pornhub", async (req, res) => {
  const { url, videoId } = req.body;
  if (!url && !videoId) { res.status(400).json({ error: "url or videoId required" }); return; }
  let id = videoId;
  if (!id && url) {
    const match = url.match(/viewkey=([a-zA-Z0-9]+)/);
    if (!match) { res.status(400).json({ error: "Invalid Pornhub URL. Must contain viewkey." }); return; }
    id = match[1];
  }

  const cacheKey = `ph:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) { res.json(cached); return; }

  const data = await getJson(`https://www.pornhub.com/webmasters/video_by_id?id=${id}&thumbsize=medium`)
    .catch((e: Error) => { res.status(400).json({ error: "Pornhub API failed", details: e.message }); return null; });
  if (!data) return;

  if (data.code && data.code !== "0") {
    res.status(400).json({ error: String(data.message) || "Video not found" }); return;
  }

  const v = data.video as Record<string, unknown>;
  const thumbs = v?.thumbs as { src?: string }[];
  const mediaDefs = v?.mediaDefinitions as { quality?: string; videoUrl?: string }[];
  const result = {
    success: true, platform: "pornhub", videoId: id,
    title: v?.title, duration: v?.duration, views: v?.views,
    thumbnail: thumbs?.[0]?.src,
    tags: (v?.tags as { tag_name: string }[])?.map((t) => t.tag_name),
    watchUrl: `https://www.pornhub.com/view_video.php?viewkey=${id}`,
    embedUrl: v?.embed,
    videoStreams: mediaDefs?.filter((m) => m.videoUrl).map((m) => ({ quality: m.quality, url: m.videoUrl })),
  };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

// xHamster
router.post("/xhamster", async (req, res) => {
  const { url, videoId } = req.body;
  if (!url && !videoId) { res.status(400).json({ error: "url or videoId required" }); return; }
  let id = videoId;
  if (!id && url) {
    const match = url.match(/xhamster\.[a-z]+\/videos\/[^-]+-(\d+)/);
    if (!match) { res.status(400).json({ error: "Invalid xHamster URL" }); return; }
    id = match[1];
  }

  const cacheKey = `xh:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) { res.json(cached); return; }

  const data = await getJson(`https://xhamster.com/api/front/video/${id}`).catch(() => null);

  if (!data) {
    const html = await getHtml(`https://xhamster.com/videos/${id}`).catch(() => null);
    if (!html) { res.status(400).json({ error: "Could not fetch xHamster video" }); return; }
    const hlsUrl = extractM3u8(html);
    const mp4 = extractMp4Urls(html);
    const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/);
    res.json({ success: true, platform: "xhamster", videoId: id, title: titleM?.[1], streams: { hls: hlsUrl, mp4: mp4.slice(0, 3) } });
    return;
  }

  const result = {
    success: true, platform: "xhamster", videoId: id,
    title: data.title, duration: data.duration, views: data.views,
    thumbnail: data.thumbURL,
    streams: (data.sources as Record<string, unknown>)?.mp4 || (data.xplayer as Record<string, unknown>)?.sources,
    watchUrl: `https://xhamster.com/videos/${id}`,
  };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

// YouPorn
router.post("/youporn", async (req, res) => {
  const { url, videoId } = req.body;
  if (!url && !videoId) { res.status(400).json({ error: "url or videoId required" }); return; }
  let id = videoId;
  if (!id && url) {
    const match = url.match(/youporn\.com\/watch\/(\d+)/);
    if (!match) { res.status(400).json({ error: "Invalid YouPorn URL" }); return; }
    id = match[1];
  }

  const cacheKey = `yp:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) { res.json(cached); return; }

  const data = await getJson(`https://www.youporn.com/api/video/media_definitions/?id=${id}`).catch(() => null);
  const result = { success: !!data, platform: "youporn", videoId: id, streams: data, watchUrl: `https://www.youporn.com/watch/${id}/` };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

// SpankBang
router.post("/spankbang", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  const cacheKey = `sb:${url}`;
  const cached = cache.get(cacheKey);
  if (cached) { res.json(cached); return; }

  const html = await getHtml(url).catch((e: Error) => {
    res.status(400).json({ error: "Failed to fetch", details: e.message }); return null;
  });
  if (!html) return;

  const mp4_480 = html.match(/480p["']?\s*,\s*url:\s*["']([^"']+)/)?.[1];
  const mp4_720 = html.match(/720p["']?\s*,\s*url:\s*["']([^"']+)/)?.[1];
  const mp4_1080 = html.match(/1080p["']?\s*,\s*url:\s*["']([^"']+)/)?.[1];
  const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/);
  const thumbM = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);

  const result = {
    success: true, platform: "spankbang", url,
    title: titleM?.[1], thumbnail: thumbM?.[1],
    streams: { hls: extractM3u8(html), "480p": mp4_480, "720p": mp4_720, "1080p": mp4_1080 },
  };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

// Generic scraper
router.post("/scrape", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url is required" }); return; }

  const supported = ["xvideos.com", "xhamster.com", "redtube.com", "pornhub.com", "youporn.com", "spankbang.com", "xnxx.com"];
  const domain = new URL(url).hostname.replace("www.", "");
  if (!supported.some((s) => domain.includes(s))) {
    res.status(400).json({ error: `Unsupported domain: ${domain}`, supported }); return;
  }

  const cacheKey = `scrape:${url}`;
  const cached = cache.get(cacheKey);
  if (cached) { res.json(cached); return; }

  const html = await getHtml(url).catch((e: Error) => {
    res.status(400).json({ error: "Failed to fetch page", details: e.message }); return null;
  });
  if (!html) return;

  const hlsUrl = extractM3u8(html);
  const mp4Urls = extractMp4Urls(html);
  const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/);
  const thumbM = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);

  if (!hlsUrl && mp4Urls.length === 0) {
    res.json({ success: false, platform: domain, url, message: "No direct media URLs found. Site may require cookies or login." });
    return;
  }

  const result = { success: true, platform: domain, url, title: titleM?.[1], thumbnail: thumbM?.[1], streams: { hls: hlsUrl, mp4: mp4Urls.slice(0, 5) } };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

export default router;
