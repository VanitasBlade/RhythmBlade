import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { ensureLoggedIn } from "./src/auth.js";
import { createBrowser } from "./src/browser.js";
import { BASE_URL } from "./src/config.js";
import { downloadSong } from "./src/downloader.js";
import { searchTracksFast } from "./src/fastSearch.js";
import { searchSongs } from "./src/search.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

let browserInstance = null;
let lastSearchSongs = [];
const downloadedSongs = new Map();
const downloadJobs = new Map();
let browserQueue = Promise.resolve();
let browserInitialized = false;
const trackSearchCache = new Map();
const TRACK_CACHE_TTL_MS = 60_000;
const DOWNLOAD_PIPELINE_TIMEOUT_MS = 70_000;
const MAX_STORED_DOWNLOAD_JOBS = 120;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function runBrowserTask(task) {
  const run = browserQueue.then(() => task());
  browserQueue = run.catch(() => {});
  return run;
}

async function initBrowser(authOverride = null) {
  if (!browserInstance) {
    browserInstance = await createBrowser();
  }

  const { page, context } = browserInstance;
  if (!browserInitialized || authOverride) {
    await ensureLoggedIn(page, context, authOverride || {});
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    browserInitialized = true;
  }

  return browserInstance;
}

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeDisplayText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isUnknownValue(value) {
  const normalized = normalizeText(value);
  return !normalized || normalized === "unknown" || normalized === "unknown artist";
}

function parseMetadataFromFilename(filename) {
  const stem = path.parse(String(filename || "")).name;
  if (!stem) {
    return { artist: "", title: "" };
  }

  const parts = stem.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      artist: parts[0],
      title: parts.slice(1).join(" - "),
    };
  }

  return {
    artist: "",
    title: stem,
  };
}

function mergeSongMetadata(primary = {}, fallback = {}) {
  const merged = { ...primary };
  const fields = ["title", "artist", "album"];
  for (const field of fields) {
    const primaryValue = normalizeDisplayText(merged[field]);
    const fallbackValue = normalizeDisplayText(fallback[field]);
    if (isUnknownValue(primaryValue) && fallbackValue) {
      merged[field] = fallbackValue;
    }
  }

  if (!merged.artwork && fallback.artwork) {
    merged.artwork = fallback.artwork;
  }
  if ((!Number(merged.duration) || Number(merged.duration) <= 0) && Number(fallback.duration) > 0) {
    merged.duration = Number(fallback.duration);
  }

  return merged;
}

function applyFilenameMetadataFallback(song, filename) {
  const fromFilename = parseMetadataFromFilename(filename);
  return mergeSongMetadata(song, fromFilename);
}

function upscaleArtworkUrl(url, size = 640) {
  const input = String(url || "").trim();
  if (!input) {
    return null;
  }

  // Tidal CDN artwork URLs commonly end with /160x160.jpg etc.
  if (input.includes("resources.tidal.com/images/")) {
    return input.replace(/\/\d+x\d+(\.(jpg|jpeg|png|webp))$/i, `/${size}x${size}$1`);
  }

  return input;
}

function getTrackCacheKey(query) {
  return normalizeText(query);
}

function getCachedTrackSearch(query) {
  const key = getTrackCacheKey(query);
  const entry = trackSearchCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    trackSearchCache.delete(key);
    return null;
  }
  return entry.songs;
}

function setCachedTrackSearch(query, songs) {
  const key = getTrackCacheKey(query);
  trackSearchCache.set(key, {
    songs,
    expiresAt: Date.now() + TRACK_CACHE_TTL_MS,
  });
}

async function searchTracksWithFallback(query) {
  const cached = getCachedTrackSearch(query);
  if (cached) {
    return cached;
  }

  let songs = [];
  let fastSearchError = null;
  let fastSearchCompleted = false;

  try {
    songs = await withTimeout(searchTracksFast(query, 25), 12000, "Fast track search");
    fastSearchCompleted = true;
  } catch (error) {
    fastSearchError = error;
  }

  if (!songs.length && !fastSearchCompleted && fastSearchError) {
    songs = await withTimeout(
      runBrowserTask(async () => {
        const { page } = await withTimeout(initBrowser(), 10000, "Browser initialization");
        return withTimeout(searchSongs(page, query, "tracks"), 12000, "Track fallback search");
      }),
      20000,
      "Track fallback pipeline"
    );
  }

  if (!songs.length && fastSearchError) {
    throw fastSearchError;
  }

  setCachedTrackSearch(query, songs);
  return songs;
}

function toPublicItem(song) {
  return {
    index: song.index,
    type: song.type || "track",
    title: song.title,
    artist: song.artist || "",
    album: song.album || "",
    subtitle: song.subtitle || "",
    artwork: upscaleArtworkUrl(song.artwork),
    duration: song.duration || 0,
    downloadable: Boolean(song.downloadable),
    url: song.url || null,
  };
}

function toPublicDownloadJob(job) {
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    title: job.title,
    artist: job.artist,
    album: job.album,
    artwork: upscaleArtworkUrl(job.artwork),
    duration: job.duration,
    downloadSetting: job.downloadSetting,
    downloadedBytes: job.downloadedBytes,
    totalBytes: job.totalBytes,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    song: job.song,
  };
}

function clampProgress(value, fallback = 0) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function trimDownloadJobs() {
  if (downloadJobs.size <= MAX_STORED_DOWNLOAD_JOBS) {
    return;
  }

  const jobs = [...downloadJobs.values()].sort((a, b) => a.createdAt - b.createdAt);
  const removable = jobs.filter((job) => job.status === "done" || job.status === "failed");

  for (const job of removable) {
    if (downloadJobs.size <= MAX_STORED_DOWNLOAD_JOBS) {
      return;
    }
    downloadJobs.delete(job.id);
  }

  while (downloadJobs.size > MAX_STORED_DOWNLOAD_JOBS && jobs.length) {
    const oldest = jobs.shift();
    downloadJobs.delete(oldest.id);
  }
}

function sanitizeDownloadSong(song) {
  if (!song || typeof song !== "object") {
    return null;
  }

  const title = String(song.title || "").trim();
  if (!title) {
    return null;
  }

  const normalized = {
    title,
    artist: String(song.artist || "").trim(),
    album: String(song.album || "").trim(),
    subtitle: String(song.subtitle || "").trim(),
    artwork: upscaleArtworkUrl(song.artwork),
    duration: Number(song.duration) || 0,
    downloadable: song.downloadable !== false,
  };

  if (Number.isInteger(song.index)) {
    normalized.index = song.index;
  }

  return normalized;
}

function createDownloadRequest(payload = {}) {
  return {
    index: Number.isInteger(payload.index) ? payload.index : null,
    song: sanitizeDownloadSong(payload.song),
    downloadSetting: payload.downloadSetting || "Hi-Res",
  };
}

function createDownloadJob(payload = {}) {
  const request = createDownloadRequest(payload);
  const fromSearch = getSongFromRequest(request.index, request.song);
  const seed = fromSearch || request.song || {};
  const now = Date.now();
  const id = `${now}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    status: "queued",
    phase: "queued",
    progress: 0,
    title: seed.title || "Preparing download",
    artist: seed.artist || "",
    album: seed.album || "",
    artwork: seed.artwork || null,
    duration: seed.duration || 0,
    downloadSetting: request.downloadSetting || "Hi-Res",
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
    song: null,
    request,
    createdAt: now,
    updatedAt: now,
  };

  downloadJobs.set(id, job);
  trimDownloadJobs();
  return job;
}

function patchDownloadJob(jobId, patch = {}) {
  const current = downloadJobs.get(jobId);
  if (!current) {
    return null;
  }

  const next = { ...current, ...patch, updatedAt: Date.now() };
  const shouldResetProgress = patch.status === "queued";
  if (typeof patch.progress === "number") {
    const clamped = clampProgress(patch.progress, current.progress);
    next.progress = next.status === "done"
      ? 100
      : shouldResetProgress
        ? clamped
        : Math.max(current.progress, clamped);
  }
  if (next.status === "done") {
    next.progress = 100;
  }
  if ("error" in patch) {
    next.error = patch.error ? String(patch.error) : null;
  }

  downloadJobs.set(jobId, next);
  trimDownloadJobs();
  return next;
}

function getSongFromRequest(index, song) {
  if (Number.isInteger(index)) {
    return lastSearchSongs[index] || null;
  }
  if (song && typeof song.index === "number") {
    return lastSearchSongs[song.index] || null;
  }
  return null;
}

function toSongMeta(song) {
  return {
    title: song?.title || "Unknown",
    artist: song?.artist || "",
    album: song?.album || "",
    artwork: upscaleArtworkUrl(song?.artwork),
    duration: song?.duration || 0,
  };
}

function pushUniqueQuery(target, value) {
  const normalizedValue = normalizeDisplayText(value);
  if (!normalizedValue) {
    return;
  }

  const key = normalizeText(normalizedValue);
  if (!key) {
    return;
  }

  if (!target.some((item) => normalizeText(item) === key)) {
    target.push(normalizedValue);
  }
}

function cleanSearchQueryPart(value) {
  return normalizeDisplayText(value)
    .replace(/["'`]/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[|/\\,:;!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitleQueryVariants(title) {
  const raw = normalizeDisplayText(title);
  if (!raw) {
    return [];
  }

  const variants = [];
  pushUniqueQuery(variants, raw);
  pushUniqueQuery(variants, cleanSearchQueryPart(raw));

  const fromMatch = raw.match(/\(\s*from\s+["']?([^"')]+)["']?\s*\)/i);
  const fromLabel = fromMatch ? normalizeDisplayText(fromMatch[1]) : "";
  if (fromMatch) {
    const withoutFrom = normalizeDisplayText(raw.replace(fromMatch[0], " "));
    pushUniqueQuery(variants, withoutFrom);
    pushUniqueQuery(variants, cleanSearchQueryPart(withoutFrom));
    pushUniqueQuery(variants, fromLabel);
  }

  const dashParts = raw.split(/\s+-\s+/).map((part) => normalizeDisplayText(part)).filter(Boolean);
  if (dashParts.length >= 2) {
    const left = dashParts[0];
    const right = normalizeDisplayText(dashParts.slice(1).join(" "));
    pushUniqueQuery(variants, `${right} ${left}`);
    pushUniqueQuery(variants, `${left} ${right}`);
    pushUniqueQuery(variants, `${cleanSearchQueryPart(right)} ${cleanSearchQueryPart(left)}`);
    if (fromLabel) {
      pushUniqueQuery(variants, `${right} ${fromLabel}`);
    }
  }

  return variants;
}

function buildResolveQueries(song) {
  const title = normalizeDisplayText(song?.title);
  const artist = normalizeDisplayText(song?.artist);
  const album = normalizeDisplayText(song?.album);
  const titleVariants = extractTitleQueryVariants(title);
  const queries = [];

  for (const variant of titleVariants) {
    pushUniqueQuery(queries, `${variant} ${artist}`);
    pushUniqueQuery(queries, `${artist} ${variant}`);
    pushUniqueQuery(queries, `${variant} ${album}`);
    pushUniqueQuery(queries, `${album} ${variant}`);
    pushUniqueQuery(queries, variant);
  }

  pushUniqueQuery(queries, `${title} ${artist} ${album}`);
  pushUniqueQuery(queries, `${artist} ${title} ${album}`);
  pushUniqueQuery(queries, `${album} ${title} ${artist}`);
  pushUniqueQuery(queries, `${artist} ${album}`);
  pushUniqueQuery(queries, `${album} ${artist}`);

  return queries.slice(0, 8);
}

function tokenizeForSimilarity(value) {
  const normalized = normalizeText(value)
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized ? normalized.split(/\s+/) : [];
}

function getTokenOverlapScore(sourceTokens, targetTokens, weight = 60) {
  if (!sourceTokens.length || !targetTokens.length) {
    return 0;
  }

  const targetSet = new Set(targetTokens);
  let matched = 0;
  for (const token of sourceTokens) {
    if (targetSet.has(token)) {
      matched += 1;
    }
  }

  const ratio = matched / Math.max(sourceTokens.length, targetTokens.length);
  return Math.round(ratio * weight);
}

function scoreCandidateMatch(candidate, targetSong) {
  const candidateTitle = normalizeDisplayText(candidate?.title);
  const targetTitle = normalizeDisplayText(targetSong?.title);
  const candidateArtist = normalizeDisplayText(candidate?.artist);
  const targetArtist = normalizeDisplayText(targetSong?.artist);

  let score = 0;
  const normalizedCandidateTitle = normalizeText(candidateTitle);
  const normalizedTargetTitle = normalizeText(targetTitle);

  if (normalizedCandidateTitle && normalizedTargetTitle) {
    if (normalizedCandidateTitle === normalizedTargetTitle) {
      score += 140;
    } else if (
      normalizedCandidateTitle.includes(normalizedTargetTitle)
      || normalizedTargetTitle.includes(normalizedCandidateTitle)
    ) {
      score += 90;
    }
  }

  score += getTokenOverlapScore(tokenizeForSimilarity(candidateTitle), tokenizeForSimilarity(targetTitle), 80);

  const normalizedCandidateArtist = normalizeText(candidateArtist);
  const normalizedTargetArtist = normalizeText(targetArtist);
  if (normalizedCandidateArtist && normalizedTargetArtist) {
    if (normalizedCandidateArtist === normalizedTargetArtist) {
      score += 45;
    } else if (
      normalizedCandidateArtist.includes(normalizedTargetArtist)
      || normalizedTargetArtist.includes(normalizedCandidateArtist)
    ) {
      score += 20;
    }
  }

  return score;
}

async function searchTrackCandidates(page, query, retries = 1) {
  let candidates = [];
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      candidates = await withTimeout(
        searchSongs(page, query, "tracks"),
        22000,
        `Resolve query "${query}"`
      );
    } catch (error) {
      lastError = error;
      continue;
    }

    if (candidates.length > 0) {
      return candidates;
    }

    await page.waitForTimeout(450 + (attempt * 600));
  }

  if (lastError) {
    throw lastError;
  }

  return candidates;
}

async function resolveDownloadableSong(index, song, onProgress = () => {}) {
  let selectedSong = getSongFromRequest(index, song);
  if (!selectedSong && song && song.title) {
    selectedSong = {
      ...song,
      downloadable: song.downloadable !== false,
      element: null,
    };
  }

  if (!selectedSong) {
    throw new Error("Song not found in current search context. Search first, then download by index.");
  }
  if (!selectedSong.downloadable) {
    throw new Error("Selected item is not downloadable.");
  }

  const originalMeta = {
    title: selectedSong.title,
    artist: selectedSong.artist,
    album: selectedSong.album,
    artwork: selectedSong.artwork,
    duration: selectedSong.duration,
  };

  onProgress({
    status: "preparing",
    phase: "preparing",
    progress: 10,
    ...toSongMeta(selectedSong),
  });

  if (!selectedSong.element) {
    onProgress({
      status: "preparing",
      phase: "resolving",
      progress: 22,
      ...toSongMeta(selectedSong),
    });

    const { page } = browserInstance;
    const resolveQueries = buildResolveQueries(selectedSong);
    let bestCandidate = null;
    let bestScore = -1;
    let resolveError = null;

    for (let i = 0; i < resolveQueries.length; i++) {
      const query = resolveQueries[i];
      onProgress({
        status: "preparing",
        phase: "resolving",
        progress: Math.min(34, 22 + Math.round(((i + 1) / resolveQueries.length) * 12)),
        ...toSongMeta(selectedSong),
      });

      let candidates = [];
      try {
        candidates = await searchTrackCandidates(page, query);
      } catch (error) {
        resolveError = error;
        continue;
      }
      if (!candidates.length) {
        continue;
      }

      for (const candidate of candidates) {
        const score = scoreCandidateMatch(candidate, selectedSong);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }

      // Exact/near-exact title match found, no need for broader queries.
      if (bestScore >= 140) {
        break;
      }
    }

    selectedSong = bestCandidate;

    if (!selectedSong || !selectedSong.element) {
      if (resolveError) {
        throw resolveError;
      }
      throw new Error(`Could not resolve downloadable track element for "${originalMeta.title}".`);
    }

    selectedSong = mergeSongMetadata(selectedSong, originalMeta);

    onProgress({
      status: "preparing",
      phase: "resolved",
      progress: 36,
      ...toSongMeta(selectedSong),
    });
  }

  return selectedSong;
}

async function runDownloadPipeline(payload, onProgress = () => {}) {
  const { index, song, downloadSetting } = payload || {};

  const result = await withTimeout(
    runBrowserTask(async () => {
      await initBrowser();
      onProgress({
        status: "preparing",
        phase: "preparing",
        progress: 4,
      });

      const selectedSong = await resolveDownloadableSong(index, song, onProgress);
      const songMeta = toSongMeta(selectedSong);
      const { page } = browserInstance;

      const filename = await downloadSong(
        page,
        selectedSong.element,
        "./songs",
        downloadSetting,
        (progressUpdate) => {
          const phase = progressUpdate?.phase || "downloading";
          const status = phase === "downloading" || phase === "saving" || phase === "done"
            ? "downloading"
            : "preparing";

          onProgress({
            ...songMeta,
            status,
            ...progressUpdate,
          });
        }
      );

      const id = Date.now().toString();
      downloadedSongs.set(id, filename);
      const requestSongFallback = song || getSongFromRequest(index, song) || {};
      const normalizedSelectedSong = applyFilenameMetadataFallback(
        mergeSongMetadata(selectedSong, requestSongFallback),
        filename
      );

      return { id, filename, selectedSong: normalizedSelectedSong };
    }),
    DOWNLOAD_PIPELINE_TIMEOUT_MS,
    "Download pipeline"
  );

  return result;
}

function readDownloadedFileSize(filename) {
  try {
    const filePath = path.join(__dirname, "songs", filename);
    return fs.statSync(filePath).size;
  } catch (error) {
    return null;
  }
}

function executeDownloadJob(jobId, request) {
  runDownloadPipeline(request, (progressPatch) => {
    patchDownloadJob(jobId, {
      ...progressPatch,
      error: null,
    });
  })
    .then((result) => {
      const bytes = readDownloadedFileSize(result.filename);
      patchDownloadJob(jobId, {
        status: "done",
        phase: "done",
        progress: 100,
        downloadedBytes: bytes || 0,
        totalBytes: bytes || null,
        ...toSongMeta(result.selectedSong),
        song: {
          id: result.id,
          filename: result.filename,
          ...toPublicItem(result.selectedSong),
        },
      });
    })
    .catch((error) => {
      patchDownloadJob(jobId, {
        status: "failed",
        phase: "failed",
        error: error.message,
      });
    });
}

function startDownloadJob(payload) {
  const job = createDownloadJob(payload);
  executeDownloadJob(job.id, job.request);
  return downloadJobs.get(job.id);
}

function retryDownloadJob(jobId) {
  const existing = downloadJobs.get(jobId);
  if (!existing) {
    throw new Error("Download job not found");
  }

  if (existing.status === "queued" || existing.status === "preparing" || existing.status === "downloading") {
    throw new Error("Download is already in progress.");
  }

  const fallbackRequest = createDownloadRequest({
    song: {
      title: existing.title,
      artist: existing.artist,
      album: existing.album,
      artwork: existing.artwork,
      duration: existing.duration,
      downloadable: true,
    },
    downloadSetting: existing.downloadSetting,
  });

  const request = createDownloadRequest(existing.request || fallbackRequest);
  if (!request.song && !Number.isInteger(request.index)) {
    throw new Error("Retry data unavailable for this job.");
  }

  patchDownloadJob(jobId, {
    status: "queued",
    phase: "queued",
    progress: 0,
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
    song: null,
    downloadSetting: request.downloadSetting,
    request,
  });

  executeDownloadJob(jobId, request);
  return downloadJobs.get(jobId);
}

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    await runBrowserTask(() => initBrowser({ email, password }));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const type = String(req.query.type || "tracks").trim();
    if (!query) {
      return res.status(400).json({ success: false, error: "Missing query 'q'" });
    }

    let songs = [];
    if (type.toLowerCase().startsWith("track")) {
      songs = await searchTracksWithFallback(query);
    } else {
      songs = await withTimeout(
        runBrowserTask(async () => {
          const { page } = await withTimeout(initBrowser(), 10000, "Browser initialization");
          return withTimeout(searchSongs(page, query, type), 18000, "Search request");
        }),
        30000,
        "Search pipeline"
      );
    }

    lastSearchSongs = songs;

    res.json({
      success: true,
      songs: songs.map(toPublicItem),
    });
  } catch (error) {
    const timedOut = /timed out/i.test(error.message || "");
    res.status(timedOut ? 504 : 500).json({ success: false, error: error.message });
  }
});

app.post("/api/download", async (req, res) => {
  try {
    const { index, song, downloadSetting } = req.body || {};
    const result = await runDownloadPipeline({ index, song, downloadSetting });

    res.json({
      success: true,
      song: {
        id: result.id,
        filename: result.filename,
        ...toPublicItem(result.selectedSong),
      },
    });
  } catch (error) {
    if (
      (error.message || "").includes("Song not found in current search context")
      || (error.message || "").includes("not downloadable")
    ) {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/downloads", (req, res) => {
  try {
    const { index, song, downloadSetting } = req.body || {};
    const selectedSong = getSongFromRequest(index, song) || song || null;

    if (!selectedSong || !selectedSong.title) {
      return res.status(400).json({
        success: false,
        error: "Song not found in current search context. Search first, then download by index.",
      });
    }
    if (selectedSong.downloadable === false) {
      return res.status(400).json({ success: false, error: "Selected item is not downloadable." });
    }

    const job = startDownloadJob({ index, song, downloadSetting });
    return res.status(202).json({
      success: true,
      job: toPublicDownloadJob(job),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/downloads", (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 40, 200));
  const jobs = [...downloadJobs.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-limit)
    .map(toPublicDownloadJob);

  return res.json({
    success: true,
    jobs,
  });
});

app.post("/api/downloads/:id/retry", (req, res) => {
  try {
    const { id } = req.params;
    const retried = retryDownloadJob(id);
    return res.status(202).json({
      success: true,
      job: toPublicDownloadJob(retried),
    });
  } catch (error) {
    if ((error.message || "").includes("not found")) {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (
      (error.message || "").includes("already in progress")
      || (error.message || "").includes("Retry data unavailable")
    ) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/downloads/:id", (req, res) => {
  const { id } = req.params;
  const job = downloadJobs.get(id);
  if (!job) {
    return res.status(404).json({ success: false, error: "Download job not found" });
  }

  return res.json({
    success: true,
    job: toPublicDownloadJob(job),
  });
});

app.get("/api/stream/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const filename = downloadedSongs.get(id);
    if (!filename) {
      return res.status(404).json({ error: "File not found" });
    }
    const filePath = path.join(__dirname, "songs", filename);
    return streamFile(filePath, req, res);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

function streamFile(filePath, req, res) {
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found on disk" });
  }

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  const ext = path.extname(filePath).toLowerCase();
  const mimeByExt = {
    ".flac": "audio/flac",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
  };
  const contentType = mimeByExt[ext] || "application/octet-stream";

  if (!range) {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentType,
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": contentType,
  });

  return fs.createReadStream(filePath, { start, end }).pipe(res);
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
