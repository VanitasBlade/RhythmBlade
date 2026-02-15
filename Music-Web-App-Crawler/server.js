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
let browserQueue = Promise.resolve();
let browserInitialized = false;
const trackSearchCache = new Map();
const TRACK_CACHE_TTL_MS = 60_000;

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
    artwork: song.artwork || null,
    duration: song.duration || 0,
    downloadable: Boolean(song.downloadable),
    url: song.url || null,
  };
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
    const result = await withTimeout(
      runBrowserTask(async () => {
        await initBrowser();

        let selectedSong = null;
        if (Number.isInteger(index)) {
          selectedSong = lastSearchSongs[index] || null;
        } else if (song && typeof song.index === "number") {
          selectedSong = lastSearchSongs[song.index] || null;
        }

        if (!selectedSong) {
          throw new Error("Song not found in current search context. Search first, then download by index.");
        }
        if (!selectedSong.downloadable) {
          throw new Error("Selected item is not downloadable.");
        }

        if (!selectedSong.element) {
          const { page } = browserInstance;
          const query = [selectedSong.title, selectedSong.artist].filter(Boolean).join(" ").trim();
          const candidates = await withTimeout(
            searchSongs(page, query || selectedSong.title, "tracks"),
            20000,
            "Resolve download target"
          );

          const selectedKey = `${normalizeText(selectedSong.title)}|${normalizeText(selectedSong.artist)}`;
          const exact = candidates.find((item) => {
            const key = `${normalizeText(item.title)}|${normalizeText(item.artist)}`;
            return key === selectedKey;
          });

          selectedSong = exact
            || candidates.find((item) => normalizeText(item.title) === normalizeText(selectedSong.title))
            || candidates[0]
            || null;

          if (!selectedSong || !selectedSong.element) {
            throw new Error("Could not resolve downloadable track element.");
          }
        }

        const { page } = browserInstance;
        const filename = await downloadSong(page, selectedSong.element, "./songs", downloadSetting);
        const id = Date.now().toString();
        downloadedSongs.set(id, filename);

        return { id, filename, selectedSong };
      }),
      70000,
      "Download pipeline"
    );

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
