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

const NOT_FOUND_ERROR = "Download job not found";
const IN_PROGRESS_ERROR = "Download is already in progress.";
const RETRY_DATA_ERROR = "Retry data unavailable for this job.";
const MISSING_SONG_ERROR =
  "Song not found in current search context. Search first, then download by index.";
const NOT_DOWNLOADABLE_ERROR = "Selected item is not downloadable.";

function isJobInProgress(status) {
  return status === "queued" || status === "preparing" || status === "downloading";
}

export function createDownloadEngine({
  state,
  browserController,
  searchEngine,
  songsDir,
}) {
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

  function createDownloadRequest(payload = {}) {
    const normalizedSong = sanitizeDownloadSong(payload.song);
    const index = Number.isInteger(payload.index)
      ? payload.index
      : Number.isInteger(normalizedSong?.index)
        ? normalizedSong.index
        : null;

    return {
      index,
      song: normalizedSong,
      downloadSetting: payload.downloadSetting || "Hi-Res",
    };
  }

  function canResolveRequest(request = {}) {
    const {index, song} = request;
    const selectedSong = searchEngine.getSongFromRequest(index, song) || song || null;
    if (!selectedSong?.title) {
      return {ok: false, selectedSong, error: MISSING_SONG_ERROR};
    }
    if (selectedSong.downloadable === false) {
      return {ok: false, selectedSong, error: NOT_DOWNLOADABLE_ERROR};
    }
    return {ok: true, selectedSong, error: null};
  }

  function createDownloadJob(request) {
    const fromSearch = searchEngine.getSongFromRequest(request.index, request.song);
    const seed = fromSearch || request.song || {};
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

    state.downloadJobs.set(id, job);
    trimDownloadJobs();
    return job;
  }

  function patchDownloadJob(jobId, patch = {}) {
    const current = state.downloadJobs.get(jobId);
    if (!current) {
      return null;
    }

    const next = {...current, ...patch, updatedAt: Date.now()};
    if (typeof patch.progress === "number") {
      const clamped = clampProgress(patch.progress, current.progress);
      const shouldResetProgress = patch.status === "queued";
      next.progress = next.status === "done"
        ? 100
        : shouldResetProgress
          ? clamped
          : Math.max(current.progress, clamped);
    } else if (next.status === "done") {
      next.progress = 100;
    }
    if ("error" in patch) {
      next.error = patch.error ? String(patch.error) : null;
    }

    state.downloadJobs.set(jobId, next);
    return next;
  }

  async function runDownloadPipeline(payload, onProgress = () => {}) {
    const {index, song, downloadSetting} = payload || {};
    return withTimeout(
      browserController.runBrowserTask(async () => {
        await browserController.initBrowser();
        onProgress({status: "preparing", phase: "preparing", progress: 4});

        const selectedSong = await searchEngine.resolveDownloadableSong(
          index,
          song,
          onProgress
        );
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
              status:
                phase === "downloading" || phase === "saving" || phase === "done"
                  ? "downloading"
                  : "preparing",
              ...progressUpdate,
            });
          }
        );

        const id = Date.now().toString();
        state.downloadedSongs.set(id, filename);

        const requestSongFallback = song || searchEngine.getSongFromRequest(index, song) || {};
        const normalizedSelectedSong = applyFilenameMetadataFallback(
          mergeSongMetadata(selectedSong, requestSongFallback),
          filename
        );

        return {id, filename, selectedSong: normalizedSelectedSong};
      }),
      DOWNLOAD_PIPELINE_TIMEOUT_MS,
      "Download pipeline"
    );
  }

  async function readDownloadedFileSize(filename) {
    try {
      const stat = await fs.promises.stat(path.join(songsDir, filename));
      return stat.size;
    } catch {
      return null;
    }
  }

  async function executeDownloadJob(jobId, request) {
    try {
      const result = await runDownloadPipeline(request, progressPatch => {
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

  function startDownloadJob(payload = {}, alreadyNormalized = false) {
    const request = alreadyNormalized ? payload : createDownloadRequest(payload);
    const job = createDownloadJob(request);
    void executeDownloadJob(job.id, request);
    return state.downloadJobs.get(job.id);
  }

  function enqueueDownload(payload = {}) {
    const request = createDownloadRequest(payload);
    const validation = canResolveRequest(request);
    if (!validation.ok) {
      return {ok: false, error: validation.error, job: null};
    }
    return {ok: true, error: null, job: startDownloadJob(request, true)};
  }

  function cancelDownloadJob(jobId) {
    const existing = state.downloadJobs.get(jobId);
    if (!existing) {
      throw new Error(NOT_FOUND_ERROR);
    }
    state.downloadJobs.delete(jobId);
    return existing;
  }

  function retryDownloadJob(jobId) {
    const existing = state.downloadJobs.get(jobId);
    if (!existing) {
      throw new Error(NOT_FOUND_ERROR);
    }
    if (isJobInProgress(existing.status)) {
      throw new Error(IN_PROGRESS_ERROR);
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
      throw new Error(RETRY_DATA_ERROR);
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
