/**
 * MUSIC / SONGS — real media file downloads
 * YouTube Music, SoundCloud, Spotify previews, and generic audio extractor
 */
import { Router } from "express";
import ytdl from "@distube/ytdl-core";
import * as cache from "../lib/cache.js";

const router = Router();

async function fetchJson(url: string, headers?: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "application/json", ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function getJson(url: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, init);
    if (!r.ok) return null;
    return r.json() as Promise<Record<string, unknown>>;
  } catch { return null; }
}

function arr<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }
function obj(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; }

// ─── YouTube Music / YouTube audio ────────────────────────────────────────────
router.post("/youtube", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url required" }); return; }
  if (!/youtube\.com|youtu\.be/.test(url)) { res.status(400).json({ error: "Invalid YouTube URL" }); return; }

  const cacheKey = `yt_audio:${url}`;
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) { res.json(cached); return; }

  const info = await ytdl.getInfo(url).catch((e: Error) => {
    res.status(400).json({ error: "Could not fetch audio info", details: e.message }); return null;
  });
  if (!info) return;

  const audioFormats = info.formats
    .filter((f) => f.hasAudio && !f.hasVideo)
    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));

  const best = audioFormats[0];
  const result = {
    success: true, platform: "youtube", type: "audio",
    title: info.videoDetails.title, artist: info.videoDetails.author?.name,
    duration: info.videoDetails.lengthSeconds + "s",
    thumbnail: info.videoDetails.thumbnails?.at(-1)?.url,
    downloadUrl: best?.url,
    bitrate: best?.audioBitrate ? best.audioBitrate + "kbps" : "unknown",
    container: best?.container || "webm",
    allQualities: audioFormats.slice(0, 5).map((f) => ({ bitrate: f.audioBitrate + "kbps", container: f.container, url: f.url })),
    streamEndpoint: `/api/music/youtube/stream?url=${encodeURIComponent(url)}`,
  };
  cache.set(cacheKey, result, 300);
  res.json(result);
});

router.get("/youtube/stream", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") { res.status(400).json({ error: "url required" }); return; }
  if (!/youtube\.com|youtu\.be/.test(url)) { res.status(400).json({ error: "Invalid YouTube URL" }); return; }
  const info = await ytdl.getInfo(url).catch(() => null);
  const title = info?.videoDetails?.title?.replace(/[^a-zA-Z0-9 ]/g, "") || "audio";
  res.setHeader("Content-Type", "audio/webm");
  res.setHeader("Content-Disposition", `attachment; filename="${title}.webm"`);
  res.setHeader("Transfer-Encoding", "chunked");
  ytdl(url, { filter: "audioonly", quality: "highestaudio" }).pipe(res);
});

// ─── SoundCloud ────────────────────────────────────────────────────────────────
router.post("/soundcloud", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url required" }); return; }

  const cacheKey = `sc_audio:${url}`;
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) { res.json(cached); return; }

  const oembed = await getJson(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`);
  const SC_CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;
  let streamUrl: string | null = null;
  let trackData: Record<string, unknown> | null = null;

  if (SC_CLIENT_ID) {
    trackData = await fetchJson(`https://api.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${SC_CLIENT_ID}`).catch(() => null);
    if (trackData?.stream_url) {
      const streamData = await fetchJson(`${trackData.stream_url}?client_id=${SC_CLIENT_ID}`).catch(() => null);
      streamUrl = String(streamData?.location || "") || null;
    }
  }

  const td = obj(trackData);
  const result = {
    success: true, platform: "soundcloud",
    title: String(oembed?.title || td.title || ""),
    artist: String(oembed?.author_name || obj(td.user).username || ""),
    duration: td.duration,
    thumbnail: String(oembed?.thumbnail_url || td.artwork_url || ""),
    genre: td.genre, plays: td.playback_count, likes: td.likes_count,
    downloadUrl: streamUrl,
    embedHtml: oembed?.html,
    note: !SC_CLIENT_ID ? "Set SOUNDCLOUD_CLIENT_ID env var for direct stream download" : undefined,
  };
  cache.set(cacheKey, result, 300);
  res.json(result);
});

// ─── Spotify (preview + track info) ──────────────────────────────────────────
router.post("/spotify", async (req, res) => {
  const { url, trackId } = req.body;
  if (!url && !trackId) { res.status(400).json({ error: "url or trackId required" }); return; }

  let id = trackId;
  if (!id && url) {
    id = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/)?.[1];
    if (!id) { res.status(400).json({ error: "Invalid Spotify track URL" }); return; }
  }

  const cacheKey = `spotify:${id}`;
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) { res.json(cached); return; }

  const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    const oembed = await getJson(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${id}`);
    res.json({
      success: !!oembed, platform: "spotify", trackId: id,
      title: oembed?.title, thumbnail: oembed?.thumbnail_url, embedHtml: oembed?.html,
      previewUrl: null,
      note: "Set SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET for full track info and 30s preview",
    });
    return;
  }

  const tokenRes = await getJson("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!tokenRes?.access_token) { res.status(503).json({ error: "Failed to get Spotify access token" }); return; }

  const track = await fetchJson(`https://api.spotify.com/v1/tracks/${id}`, {
    Authorization: `Bearer ${String(tokenRes.access_token)}`,
  }).catch((e: Error) => { res.status(400).json({ error: e.message }); return null; });
  if (!track) return;

  const album = obj(track.album);
  const images = arr<Record<string, unknown>>(album.images);
  const result = {
    success: true, platform: "spotify", trackId: id,
    title: track.name,
    artists: arr<Record<string, unknown>>(track.artists).map((a) => String(a.name)),
    album: album.name, releaseDate: album.release_date,
    duration: track.duration_ms,
    thumbnail: images[0]?.url,
    previewUrl: track.preview_url,
    popularity: track.popularity, explicit: track.explicit,
    openUrl: obj(track.external_urls).spotify,
    note: track.preview_url ? "30s preview available at previewUrl" : "No preview for this track",
  };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

router.get("/spotify/preview/:trackId", async (req, res) => {
  const { trackId } = req.params;
  const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) { res.status(503).json({ error: "Set SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET" }); return; }

  const tokenRes = await getJson("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tokenRes?.access_token) { res.status(503).json({ error: "Auth failed" }); return; }

  const track = await fetchJson(`https://api.spotify.com/v1/tracks/${trackId}`, {
    Authorization: `Bearer ${String(tokenRes.access_token)}`,
  }).catch(() => null);
  if (!track?.preview_url) { res.status(404).json({ error: "No preview for this track" }); return; }

  const audioRes = await fetch(String(track.preview_url)).catch(() => null);
  if (!audioRes?.ok) { res.status(502).json({ error: "Failed to fetch preview audio" }); return; }

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", `attachment; filename="${String(track.name || trackId)}.mp3"`);
  (audioRes.body as unknown as NodeJS.ReadableStream).pipe(res as unknown as NodeJS.WritableStream);
});

// ─── Apple Music (oEmbed info) ────────────────────────────────────────────────
router.post("/apple-music", async (req, res) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: "url required" }); return; }
  const oembed = await getJson(`https://music.apple.com/oembed?url=${encodeURIComponent(url)}`);
  if (!oembed) { res.status(400).json({ error: "Could not fetch Apple Music oEmbed" }); return; }
  res.json({
    success: true, platform: "apple_music",
    title: oembed.title, artist: oembed.author_name,
    thumbnail: oembed.thumbnail_url, embedHtml: oembed.html, url,
    note: "Apple Music requires subscription for full tracks. Embed player available via embedHtml.",
  });
});

// ─── Last.fm — song info + similar tracks ─────────────────────────────────────
router.post("/lastfm/info", async (req, res) => {
  const { artist, track } = req.body;
  if (!artist || !track) { res.status(400).json({ error: "artist and track required" }); return; }

  const LASTFM_KEY = process.env.LASTFM_API_KEY;
  if (!LASTFM_KEY) {
    res.json({ success: false, message: "Set LASTFM_API_KEY", hint: "Get a free key at https://www.last.fm/api/account/create" }); return;
  }

  const cacheKey = `lastfm:${artist}:${track}`;
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) { res.json(cached); return; }

  const data = await fetchJson(`https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${LASTFM_KEY}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&format=json`).catch(() => null);
  if (!data?.track) { res.status(404).json({ error: "Track not found on Last.fm" }); return; }

  const t = obj(data.track);
  const tArtist = obj(t.artist);
  const tAlbum = obj(t.album);
  const tWiki = obj(t.wiki);
  const tTags = obj(t.toptags);
  const result = {
    success: true, platform: "lastfm",
    title: t.name, artist: tArtist.name,
    album: tAlbum.title, duration: t.duration,
    plays: t.playcount, listeners: t.listeners,
    tags: arr<Record<string, unknown>>(tTags.tag).map((tag) => String(tag.name)),
    summary: String(tWiki.summary || "").replace(/<[^>]+>/g, "").slice(0, 300),
    url: t.url,
  };
  cache.set(cacheKey, result, 3600);
  res.json(result);
});

// ─── Universal music search (iTunes — free, no key needed) ────────────────────
router.get("/search", async (req, res) => {
  const { q, limit = "10" } = req.query;
  if (!q) { res.status(400).json({ error: "q query param required" }); return; }

  const cacheKey = `music_search:${q}:${limit}`;
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) { res.json(cached); return; }

  const data = await fetchJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(String(q))}&media=music&limit=${limit}&entity=song`
  ).catch((e: Error) => { res.status(400).json({ error: e.message }); return null; });
  if (!data) return;

  const results = arr<Record<string, unknown>>(data.results).map((r) => ({
    trackId: r.trackId, title: r.trackName, artist: r.artistName,
    album: r.collectionName, duration: r.trackTimeMillis,
    genre: r.primaryGenreName, releaseDate: r.releaseDate,
    thumbnail: String(r.artworkUrl100 || "").replace("100x100", "600x600"),
    previewUrl: r.previewUrl, country: r.country,
  }));

  const result = { success: true, source: "iTunes", total: data.resultCount, results };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

// ─── Download iTunes 30s preview (free, no auth) ─────────────────────────────
router.get("/preview/:trackId", async (req, res) => {
  const { trackId } = req.params;
  const cacheKey = `itunes_preview:${trackId}`;
  const cached = cache.get<string>(cacheKey);

  let previewUrl: string | null = cached ?? null;
  if (!previewUrl) {
    const data = await getJson(`https://itunes.apple.com/lookup?id=${trackId}&entity=song`);
    const results = arr<Record<string, unknown>>(data?.results);
    previewUrl = String(results[0]?.previewUrl || "") || null;
    if (!previewUrl) { res.status(404).json({ error: "Preview not available for this track" }); return; }
    cache.set(cacheKey, previewUrl, 3600);
  }

  const audioRes = await fetch(previewUrl).catch(() => null);
  if (!audioRes?.ok) { res.status(502).json({ error: "Could not fetch preview audio" }); return; }
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Disposition", `attachment; filename="preview_${trackId}.mp3"`);
  (audioRes.body as unknown as NodeJS.ReadableStream).pipe(res as unknown as NodeJS.WritableStream);
});

export default router;
