import fs from "fs";
import path from "path";
import {downloadSong} from "../downloader.js";
import {DOWNLOAD_PIPELINE_TIMEOUT_MS, MAX_STORED_DOWNLOAD_JOBS} from "./constants.js";
import {
  applyFilenameMetadataFallback,
  clampProgress,
  extractTrackIdFromValue,
  mergeSongMetadata,
  upscaleArtworkUrl,
  withTimeout,
} from "./helpers.js";

const ERRORS = {
  notFound: "Download job not found",
  inProgress: "Download is already in progress.",
  retryData: "Retry data unavailable for this job.",
  missingSong: "Song not found in current search context. Search first, then download by index.",
  notDownloadable: "Selected item is not downloadable.",
};
const ACTIVE_STATUSES = new Set(["queued", "preparing", "downloading"]);
const DOWNLOADING_PHASES = new Set(["downloading", "saving", "done"]);
const DEFAULT_SETTING = "Hi-Res";
const fsStat = fs.promises.stat;

function normalizeSong(song) {
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
  const tidalId = extractTrackIdFromValue(song.tidalId || song.url);
  if (tidalId) {
    normalized.tidalId = tidalId;
  }
  const url = String(song.url || "").trim();
  if (url) {
    normalized.url = url;
  }
  return normalized;
}

export function createDownloadEngine({state, browserController, searchEngine, songsDir}) {
  const resolveSongFromRequest = request =>
    searchEngine.getSongFromRequest(request.index, request.song) || request.song || null;

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
      tidalId: song.tidalId || null,
      url: song.url || null,
    };
  }

  function toPublicDownloadJob(job) {
    return {
      id: job.id,
      requestIndex: Number.isInteger(job.requestIndex) ? job.requestIndex : null,
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

  function trimDownloadJobs() {
    if (state.downloadJobs.size <= MAX_STORED_DOWNLOAD_JOBS) {
      return;
    }
    for (const [jobId, job] of state.downloadJobs) {
      if (state.downloadJobs.size <= MAX_STORED_DOWNLOAD_JOBS) {
        return;
      }
      if (job.status === "done" || job.status === "failed") {
        state.downloadJobs.delete(jobId);
      }
    }
    while (state.downloadJobs.size > MAX_STORED_DOWNLOAD_JOBS) {
      const oldestJobId = state.downloadJobs.keys().next().value;
      if (typeof oldestJobId === "undefined") {
        break;
      }
      state.downloadJobs.delete(oldestJobId);
    }
  }

  function createDownloadRequest(payload = {}) {
    const song = normalizeSong(payload.song);
    const index = Number.isInteger(payload.index)
      ? payload.index
      : Number.isInteger(song?.index)
        ? song.index
        : null;
    return {
      index,
      song,
      downloadSetting: payload.downloadSetting || DEFAULT_SETTING,
    };
  }

  function canResolveRequest(request = {}) {
    const selectedSong = resolveSongFromRequest(request);
    if (!selectedSong?.title) {
      return {ok: false, selectedSong, error: ERRORS.missingSong};
    }
    if (selectedSong.downloadable === false) {
      return {ok: false, selectedSong, error: ERRORS.notDownloadable};
    }
    return {ok: true, selectedSong, error: null};
  }

  function createDownloadJob(request, seedSong = null) {
    const seed = seedSong || resolveSongFromRequest(request) || {};
    const now = Date.now();
    const id = `${now}_${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      id,
      requestIndex: Number.isInteger(request.index) ? request.index : null,
      status: "queued",
      phase: "queued",
      progress: 0,
      title: seed.title || "Preparing download",
      artist: seed.artist || "",
      album: seed.album || "",
      artwork: upscaleArtworkUrl(seed.artwork),
      duration: seed.duration || 0,
      downloadSetting: request.downloadSetting || DEFAULT_SETTING,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      song: null,
      request,
      createdAt: now,
      updatedAt: now,
    };
    state.downloadJobs.set(id, job);
    trimDownloadJobs();
    return job;
  }

  function patchDownloadJob(jobId, patch = {}) {
    const job = state.downloadJobs.get(jobId);
    if (!job) {
      return null;
    }
    const previousProgress = job.progress;
    Object.assign(job, patch);
    job.updatedAt = Date.now();
    if (typeof patch.progress === "number") {
      const clamped = clampProgress(patch.progress, previousProgress);
      job.progress = job.status === "done"
        ? 100
        : patch.status === "queued"
          ? clamped
          : Math.max(previousProgress, clamped);
    } else if (job.status === "done") {
      job.progress = 100;
    }
    if ("error" in patch) {
      job.error = patch.error ? String(patch.error) : null;
    }
    return job;
  }

  async function runDownloadPipelineFromRequest(request, onProgress = () => {}) {
    const {index, song, downloadSetting} = request;
    return withTimeout(
      browserController.runBrowserTask(async () => {
        await browserController.initBrowser();
        onProgress({status: "preparing", phase: "preparing", progress: 4});
        const selectedSong = await searchEngine.resolveDownloadableSong(index, song, onProgress);
        const songMeta = searchEngine.toSongMeta(selectedSong);
        const {page} = browserController.getBrowserInstance();
        const filename = await downloadSong(
          page,
          selectedSong.element,
          songsDir,
          downloadSetting,
          progressUpdate => {
            const phase = progressUpdate?.phase || "downloading";
            onProgress({
              ...songMeta,
              status: DOWNLOADING_PHASES.has(phase) ? "downloading" : "preparing",
              ...progressUpdate,
            });
          }
        );
        const id = Date.now().toString();
        state.downloadedSongs.set(id, filename);
        return {
          id,
          filename,
          selectedSong: applyFilenameMetadataFallback(
            mergeSongMetadata(selectedSong, song || {}),
            filename
          ),
        };
      }),
      DOWNLOAD_PIPELINE_TIMEOUT_MS,
      "Download pipeline"
    );
  }

  async function runDownloadPipeline(payload, onProgress = () => {}) {
    return runDownloadPipelineFromRequest(createDownloadRequest(payload), onProgress);
  }

  async function readDownloadedFileSize(filename) {
    try {
      return (await fsStat(path.join(songsDir, filename))).size;
    } catch {
      return null;
    }
  }

  async function executeDownloadJob(jobId, request) {
    try {
      const result = await runDownloadPipelineFromRequest(request, progressPatch => {
        patchDownloadJob(jobId, {...progressPatch, error: null});
      });
      const bytes = await readDownloadedFileSize(result.filename);
      patchDownloadJob(jobId, {
        status: "done",
        phase: "done",
        progress: 100,
        downloadedBytes: bytes || 0,
        totalBytes: bytes || null,
        ...searchEngine.toSongMeta(result.selectedSong),
        song: {
          id: result.id,
          filename: result.filename,
          ...toPublicItem(result.selectedSong),
        },
      });
    } catch (error) {
      patchDownloadJob(jobId, {
        status: "failed",
        phase: "failed",
        error: error.message,
      });
    }
  }

  function startDownloadRequest(request, seedSong = null) {
    const job = createDownloadJob(request, seedSong);
    void executeDownloadJob(job.id, request);
    return state.downloadJobs.get(job.id);
  }

  function startDownloadJob(payload = {}) {
    return startDownloadRequest(createDownloadRequest(payload));
  }

  function enqueueDownload(payload = {}) {
    const request = createDownloadRequest(payload);
    const validation = canResolveRequest(request);
    if (!validation.ok) {
      return {ok: false, error: validation.error, job: null};
    }
    return {ok: true, error: null, job: startDownloadRequest(request, validation.selectedSong)};
  }

  function cancelDownloadJob(jobId) {
    const existing = state.downloadJobs.get(jobId);
    if (!existing) {
      throw new Error(ERRORS.notFound);
    }
    state.downloadJobs.delete(jobId);
    return existing;
  }

  function retryDownloadJob(jobId) {
    const existing = state.downloadJobs.get(jobId);
    if (!existing) {
      throw new Error(ERRORS.notFound);
    }
    if (ACTIVE_STATUSES.has(existing.status)) {
      throw new Error(ERRORS.inProgress);
    }
    const request = createDownloadRequest(
      existing.request || {
        song: {
          title: existing.title,
          artist: existing.artist,
          album: existing.album,
          artwork: existing.artwork,
          duration: existing.duration,
          downloadable: true,
        },
        downloadSetting: existing.downloadSetting,
      }
    );
    if (!request.song && !Number.isInteger(request.index)) {
      throw new Error(ERRORS.retryData);
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
    void executeDownloadJob(jobId, request);
    return state.downloadJobs.get(jobId);
  }

  function getDownloadJobs(limit = 40) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 40, 200));
    return [...state.downloadJobs.values()].slice(-safeLimit).map(toPublicDownloadJob);
  }

  function getDownloadJob(jobId) {
    return state.downloadJobs.get(jobId) || null;
  }

  function getDownloadedFilename(songId) {
    return state.downloadedSongs.get(songId) || null;
  }

  return {
    toPublicItem,
    toPublicDownloadJob,
    createDownloadRequest,
    runDownloadPipeline,
    startDownloadJob,
    enqueueDownload,
    cancelDownloadJob,
    retryDownloadJob,
    getDownloadJobs,
    getDownloadJob,
    getDownloadedFilename,
    canResolveRequest,
  };
}
