/**
 * MOVIES — real media info + downloads
 * TMDB for info, Archive.org for public domain movies, general scraper
 */
import { Router } from "express";
import * as cache from "../lib/cache.js";
import ytdl from "@distube/ytdl-core";

const router = Router();

async function fetchJson(url: string, headers?: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json() as Promise<Record<string, unknown>>;
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function obj(v: unknown): Record<string, unknown> {
  return (v && typeof v === "object" && !Array.isArray(v)) ? (v as Record<string, unknown>) : {};
}

// ─── TMDB — movie info ────────────────────────────────────────────────────────
router.get("/info/:id", async (req, res) => {
  const { id } = req.params;
  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_KEY) {
    res.json({ success: false, message: "Set TMDB_API_KEY for movie info. Get a free key at https://www.themoviedb.org/settings/api", movieId: id });
    return;
  }

  const cacheKey = `tmdb_movie:${id}`;
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) { res.json(cached); return; }

  const [movie, credits, videos] = await Promise.all([
    fetchJson(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}&language=en-US`).catch(() => null),
    fetchJson(`https://api.themoviedb.org/3/movie/${id}/credits?api_key=${TMDB_KEY}`).catch(() => null),
    fetchJson(`https://api.themoviedb.org/3/movie/${id}/videos?api_key=${TMDB_KEY}`).catch(() => null),
  ]);

  if (!movie) { res.status(404).json({ error: "Movie not found" }); return; }

  type TrailerItem = { type: string; site: string; key: string };
  const trailer = arr<TrailerItem>(videos?.results).find((v) => v.type === "Trailer" && v.site === "YouTube");

  const result = {
    success: true, id: movie.id, title: movie.title, originalTitle: movie.original_title,
    overview: movie.overview, releaseDate: movie.release_date,
    runtime: movie.runtime ? `${movie.runtime} min` : null,
    genres: arr<{ name: string }>(movie.genres).map((g) => g.name),
    rating: movie.vote_average, votes: movie.vote_count,
    poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
    backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : null,
    budget: movie.budget, revenue: movie.revenue, tagline: movie.tagline,
    status: movie.status, language: movie.original_language,
    cast: arr<{ name: string; character: string }>(credits?.cast).slice(0, 10).map((a) => ({ name: a.name, character: a.character })),
    director: arr<{ job: string; name: string }>(credits?.crew).find((c) => c.job === "Director")?.name,
    trailer: trailer ? { youtubeId: trailer.key, url: `https://www.youtube.com/watch?v=${trailer.key}`, downloadUrl: `/api/movies/trailer/${trailer.key}` } : null,
  };
  cache.set(cacheKey, result, 3600);
  res.json(result);
});

// ─── TMDB search ──────────────────────────────────────────────────────────────
router.get("/search", async (req, res) => {
  const { q, page = "1", year } = req.query;
  if (!q) { res.status(400).json({ error: "q query param required" }); return; }
  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_KEY) { res.json({ success: false, message: "Set TMDB_API_KEY for movie search" }); return; }

  const cacheKey = `tmdb_search:${q}:${page}:${year}`;
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) { res.json(cached); return; }

  const yearParam = year ? `&year=${year}` : "";
  const data = await fetchJson(
    `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(String(q))}&page=${page}${yearParam}`
  ).catch((e: Error) => { res.status(400).json({ error: e.message }); return null; });
  if (!data) return;

  const result = {
    success: true,
    total: data.total_results, pages: data.total_pages, page: data.page,
    movies: arr<Record<string, unknown>>(data.results).map((m) => ({
      id: m.id, title: m.title, releaseDate: m.release_date, rating: m.vote_average,
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
      overview: String(m.overview || "").slice(0, 200),
    })),
  };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

// ─── Download movie trailer (YouTube) ────────────────────────────────────────
router.get("/trailer/:youtubeId", async (req, res) => {
  const { youtubeId } = req.params;
  const { mode = "info" } = req.query;
  const url = `https://www.youtube.com/watch?v=${youtubeId}`;

  const info = await ytdl.getInfo(url).catch((e: Error) => {
    res.status(400).json({ error: "Could not fetch trailer", details: e.message }); return null;
  });
  if (!info) return;

  if (mode === "stream") {
    const title = info.videoDetails.title.replace(/[^a-zA-Z0-9 ]/g, "");
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${title}.mp4"`);
    ytdl(url, { quality: "18" }).pipe(res);
    return;
  }

  const formats = info.formats
    .filter((f) => f.hasVideo && f.hasAudio)
    .map((f) => ({ quality: f.qualityLabel, container: f.container, url: f.url }));

  res.json({
    success: true, title: info.videoDetails.title,
    thumbnail: info.videoDetails.thumbnails?.at(-1)?.url,
    duration: info.videoDetails.lengthSeconds + "s",
    formats: formats.slice(0, 5),
    streamUrl: `/api/movies/trailer/${youtubeId}?mode=stream`,
  });
});

// ─── Archive.org — public domain / free full movies ──────────────────────────
router.get("/archive/search", async (req, res) => {
  const { q, limit = "10" } = req.query;
  if (!q) { res.status(400).json({ error: "q query param required" }); return; }

  const cacheKey = `archive_search:${q}:${limit}`;
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) { res.json(cached); return; }

  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`${q} mediatype:movies`)}&fl[]=identifier,title,description,year,creator,downloads&rows=${limit}&output=json`;
  const data = await fetchJson(url).catch((e: Error) => {
    res.status(400).json({ error: e.message }); return null;
  });
  if (!data) return;

  const response = obj(data.response);
  const docs = arr<Record<string, unknown>>(response.docs);
  const result = {
    success: true, source: "archive.org (Public Domain Movies — Free to Download)",
    total: response.numFound,
    movies: docs.map((d) => ({
      identifier: d.identifier, title: d.title, year: d.year, creator: d.creator,
      description: String(d.description || "").slice(0, 200),
      downloads: d.downloads,
      watchUrl: `https://archive.org/details/${d.identifier}`,
      downloadUrl: `/api/movies/archive/download/${d.identifier}`,
      metadataUrl: `/api/movies/archive/info/${d.identifier}`,
    })),
  };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

// Get archive.org movie info + download links
router.get("/archive/info/:identifier", async (req, res) => {
  const { identifier } = req.params;
  const cacheKey = `archive_info:${identifier}`;
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) { res.json(cached); return; }

  const metadata = await fetchJson(`https://archive.org/metadata/${identifier}`).catch((e: Error) => {
    res.status(400).json({ error: e.message }); return null;
  });
  if (!metadata) return;

  const files = arr<Record<string, unknown>>(metadata.files)
    .filter((f) => /\.(mp4|avi|mkv|ogv|mpg|webm|mov)$/i.test(String(f.name || "")))
    .map((f) => ({
      name: f.name, format: f.format,
      size: f.size ? Math.round(parseInt(String(f.size)) / 1024 / 1024) + "MB" : "unknown",
      downloadUrl: `https://archive.org/download/${identifier}/${encodeURIComponent(String(f.name || ""))}`,
    }));

  const meta = obj(metadata.metadata);
  const result = {
    success: true, identifier,
    title: meta.title, year: meta.year, creator: meta.creator,
    subject: meta.subject, description: String(meta.description || "").slice(0, 500),
    license: meta.licenseurl, watchUrl: `https://archive.org/details/${identifier}`,
    videoFiles: files,
  };
  cache.set(cacheKey, result, 3600);
  res.json(result);
});

// Download archive.org file — stream to client
router.get("/archive/download/:identifier/:filename", async (req, res) => {
  const { identifier, filename } = req.params;
  const fileUrl = `https://archive.org/download/${identifier}/${encodeURIComponent(filename)}`;

  const headRes = await fetch(fileUrl, { method: "HEAD" }).catch(() => null);
  if (!headRes?.ok) { res.status(404).json({ error: "File not found on archive.org" }); return; }

  const contentType = headRes.headers.get("content-type") || "video/mp4";
  const contentLength = headRes.headers.get("content-length");

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  if (contentLength) res.setHeader("Content-Length", contentLength);

  const fileRes = await fetch(fileUrl).catch(() => null);
  if (!fileRes?.ok) { res.status(502).json({ error: "Failed to stream file" }); return; }
  (fileRes.body as unknown as NodeJS.ReadableStream).pipe(res as unknown as NodeJS.WritableStream);
});

// ─── Popular movies (TMDB) ────────────────────────────────────────────────────
router.get("/popular", async (req, res) => {
  const { page = "1" } = req.query;
  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_KEY) { res.json({ success: false, message: "Set TMDB_API_KEY", getKey: "https://www.themoviedb.org/settings/api" }); return; }

  const cacheKey = `tmdb_popular:${page}`;
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) { res.json(cached); return; }

  const data = await fetchJson(`https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}&page=${page}`).catch(() => null);
  if (!data) { res.status(400).json({ error: "Failed to fetch popular movies" }); return; }

  const result = {
    success: true, page: data.page, total: data.total_results,
    movies: arr<Record<string, unknown>>(data.results).map((m) => ({
      id: m.id, title: m.title, releaseDate: m.release_date,
      rating: m.vote_average, popularity: m.popularity,
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
      infoUrl: `/api/movies/info/${m.id}`,
    })),
  };
  cache.set(cacheKey, result, 600);
  res.json(result);
});

// ─── Trending movies ──────────────────────────────────────────────────────────
router.get("/trending", async (_req, res) => {
  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_KEY) { res.json({ success: false, message: "Set TMDB_API_KEY" }); return; }

  const cacheKey = "tmdb_trending";
  const cached = cache.get<Record<string, unknown>>(cacheKey);
  if (cached) { res.json(cached); return; }

  const data = await fetchJson(`https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_KEY}`).catch(() => null);
  if (!data) { res.status(400).json({ error: "Failed to fetch trending" }); return; }

  const result = {
    success: true,
    movies: arr<Record<string, unknown>>(data.results).slice(0, 10).map((m) => ({
      id: m.id, title: m.title, rating: m.vote_average,
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
      infoUrl: `/api/movies/info/${m.id}`,
    })),
  };
  cache.set(cacheKey, result, 900);
  res.json(result);
});

export default router;
