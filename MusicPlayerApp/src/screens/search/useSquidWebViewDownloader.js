import {useCallback, useMemo, useRef} from 'react';
import RNFS from 'react-native-fs';

import {
  canExtractEmbeddedArtwork,
  extractEmbeddedArtworkDataUri,
} from '../../services/artwork/ArtworkService';
import storageService from '../../services/storage/StorageService';
import {
  sanitizeFileSegment,
  toFileUriFromPath,
} from '../../services/storage/storage.helpers';
import {
  DEFAULT_DOWNLOAD_SETTING,
  normalizeDownloadSetting,
} from './search.constants';
import SQUID_BRIDGE_SCRIPT from './webview/squidBridgeScript';

const SQUID_WEB_URL = 'https://tidal.squid.wtf/';
const MAX_STORED_JOBS = 120;
const ACTIVE_STATUSES = new Set(['queued', 'preparing', 'downloading']);
const CANCELLED_ERROR = '__RB_DOWNLOAD_CANCELLED__';
const BRIDGE_BOOTSTRAP_TIMEOUT_MS = 25000;
const BRIDGE_BOOTSTRAP_RETRY_MS = 1200;
const BRIDGE_PING_TIMEOUT_MS = 3500;
const MAX_NATIVE_DOWNLOAD_ATTEMPTS = 2;
const MIN_VALID_AUDIO_FILE_BYTES = 64 * 1024;
const SQUID_ORIGIN = 'https://tidal.squid.wtf';
const BRIDGE_DOWNLOAD_CHUNK_EVENT = 'bridge-download-chunk';
const DUPLICATE_LOAD_DEBOUNCE_MS = 200;
const MAX_ALBUM_TRACK_ATTEMPTS = 2;
const NO_MATCH_FOUND_ERROR = 'NO_MATCH_FOUND';

function now() {
  return Date.now();
}

function sleep(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  return new Promise(resolve => setTimeout(resolve, delay));
}

function toAbsoluteSquidUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    return new URL(raw, SQUID_WEB_URL).toString();
  } catch (_) {
    return raw;
  }
}

function normalizeComparableUrl(value = '') {
  const absolute = toAbsoluteSquidUrl(value);
  if (!absolute) {
    return '';
  }
  try {
    const parsed = new URL(absolute);
    parsed.hash = '';
    const trimmedPath = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.origin}${trimmedPath}${parsed.search}`;
  } catch (_) {
    return absolute.replace(/\/+$/, '');
  }
}

function normalizeTrackPositionValue(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const match = text.match(/(\d+)\s*-\s*(\d+)/);
  if (!match) {
    return text;
  }
  return `${Number(match[1])}-${Number(match[2])}`;
}

function resolveAlbumUrlFromSong(song = {}) {
  const direct = String(song?.albumUrl || song?.sourceAlbumUrl || '').trim();
  if (direct) {
    return toAbsoluteSquidUrl(direct);
  }
  const rawUrl = String(song?.url || '').trim();
  if (!rawUrl) {
    return '';
  }
  const candidate = rawUrl.split('#')[0];
  if (!/\/album\//i.test(candidate)) {
    return '';
  }
  return toAbsoluteSquidUrl(candidate);
}

function isAlbumDirectSong(song = {}) {
  const sourceType = String(song?.sourceType || '')
    .trim()
    .toLowerCase();
  if (sourceType === 'album') {
    return true;
  }
  const albumUrl = resolveAlbumUrlFromSong(song);
  const trackPosition = normalizeTrackPositionValue(
    song?.trackPosition || song?.position,
  );
  return Boolean(albumUrl && trackPosition);
}

function toTrackId(value) {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }
  const fromPath =
    input.match(/\/track\/(\d+)/i) || input.match(/\/tracks\/(\d+)/i);
  if (fromPath?.[1]) {
    return fromPath[1];
  }
  const direct = input.match(/^\d+$/);
  return direct?.[0] || '';
}

function normalizeSong(item = {}) {
  const title = String(item?.title || '').trim() || 'Unknown';
  const artist = String(item?.artist || '').trim() || 'Unknown Artist';
  const album = String(item?.album || '').trim();
  const subtitle = String(item?.subtitle || '').trim();
  const artwork = String(item?.artwork || '').trim() || null;
  const tidalId = toTrackId(item?.tidalId || item?.url);
  const url = String(item?.url || '').trim() || null;
  const duration = Number(item?.duration) || 0;
  return {
    ...item,
    title,
    artist,
    album,
    subtitle,
    artwork,
    tidalId: tidalId || null,
    url,
    duration,
    downloadable: item?.downloadable !== false,
  };
}

function normalizeResultItem(item, index, fallbackType = 'track') {
  const normalized = normalizeSong(item);
  const trackPosition = normalizeTrackPositionValue(
    item?.trackPosition || item?.position,
  );
  const albumUrl = toAbsoluteSquidUrl(
    item?.albumUrl || item?.sourceAlbumUrl || '',
  );
  const downloadButtonSelector = String(
    item?.downloadButtonSelector || '',
  ).trim();
  const sourceType = String(item?.sourceType || '')
    .trim()
    .toLowerCase();

  return {
    index: Number.isInteger(item?.index) ? item.index : index,
    type: String(item?.type || fallbackType || 'track').toLowerCase(),
    title: normalized.title,
    artist: normalized.artist,
    album: normalized.album,
    subtitle: normalized.subtitle || normalized.artist,
    artwork: normalized.artwork,
    duration: normalized.duration,
    downloadable: normalized.downloadable !== false,
    url: normalized.url,
    tidalId: normalized.tidalId,
    ...(trackPosition ? {trackPosition} : null),
    ...(albumUrl ? {albumUrl} : null),
    ...(downloadButtonSelector ? {downloadButtonSelector} : null),
    ...(sourceType ? {sourceType} : null),
  };
}

function normalizeMediaExtension(urlValue = '') {
  const cleanUrl = String(urlValue || '').split('?')[0];
  const match = cleanUrl.match(/\.([a-z0-9]{2,5})$/i);
  const ext = match?.[1]?.toLowerCase() || 'flac';
  if (ext === 'mp4') {
    return '.m4a';
  }
  return `.${ext}`;
}

function extensionFromFilenameOrMime(filename = '', mimeType = '') {
  const fromName = String(filename || '').match(/\.([a-z0-9]{2,5})(?:\?.*)?$/i);
  if (fromName?.[1]) {
    const ext = fromName[1].toLowerCase();
    if (ext === 'mp4') {
      return '.m4a';
    }
    return `.${ext}`;
  }

  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('flac')) {
    return '.flac';
  }
  if (mime.includes('mpeg') || mime.includes('mp3')) {
    return '.mp3';
  }
  if (mime.includes('wav')) {
    return '.wav';
  }
  if (mime.includes('ogg')) {
    return '.ogg';
  }
  if (mime.includes('aac') || mime.includes('mp4')) {
    return '.m4a';
  }
  return '.m4a';
}

function base64ByteSize(value = '') {
  const input = String(value || '').trim();
  if (!input) {
    return 0;
  }
  const padding = input.endsWith('==') ? 2 : input.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((input.length * 3) / 4) - padding);
}

function cloneJob(job) {
  if (!job) {
    return null;
  }
  return {
    ...job,
    song: job.song ? {...job.song} : null,
    request: job.request ? {...job.request, song: {...job.request.song}} : null,
  };
}

function clampProgress(progress, fallback = 0) {
  if (!Number.isFinite(progress)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function normalizeHeaderMap(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.entries(value).reduce((acc, [rawKey, rawValue]) => {
    const key = String(rawKey || '')
      .trim()
      .toLowerCase();
    const nextValue = String(rawValue || '').trim();
    if (!key || !nextValue) {
      return acc;
    }
    acc[key] = nextValue;
    return acc;
  }, {});
}

function buildNativeDownloadHeaders(bridgeDownload) {
  const requestHeaders = normalizeHeaderMap(bridgeDownload?.requestHeaders);
  const fallbackHeaders = normalizeHeaderMap(bridgeDownload?.headers);
  const merged = {...fallbackHeaders, ...requestHeaders};
  const referer =
    String(bridgeDownload?.referer || SQUID_WEB_URL).trim() || SQUID_WEB_URL;
  const userAgent = String(bridgeDownload?.userAgent || '').trim();

  const headers = {
    Accept: merged.accept || '*/*',
    Referer: merged.referer || referer,
    Origin: merged.origin || SQUID_ORIGIN,
  };

  if (merged.cookie) {
    headers.Cookie = merged.cookie;
  }
  if (merged.range) {
    headers.Range = merged.range;
  }
  if (userAgent) {
    headers['User-Agent'] = userAgent;
  }

  return headers;
}

function useSquidWebViewDownloader() {
  const webViewRef = useRef(null);
  const bridgeReadyRef = useRef(false);
  const bridgeBootstrappingRef = useRef(false);
  const bridgeReadyWaitersRef = useRef([]);
  const pendingRequestsRef = useRef(new Map());
  const jobCommandMapRef = useRef(new Map());
  const commandJobMapRef = useRef(new Map());
  const commandCounterRef = useRef(1);
  const jobsRef = useRef(new Map());
  const processingRef = useRef(false);
  const activeNativeDownloadRef = useRef(null);
  const cancelledJobsRef = useRef(new Set());
  const lastLoadEndRef = useRef({url: '', timestamp: 0});
  const pendingAlbumUrlRef = useRef('');
  const activeAlbumUrlRef = useRef('');

  const log = useCallback((message, context = null) => {
    const timestamp = new Date().toISOString();
    if (context === null || typeof context === 'undefined') {
      console.log(`[SquidWV ${timestamp}] ${message}`);
      return;
    }
    console.log(`[SquidWV ${timestamp}] ${message}`, context);
  }, []);

  const flushBridgeWaiters = useCallback(() => {
    const waiters = bridgeReadyWaitersRef.current.splice(0);
    log(`Flushing ${waiters.length} bridge waiters.`);
    waiters.forEach(resolve => resolve());
  }, [log]);

  const unlinkCommandTracking = useCallback(id => {
    const commandId = String(id || '').trim();
    if (!commandId) {
      return null;
    }
    const jobId = commandJobMapRef.current.get(commandId) || null;
    commandJobMapRef.current.delete(commandId);
    if (jobId && jobCommandMapRef.current.get(jobId) === commandId) {
      jobCommandMapRef.current.delete(jobId);
    }
    return jobId;
  }, []);

  const sendBridgeAbort = useCallback(
    (id, reason = '') => {
      const commandId = String(id || '').trim();
      if (!commandId) {
        return;
      }

      const webView = webViewRef.current;
      if (!webView || typeof webView.postMessage !== 'function') {
        return;
      }

      try {
        webView.postMessage(
          JSON.stringify({
            type: 'abort',
            id: commandId,
          }),
        );
        const context = {id: commandId};
        if (reason) {
          context.reason = reason;
        }
        log('Posted bridge abort command.', {
          ...context,
        });
      } catch (error) {
        log('Failed to post bridge abort command.', {
          id: commandId,
          error: error?.message || String(error),
        });
      }
    },
    [log],
  );

  const rejectPendingCommand = useCallback(
    (id, message, options = {}) => {
      const commandId = String(id || '').trim();
      if (!commandId) {
        return false;
      }

      const pending = pendingRequestsRef.current.get(commandId);
      if (!pending) {
        if (options.sendAbort !== false) {
          sendBridgeAbort(
            commandId,
            options.reason || 'reject-missing-pending',
          );
        }
        unlinkCommandTracking(commandId);
        return false;
      }

      clearTimeout(pending.timeoutId);
      pendingRequestsRef.current.delete(commandId);
      unlinkCommandTracking(commandId);
      if (options.sendAbort !== false) {
        sendBridgeAbort(commandId, options.reason || 'reject-pending');
      }
      pending.reject(new Error(message));
      return true;
    },
    [sendBridgeAbort, unlinkCommandTracking],
  );

  const rejectPendingRequests = useCallback(
    message => {
      const entries = Array.from(pendingRequestsRef.current.entries());
      log('Rejecting pending bridge commands.', {
        count: entries.length,
        message,
      });
      entries.forEach(([id]) => {
        rejectPendingCommand(id, message, {reason: 'bridge-reset'});
      });
    },
    [log, rejectPendingCommand],
  );

  const resetBridgeState = useCallback(() => {
    log('WebView load start -> bridge state reset.');
    bridgeReadyRef.current = false;
    rejectPendingRequests('Hidden webview reloaded.');
  }, [log, rejectPendingRequests]);

  const markBridgeReady = useCallback(() => {
    if (bridgeReadyRef.current) {
      return;
    }
    log('Bridge marked ready.');
    bridgeReadyRef.current = true;
    flushBridgeWaiters();
  }, [flushBridgeWaiters, log]);

  const waitForBridgeReady = useCallback(
    (timeoutMs = 25000) => {
      if (bridgeReadyRef.current) {
        log('Bridge already ready.');
        return Promise.resolve();
      }

      log('Waiting for bridge-ready event.', {timeoutMs});
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          log('Timed out waiting for bridge-ready event.', {timeoutMs});
          reject(new Error('Hidden webview bridge is not ready.'));
        }, timeoutMs);

        bridgeReadyWaitersRef.current.push(() => {
          clearTimeout(timeoutId);
          resolve();
        });
      });
    },
    [log],
  );

  const registerCommandTracking = useCallback((commandId, jobId) => {
    const id = String(commandId || '').trim();
    const nextJobId = String(jobId || '').trim();
    if (!id || !nextJobId) {
      return;
    }
    const previousCommandId = jobCommandMapRef.current.get(nextJobId);
    if (previousCommandId && previousCommandId !== id) {
      commandJobMapRef.current.delete(previousCommandId);
    }
    jobCommandMapRef.current.set(nextJobId, id);
    commandJobMapRef.current.set(id, nextJobId);
  }, []);

  const sendBridgeCommandRaw = useCallback(
    async (type, payload = {}, timeoutMs = 45000, options = {}) => {
      const webView = webViewRef.current;
      if (!webView || typeof webView.postMessage !== 'function') {
        throw new Error('Hidden webview is unavailable.');
      }

      const id = `cmd_${now()}_${commandCounterRef.current++}`;
      const body = JSON.stringify({id, type, payload});
      const jobId = String(options?.jobId || '').trim();
      if (jobId) {
        registerCommandTracking(id, jobId);
      }

      return new Promise((resolve, reject) => {
        const chunkState = {
          total: 0,
          totalBytes: 0,
          filename: '',
          mimeType: '',
          parts: [],
          received: 0,
        };

        const timeoutId = setTimeout(() => {
          const pending = pendingRequestsRef.current.get(id);
          if (!pending) {
            return;
          }
          pendingRequestsRef.current.delete(id);
          unlinkCommandTracking(id);
          sendBridgeAbort(id, 'command-timeout');
          log('Bridge command timed out.', {id, type, timeoutMs});
          pending.reject(new Error(`Webview command timed out: ${type}`));
        }, timeoutMs);

        pendingRequestsRef.current.set(id, {
          resolve: result => {
            log('Bridge command resolved.', {id, type});
            resolve(result);
          },
          reject: error => {
            log('Bridge command rejected.', {
              id,
              type,
              error: error?.message || String(error),
            });
            reject(error);
          },
          timeoutId,
          chunkState,
          type,
          jobId: jobId || null,
        });

        log('Posting bridge command.', {id, type});
        webView.postMessage(body);
      });
    },
    [log, registerCommandTracking, sendBridgeAbort, unlinkCommandTracking],
  );

  const bootstrapBridge = useCallback(
    async (timeoutMs = BRIDGE_BOOTSTRAP_TIMEOUT_MS) => {
      if (bridgeReadyRef.current) {
        return;
      }

      if (bridgeBootstrappingRef.current) {
        log('Bootstrap already running, waiting for completion.');
        await waitForBridgeReady(timeoutMs);
        return;
      }

      bridgeBootstrappingRef.current = true;
      const startedAt = now();
      let attempt = 0;

      try {
        while (now() - startedAt < timeoutMs) {
          if (bridgeReadyRef.current) {
            return;
          }

          attempt += 1;
          const webView = webViewRef.current;
          if (!webView) {
            log('Bootstrap attempt skipped: webview ref is null.', {attempt});
            await new Promise(resolve =>
              setTimeout(resolve, BRIDGE_BOOTSTRAP_RETRY_MS),
            );
            continue;
          }

          log('Bootstrap attempt started.', {attempt});
          try {
            webView.injectJavaScript(SQUID_BRIDGE_SCRIPT);
          } catch (error) {
            log('Bridge script injection failed.', {
              attempt,
              error: error?.message || String(error),
            });
          }

          try {
            await sendBridgeCommandRaw(
              'ping',
              {attempt},
              BRIDGE_PING_TIMEOUT_MS,
            );
            markBridgeReady();
            return;
          } catch (error) {
            log('Bootstrap ping failed.', {
              attempt,
              error: error?.message || String(error),
            });
          }

          await new Promise(resolve =>
            setTimeout(resolve, BRIDGE_BOOTSTRAP_RETRY_MS),
          );
        }
      } finally {
        bridgeBootstrappingRef.current = false;
      }

      throw new Error('Hidden webview bridge is not ready.');
    },
    [log, markBridgeReady, sendBridgeCommandRaw, waitForBridgeReady],
  );

  const handleBridgeMessage = useCallback(
    event => {
      const raw = event?.nativeEvent?.data;
      if (!raw) {
        return;
      }

      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      if (parsed.type === 'bridge-log') {
        log(`Bridge log: ${parsed.message || 'unknown'}`, parsed.extra || null);
        return;
      }

      if (parsed.type === 'bridge-ready') {
        log('Received bridge-ready message.', parsed);
        markBridgeReady();
        return;
      }

      if (parsed.type === BRIDGE_DOWNLOAD_CHUNK_EVENT) {
        const pending = pendingRequestsRef.current.get(parsed.id);
        if (!pending?.chunkState) {
          return;
        }

        const seq = Number(parsed.seq);
        const total = Number(parsed.total);
        const totalBytes = Number(parsed.totalBytes);
        const data = typeof parsed.data === 'string' ? parsed.data : '';

        if (Number.isInteger(total) && total > 0) {
          pending.chunkState.total = total;
        }
        if (Number.isInteger(totalBytes) && totalBytes > 0) {
          pending.chunkState.totalBytes = totalBytes;
        }
        if (parsed.filename) {
          pending.chunkState.filename = String(parsed.filename);
        }
        if (parsed.mimeType) {
          pending.chunkState.mimeType = String(parsed.mimeType);
        }

        if (Number.isInteger(seq) && seq >= 0 && data) {
          if (!pending.chunkState.parts[seq]) {
            pending.chunkState.received += 1;
          }
          pending.chunkState.parts[seq] = data;
        }
        return;
      }

      if (parsed.type !== 'bridge-response') {
        return;
      }

      const pending = pendingRequestsRef.current.get(parsed.id);
      if (!pending) {
        unlinkCommandTracking(parsed.id);
        return;
      }

      clearTimeout(pending.timeoutId);
      pendingRequestsRef.current.delete(parsed.id);
      unlinkCommandTracking(parsed.id);

      if (!bridgeReadyRef.current) {
        markBridgeReady();
      }

      if (parsed.ok) {
        const result =
          parsed.result && typeof parsed.result === 'object'
            ? {...parsed.result}
            : parsed.result;

        if (
          result &&
          result.delivery === 'bridge-chunks' &&
          pending.chunkState
        ) {
          const expectedChunks =
            Number(result.chunkCount) || Number(pending.chunkState.total) || 0;
          const parts = Array.isArray(pending.chunkState.parts)
            ? pending.chunkState.parts
            : [];
          const receivedChunks = parts.filter(Boolean).length;
          if (expectedChunks > 0 && receivedChunks < expectedChunks) {
            pending.reject(
              new Error(
                `Chunk transfer incomplete (${receivedChunks}/${expectedChunks}).`,
              ),
            );
            return;
          }

          result.chunkTransfer = {
            parts,
            chunkCount: expectedChunks || receivedChunks,
            totalBytes:
              Number(result.totalBytes) ||
              Number(pending.chunkState.totalBytes) ||
              0,
            filename: String(
              result.filename || pending.chunkState.filename || '',
            ).trim(),
            mimeType: String(
              result.mimeType || pending.chunkState.mimeType || '',
            ).trim(),
          };
        }

        pending.resolve(result);
        return;
      }

      pending.reject(new Error(parsed.error || 'Webview command failed.'));
    },
    [log, markBridgeReady, unlinkCommandTracking],
  );

  const postBridgeCommand = useCallback(
    async (type, payload = {}, timeoutMs = 45000, options = {}) => {
      await bootstrapBridge();
      return sendBridgeCommandRaw(type, payload, timeoutMs, options);
    },
    [bootstrapBridge, sendBridgeCommandRaw],
  );

  const trimJobs = useCallback(() => {
    const jobs = jobsRef.current;
    if (jobs.size <= MAX_STORED_JOBS) {
      return;
    }

    for (const [jobId, job] of jobs) {
      if (jobs.size <= MAX_STORED_JOBS) {
        break;
      }
      if (job.status === 'done' || job.status === 'failed') {
        jobs.delete(jobId);
      }
    }

    while (jobs.size > MAX_STORED_JOBS) {
      const oldestId = jobs.keys().next().value;
      if (!oldestId) {
        break;
      }
      jobs.delete(oldestId);
    }
  }, []);

  const patchJob = useCallback((jobId, patch = {}) => {
    const job = jobsRef.current.get(jobId);
    if (!job) {
      return null;
    }

    const previousProgress = Number(job.progress) || 0;
    Object.assign(job, patch);
    job.updatedAt = now();

    if (typeof patch.progress === 'number') {
      const clamped = clampProgress(patch.progress, previousProgress);
      if (patch.status === 'queued') {
        job.progress = clamped;
      } else if (patch.status === 'done') {
        job.progress = 100;
      } else {
        job.progress = Math.max(previousProgress, clamped);
      }
    } else if (patch.status === 'done') {
      job.progress = 100;
    }

    if ('error' in patch) {
      job.error = patch.error ? String(patch.error) : null;
    }

    return cloneJob(job);
  }, []);

  const assertJobActive = useCallback(jobId => {
    if (!jobsRef.current.has(jobId) || cancelledJobsRef.current.has(jobId)) {
      throw new Error(CANCELLED_ERROR);
    }
  }, []);

  const queueDownloadJob = useCallback(
    (song, index, downloadSetting) => {
      const requestSong = normalizeSong(song);
      const resolvedDownloadSetting = normalizeDownloadSetting(downloadSetting);
      const createdAt = now();
      const id = `${createdAt}_${Math.random().toString(36).slice(2, 8)}`;
      const requestIndex = Number.isInteger(index)
        ? index
        : Number.isInteger(song?.index)
        ? song.index
        : null;

      const job = {
        id,
        requestIndex,
        status: 'queued',
        phase: 'queued',
        progress: 0,
        title: requestSong.title,
        artist: requestSong.artist,
        album: requestSong.album,
        artwork: requestSong.artwork,
        duration: requestSong.duration,
        downloadSetting: resolvedDownloadSetting,
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
        song: null,
        request: {
          index: requestIndex,
          song: requestSong,
          downloadSetting: resolvedDownloadSetting,
        },
        createdAt,
        updatedAt: createdAt,
      };

      jobsRef.current.set(job.id, job);
      trimJobs();
      return cloneJob(job);
    },
    [trimJobs],
  );

  const toPublicJobs = useCallback((limit = 60) => {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 60, 200));
    const jobs = Array.from(jobsRef.current.values());
    return jobs.slice(-safeLimit).map(cloneJob);
  }, []);

  const runJobDownload = useCallback(
    async job => {
      const jobId = job.id;
      const requestSong = normalizeSong(job?.request?.song || {});
      const directAlbumJob = isAlbumDirectSong(requestSong);
      const albumTrackPosition = normalizeTrackPositionValue(
        requestSong?.trackPosition || requestSong?.position,
      );
      const albumJobUrl = resolveAlbumUrlFromSong(requestSong);
      log('Running download job.', {
        jobId,
        title: requestSong.title,
        artist: requestSong.artist,
        mode: directAlbumJob ? 'album-direct' : 'search',
        ...(directAlbumJob
          ? {
              albumUrl: albumJobUrl || null,
              trackPosition: albumTrackPosition || null,
            }
          : null),
      });

      patchJob(jobId, {
        status: 'preparing',
        phase: 'preparing',
        progress: 8,
        error: null,
      });

      assertJobActive(jobId);

      const destinationDir = await storageService.getWritableMusicDir();
      let resolvedSong = requestSong;
      let destinationPath = '';
      let finalFileSize = 0;
      let attemptError = null;

      for (
        let attempt = 1;
        attempt <= MAX_NATIVE_DOWNLOAD_ATTEMPTS;
        attempt += 1
      ) {
        let bridgeDownload = null;
        let downloadResponse = null;

        try {
          assertJobActive(jobId);
          patchJob(jobId, {
            status: 'preparing',
            phase: 'preparing',
            progress: attempt > 1 ? 24 : 18,
            error: null,
          });

          const resolvedDownloadSetting = normalizeDownloadSetting(
            job.downloadSetting || DEFAULT_DOWNLOAD_SETTING,
          );

          if (directAlbumJob) {
            const targetAlbumUrl = await ensureAlbumDownloadPage(albumJobUrl);
            if (!albumTrackPosition) {
              throw new Error('Album track position is missing.');
            }

            bridgeDownload = await postBridgeCommand(
              'albumTrackDownload',
              {
                trackPosition: albumTrackPosition,
                expectedTitle: requestSong.title,
                albumUrl: targetAlbumUrl,
                song: requestSong,
                downloadSetting: resolvedDownloadSetting,
                attempt,
              },
              130000,
              {jobId},
            );
          } else {
            bridgeDownload = await postBridgeCommand(
              'download',
              {
                song: requestSong,
                downloadSetting: resolvedDownloadSetting,
                attempt,
              },
              130000,
              {jobId},
            );
          }

          assertJobActive(jobId);

          resolvedSong = normalizeSong({
            ...requestSong,
            ...bridgeDownload?.song,
          });
          const chunkTransfer = bridgeDownload?.chunkTransfer;
          const chunkParts = Array.isArray(chunkTransfer?.parts)
            ? chunkTransfer.parts
            : [];

          if (chunkParts.length > 0) {
            const expectedChunks =
              Number(chunkTransfer?.chunkCount) || chunkParts.length;
            const receivedChunks = chunkParts.filter(Boolean).length;
            if (receivedChunks < expectedChunks) {
              throw new Error(
                `Processed file chunk transfer incomplete (${receivedChunks}/${expectedChunks}).`,
              );
            }

            const filenameFromBridge = String(
              chunkTransfer?.filename || '',
            ).trim();
            const extension = extensionFromFilenameOrMime(
              filenameFromBridge,
              chunkTransfer?.mimeType,
            );
            const filenameStemRaw = filenameFromBridge
              ? filenameFromBridge.replace(/\.[^/.]+$/, '')
              : `${resolvedSong.artist} - ${resolvedSong.title}`;
            const filenameStem =
              sanitizeFileSegment(filenameStemRaw) ||
              sanitizeFileSegment(
                `${resolvedSong.artist} - ${resolvedSong.title}`,
              ) ||
              `Track_${now()}`;
            const preferredPath = `${destinationDir}/${filenameStem}${extension}`;
            destinationPath = await storageService.ensureUniquePath(
              preferredPath,
            );

            const totalBytesFromBridge =
              Number(chunkTransfer?.totalBytes) || null;
            let bytesWritten = 0;

            patchJob(jobId, {
              status: 'downloading',
              phase: 'downloading',
              progress: 42,
              downloadedBytes: 0,
              totalBytes: totalBytesFromBridge,
            });

            await RNFS.writeFile(destinationPath, chunkParts[0], 'base64');
            bytesWritten += base64ByteSize(chunkParts[0]);
            patchJob(jobId, {
              status: 'downloading',
              phase: 'downloading',
              progress: 46,
              downloadedBytes: bytesWritten,
              totalBytes: totalBytesFromBridge,
            });

            for (
              let chunkIndex = 1;
              chunkIndex < expectedChunks;
              chunkIndex += 1
            ) {
              assertJobActive(jobId);
              const chunkBase64 = chunkParts[chunkIndex];
              if (!chunkBase64) {
                throw new Error(`Missing processed chunk ${chunkIndex + 1}.`);
              }
              await RNFS.appendFile(destinationPath, chunkBase64, 'base64');
              bytesWritten += base64ByteSize(chunkBase64);
              const progress = Math.min(
                97,
                Math.round(46 + ((chunkIndex + 1) / expectedChunks) * 50),
              );
              patchJob(jobId, {
                status: 'downloading',
                phase: 'downloading',
                progress,
                downloadedBytes: bytesWritten,
                totalBytes: totalBytesFromBridge,
              });
            }

            const stat = await RNFS.stat(destinationPath).catch(() => null);
            finalFileSize = Number(stat?.size) || bytesWritten || 0;
            log('Processed blob file written from bridge chunks.', {
              jobId,
              attempt,
              filename: filenameFromBridge || null,
              path: destinationPath,
              chunkCount: expectedChunks,
              totalBytes: totalBytesFromBridge,
              fileSize: finalFileSize,
            });
          } else {
            const mediaUrl = String(bridgeDownload?.mediaUrl || '').trim();
            if (!mediaUrl) {
              throw new Error(
                'No media URL or processed blob captured from webview download flow.',
              );
            }

            const extension = normalizeMediaExtension(mediaUrl);
            const baseName = sanitizeFileSegment(
              `${resolvedSong.artist} - ${resolvedSong.title}`,
            );
            const filenameBase = baseName || `Track_${now()}`;
            const preferredPath = `${destinationDir}/${filenameBase}${extension}`;
            destinationPath = await storageService.ensureUniquePath(
              preferredPath,
            );

            const nativeHeaders = buildNativeDownloadHeaders(bridgeDownload);
            let knownTotalBytes = Number(bridgeDownload?.contentLength) || null;

            log('Received media URL from bridge.', {
              jobId,
              attempt,
              mediaUrl,
              setting: bridgeDownload?.appliedSetting || job.downloadSetting,
              bridgeStatus: Number(bridgeDownload?.status) || null,
              bridgeLength: Number(bridgeDownload?.contentLength) || null,
              headerKeys: Object.keys(nativeHeaders),
            });

            patchJob(jobId, {
              status: 'downloading',
              phase: 'downloading',
              progress: 42,
              downloadedBytes: 0,
              totalBytes: knownTotalBytes,
            });

            const task = RNFS.downloadFile({
              fromUrl: mediaUrl,
              toFile: destinationPath,
              headers: nativeHeaders,
              background: true,
              discretionary: true,
              begin: response => {
                const total =
                  Number(response?.contentLength) || knownTotalBytes;
                knownTotalBytes = total;
                patchJob(jobId, {
                  status: 'downloading',
                  phase: 'downloading',
                  progress: 46,
                  downloadedBytes: 0,
                  totalBytes: total,
                });
              },
              progressDivider: 1,
              progress: response => {
                const written = Number(response?.bytesWritten) || 0;
                const total =
                  Number(response?.contentLength) || knownTotalBytes;
                const ratio = total && total > 0 ? written / total : null;
                const progress =
                  ratio !== null
                    ? Math.min(97, Math.round(46 + ratio * 50))
                    : undefined;
                patchJob(jobId, {
                  status: 'downloading',
                  phase: 'downloading',
                  ...(typeof progress === 'number' ? {progress} : null),
                  downloadedBytes: written,
                  totalBytes: total || null,
                });
              },
            });

            activeNativeDownloadRef.current = {jobId, taskId: task.jobId};
            try {
              downloadResponse = await task.promise;
            } finally {
              if (activeNativeDownloadRef.current?.jobId === jobId) {
                activeNativeDownloadRef.current = null;
              }
            }

            if (cancelledJobsRef.current.has(jobId)) {
              throw new Error(CANCELLED_ERROR);
            }

            if (
              !downloadResponse ||
              downloadResponse.statusCode < 200 ||
              downloadResponse.statusCode >= 300
            ) {
              throw new Error(
                `Native file download failed (${
                  downloadResponse?.statusCode || 'unknown'
                }).`,
              );
            }

            const stat = await RNFS.stat(destinationPath).catch(() => null);
            finalFileSize = Number(stat?.size) || 0;
            const expectedBytes = Number(bridgeDownload?.contentLength) || 0;
            const expectedFloor =
              expectedBytes > 0
                ? Math.max(8192, Math.floor(expectedBytes * 0.08))
                : MIN_VALID_AUDIO_FILE_BYTES;

            log('Native media download finished.', {
              jobId,
              attempt,
              path: destinationPath,
              statusCode: Number(downloadResponse?.statusCode) || null,
              bytesWritten: Number(downloadResponse?.bytesWritten) || null,
              fileSize: finalFileSize,
              expectedBytes: expectedBytes || null,
            });

            if (finalFileSize < expectedFloor) {
              throw new Error(
                `Downloaded file looks incomplete (${finalFileSize} bytes).`,
              );
            }
          }

          attemptError = null;
          break;
        } catch (error) {
          attemptError = error;

          if (destinationPath) {
            await RNFS.unlink(destinationPath).catch(() => {});
          }

          if (cancelledJobsRef.current.has(jobId)) {
            throw new Error(CANCELLED_ERROR);
          }

          const errorMessage = error?.message || String(error);

          if (
            errorMessage === CANCELLED_ERROR ||
            errorMessage === NO_MATCH_FOUND_ERROR ||
            attempt >= MAX_NATIVE_DOWNLOAD_ATTEMPTS
          ) {
            throw error;
          }

          log('Native download attempt failed. Retrying.', {
            jobId,
            attempt,
            error: error?.message || String(error),
          });
        }
      }

      if (attemptError) {
        throw attemptError;
      }

      assertJobActive(jobId);

      patchJob(jobId, {
        status: 'downloading',
        phase: 'saving',
        progress: 98,
      });

      let embeddedArtwork = null;
      if (canExtractEmbeddedArtwork(destinationPath)) {
        embeddedArtwork = await extractEmbeddedArtworkDataUri(destinationPath);
        if (!embeddedArtwork) {
          log(
            'Embedded artwork not found in downloaded file. Using fallback artwork URL.',
            {
              jobId,
              path: destinationPath,
            },
          );
        }
      } else {
        log(
          'Artwork parser does not support this file extension. Using fallback artwork URL.',
          {
            jobId,
            path: destinationPath,
          },
        );
      }

      const filename = destinationPath.split('/').pop();
      const localSong = {
        ...resolvedSong,
        artwork: embeddedArtwork || resolvedSong.artwork || null,
        id: `squid_${now()}_${Math.random().toString(36).slice(2, 7)}`,
        sourceSongId: null,
        filename,
        sourceFilename: filename,
        url: toFileUriFromPath(destinationPath),
        localPath: destinationPath,
        isLocal: true,
      };

      const savedSong = await storageService.saveRemoteSongToDevice(localSong);
      const stat = await RNFS.stat(destinationPath).catch(() => null);
      const size = Number(stat?.size) || finalFileSize || 0;
      const finalSong = savedSong || localSong;

      patchJob(jobId, {
        status: 'done',
        phase: 'done',
        progress: 100,
        title: finalSong.title || resolvedSong.title,
        artist: finalSong.artist || resolvedSong.artist,
        album: finalSong.album || resolvedSong.album,
        artwork: finalSong.artwork || resolvedSong.artwork,
        duration: Number(finalSong.duration) || resolvedSong.duration || 0,
        downloadedBytes: size,
        totalBytes: size || null,
        song: {
          ...finalSong,
          downloadable: true,
        },
      });
      log('Download job completed.', {jobId, filename});
    },
    [
      assertJobActive,
      ensureAlbumDownloadPage,
      log,
      patchJob,
      postBridgeCommand,
    ],
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current) {
      log('Queue processor already running. Skipping.');
      return;
    }

    log('Queue processor started.');
    processingRef.current = true;
    try {
      while (true) {
        const nextJob = Array.from(jobsRef.current.values()).find(
          item => item.status === 'queued',
        );
        if (!nextJob) {
          break;
        }

        try {
          await runJobDownload(nextJob);
        } catch (error) {
          if (
            error?.message === CANCELLED_ERROR ||
            cancelledJobsRef.current.has(nextJob.id)
          ) {
            cancelledJobsRef.current.delete(nextJob.id);
            continue;
          }

          patchJob(nextJob.id, {
            status: 'failed',
            phase: 'failed',
            error: error?.message || String(error),
          });
          log('Download job failed.', {
            jobId: nextJob.id,
            error: error?.message || String(error),
          });
        }
      }
    } finally {
      processingRef.current = false;
      log('Queue processor stopped.');
    }
  }, [log, patchJob, runJobDownload]);

  const searchSongs = useCallback(
    async (query, searchType = 'tracks') => {
      log('Starting search.', {query, searchType});
      await bootstrapBridge();

      const expectedHomeHref = normalizeComparableUrl(SQUID_WEB_URL);
      let currentHref = '';

      try {
        const ping = await sendBridgeCommandRaw(
          'ping',
          {reason: 'search-home-check'},
          BRIDGE_PING_TIMEOUT_MS,
        );
        currentHref = String(ping?.href || '').trim();
      } catch (error) {
        log('Bridge ping before search failed.', {
          error: error?.message || String(error),
        });
      }

      if (normalizeComparableUrl(currentHref) !== expectedHomeHref) {
        const webView = webViewRef.current;
        if (!webView || typeof webView.injectJavaScript !== 'function') {
          throw new Error('Hidden webview is unavailable.');
        }

        const targetHref = toAbsoluteSquidUrl(SQUID_WEB_URL);
        activeAlbumUrlRef.current = '';
        pendingAlbumUrlRef.current = '';
        log(
          'Search requested while hidden webview is not on homepage. Navigating before dispatch.',
          {
            currentHref: currentHref || null,
            targetHref,
          },
        );
        webView.injectJavaScript(
          `window.location.href = ${JSON.stringify(targetHref)}; true;`,
        );

        const timeoutMs = 30000;
        const startedAt = now();
        let homeReady = false;

        while (now() - startedAt < timeoutMs) {
          const remainingMs = timeoutMs - (now() - startedAt);
          const waitMs = Math.max(1200, Math.min(7000, remainingMs));
          await waitForBridgeReady(waitMs);

          try {
            const ping = await sendBridgeCommandRaw(
              'ping',
              {reason: 'search-home-wait'},
              BRIDGE_PING_TIMEOUT_MS,
            );
            currentHref = String(ping?.href || '').trim();
          } catch (_) {
            await sleep(220);
            continue;
          }

          if (normalizeComparableUrl(currentHref) === expectedHomeHref) {
            homeReady = true;
            break;
          }

          await sleep(220);
        }

        if (!homeReady) {
          throw new Error(
            'Hidden webview did not return to homepage before search.',
          );
        }
      }

      const response = await postBridgeCommand(
        'search',
        {
          q: String(query || '').trim(),
          type: String(searchType || 'tracks').toLowerCase(),
        },
        65000,
      );

      const items = Array.isArray(response?.items) ? response.items : [];
      log('Search completed.', {query, searchType, count: items.length});
      return items.map((item, index) =>
        normalizeResultItem(item, index, searchType),
      );
    },
    [
      bootstrapBridge,
      log,
      postBridgeCommand,
      sendBridgeCommandRaw,
      waitForBridgeReady,
    ],
  );

  const navigateWebViewTo = useCallback(targetUrl => {
    const absoluteUrl = toAbsoluteSquidUrl(targetUrl);
    if (!absoluteUrl) {
      throw new Error('Invalid target URL for hidden webview navigation.');
    }

    const webView = webViewRef.current;
    if (!webView || typeof webView.injectJavaScript !== 'function') {
      throw new Error('Hidden webview is unavailable.');
    }

    const script = `window.location.href = ${JSON.stringify(
      absoluteUrl,
    )}; true;`;
    webView.injectJavaScript(script);
    return absoluteUrl;
  }, []);

  const waitForBridgeHref = useCallback(
    async (targetUrl, timeoutMs = 26000) => {
      const expectedHref = normalizeComparableUrl(targetUrl);
      if (!expectedHref) {
        throw new Error('Invalid target URL.');
      }

      const startedAt = now();
      while (now() - startedAt < timeoutMs) {
        const remainingMs = timeoutMs - (now() - startedAt);
        const waitMs = Math.max(1200, Math.min(8000, remainingMs));
        await waitForBridgeReady(waitMs);

        let ping = null;
        try {
          ping = await sendBridgeCommandRaw(
            'ping',
            {reason: 'album-href-check'},
            BRIDGE_PING_TIMEOUT_MS,
          );
        } catch (_) {
          await sleep(220);
          continue;
        }

        const currentHref = String(ping?.href || '').trim();
        const normalizedCurrentHref = normalizeComparableUrl(currentHref);
        if (normalizedCurrentHref === expectedHref) {
          return currentHref || expectedHref;
        }

        await sleep(220);
      }

      throw new Error('Album page is not ready in hidden webview.');
    },
    [sendBridgeCommandRaw, waitForBridgeReady],
  );

  const ensureAlbumDownloadPage = useCallback(
    async requestedAlbumUrl => {
      const fallbackAlbumUrl =
        activeAlbumUrlRef.current || pendingAlbumUrlRef.current;
      const targetUrl = toAbsoluteSquidUrl(
        requestedAlbumUrl || fallbackAlbumUrl,
      );
      if (!targetUrl) {
        throw new Error('Album URL is missing for direct album download.');
      }

      try {
        await waitForBridgeHref(targetUrl, 5500);
      } catch (_) {
        log('Hidden webview drifted away from album page. Re-navigating.', {
          targetUrl,
        });
        navigateWebViewTo(targetUrl);
        await waitForBridgeHref(targetUrl, 30000);
      }

      activeAlbumUrlRef.current = targetUrl;
      return targetUrl;
    },
    [log, navigateWebViewTo, waitForBridgeHref],
  );

  const getAlbumTracks = useCallback(
    async album => {
      const albumUrl = album?.url || album?.albumUrl || '';
      const targetUrl = toAbsoluteSquidUrl(albumUrl);
      if (!targetUrl) {
        throw new Error('Album URL is missing.');
      }
      const normalizedTargetUrl = normalizeComparableUrl(targetUrl);
      pendingAlbumUrlRef.current = targetUrl;

      log('Loading album tracks.', {
        url: albumUrl || null,
        title: album?.title || null,
      });

      let lastError = null;
      try {
        for (
          let attempt = 1;
          attempt <= MAX_ALBUM_TRACK_ATTEMPTS;
          attempt += 1
        ) {
          try {
            navigateWebViewTo(targetUrl);
            const currentHref = await waitForBridgeHref(targetUrl, 28000);

            if (
              normalizeComparableUrl(pendingAlbumUrlRef.current) !==
              normalizedTargetUrl
            ) {
              throw new Error('Album track request superseded.');
            }

            log('Dispatching albumTracks after target page bridge-ready.', {
              attempt,
              targetUrl,
              currentHref: currentHref || null,
            });

            const response = await postBridgeCommand(
              'albumTracks',
              {
                url: targetUrl,
                album: album?.title || album?.album || '',
                artist: album?.artist || '',
                artwork: album?.artwork || '',
              },
              70000,
            );
            const items = Array.isArray(response?.items) ? response.items : [];
            activeAlbumUrlRef.current = targetUrl;
            log('Album tracks loaded.', {
              url: targetUrl,
              count: items.length,
              attempt,
            });
            return items.map((item, index) =>
              normalizeResultItem(item, index, 'track'),
            );
          } catch (error) {
            lastError = error;
            if (
              String(error?.message || '') === 'Album track request superseded.'
            ) {
              throw error;
            }
            if (attempt >= MAX_ALBUM_TRACK_ATTEMPTS) {
              break;
            }
            log('Album tracks load attempt failed. Retrying.', {
              attempt,
              url: targetUrl,
              error: error?.message || String(error),
            });
            await sleep(300);
          }
        }
      } finally {
        if (
          normalizeComparableUrl(pendingAlbumUrlRef.current) ===
          normalizedTargetUrl
        ) {
          pendingAlbumUrlRef.current = '';
        }
      }

      throw lastError || new Error('Failed to load album tracks.');
    },
    [log, navigateWebViewTo, postBridgeCommand, waitForBridgeHref],
  );

  const startDownload = useCallback(
    async (song, index = null, downloadSetting = DEFAULT_DOWNLOAD_SETTING) => {
      const queued = queueDownloadJob(song, index, downloadSetting);
      log('Queued download job.', {
        jobId: queued?.id,
        title: queued?.title,
        artist: queued?.artist,
      });
      processQueue().catch(() => {});
      return queued;
    },
    [log, processQueue, queueDownloadJob],
  );

  const getDownloadJobs = useCallback(
    async limit => toPublicJobs(limit),
    [toPublicJobs],
  );

  const retryDownload = useCallback(
    async (
      jobId,
      fallbackSong = null,
      downloadSetting = DEFAULT_DOWNLOAD_SETTING,
    ) => {
      const job = jobsRef.current.get(jobId);
      if (!job) {
        throw new Error('Download job not found');
      }
      if (ACTIVE_STATUSES.has(job.status)) {
        throw new Error('Download is already in progress.');
      }

      const requestSong = normalizeSong(
        job?.request?.song ||
          fallbackSong || {
            title: job.title,
            artist: job.artist,
            album: job.album,
            artwork: job.artwork,
            duration: job.duration,
          },
      );
      const resolvedRetrySetting = normalizeDownloadSetting(
        downloadSetting || job.downloadSetting,
      );

      cancelledJobsRef.current.delete(jobId);
      patchJob(jobId, {
        status: 'queued',
        phase: 'queued',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
        song: null,
        request: {
          index: job.requestIndex,
          song: requestSong,
          downloadSetting: resolvedRetrySetting,
        },
        downloadSetting: resolvedRetrySetting,
      });

      log('Retry queued for job.', {jobId});
      processQueue().catch(() => {});
      return cloneJob(jobsRef.current.get(jobId));
    },
    [log, patchJob, processQueue],
  );

  const cancelDownload = useCallback(
    async jobId => {
      const existing = jobsRef.current.get(jobId);
      if (!existing) {
        return true;
      }

      const commandId = jobCommandMapRef.current.get(jobId);
      if (commandId) {
        rejectPendingCommand(commandId, 'Download job cancelled.', {
          reason: 'job-cancelled',
        });
        jobCommandMapRef.current.delete(jobId);
      }

      cancelledJobsRef.current.add(jobId);

      if (activeNativeDownloadRef.current?.jobId === jobId) {
        const taskId = activeNativeDownloadRef.current.taskId;
        if (Number.isInteger(taskId)) {
          try {
            RNFS.stopDownload(taskId);
          } catch (error) {
            // ignore stop errors
          }
        }
      }

      jobsRef.current.delete(jobId);
      log('Cancelled download job.', {jobId});
      return true;
    },
    [log, rejectPendingCommand],
  );

  const handleWebViewLoadStart = useCallback(
    event => {
      const rawUrl = String(event?.nativeEvent?.url || '').trim();
      const comparableUrl = normalizeComparableUrl(rawUrl);
      const timestamp = now();
      const lastLoadEnd = lastLoadEndRef.current;
      const deltaMs = timestamp - Number(lastLoadEnd?.timestamp || 0);

      log('WebView onLoadStart.', {url: rawUrl || null});

      if (
        comparableUrl &&
        comparableUrl === lastLoadEnd?.url &&
        deltaMs >= 0 &&
        deltaMs < DUPLICATE_LOAD_DEBOUNCE_MS
      ) {
        log('Ignoring duplicate WebView onLoadStart event.', {
          url: rawUrl || null,
          deltaMs,
          debounceMs: DUPLICATE_LOAD_DEBOUNCE_MS,
        });
        return;
      }

      resetBridgeState();
    },
    [log, resetBridgeState],
  );

  const handleWebViewLoadEnd = useCallback(
    event => {
      const rawUrl = String(event?.nativeEvent?.url || '').trim();
      const comparableUrl = normalizeComparableUrl(rawUrl);
      lastLoadEndRef.current = {
        url: comparableUrl,
        timestamp: now(),
      };

      log('WebView onLoadEnd.', {url: rawUrl || null});
      bootstrapBridge(10000).catch(error => {
        log('Bootstrap after onLoadEnd failed.', {
          error: error?.message || String(error),
        });
      });
    },
    [bootstrapBridge, log],
  );

  const webViewProps = useMemo(
    () => ({
      source: {uri: SQUID_WEB_URL},
      originWhitelist: ['*'],
      javaScriptEnabled: true,
      domStorageEnabled: true,
      sharedCookiesEnabled: true,
      thirdPartyCookiesEnabled: true,
      setSupportMultipleWindows: false,
      mixedContentMode: 'always',
      injectedJavaScriptBeforeContentLoaded: SQUID_BRIDGE_SCRIPT,
      injectedJavaScript: SQUID_BRIDGE_SCRIPT,
      onLoadStart: handleWebViewLoadStart,
      onLoadEnd: handleWebViewLoadEnd,
      onError: event => {
        log('WebView onError.', event?.nativeEvent || null);
      },
      onHttpError: event => {
        log('WebView onHttpError.', event?.nativeEvent || null);
      },
      onNavigationStateChange: navState => {
        log('WebView navigation change.', {
          url: navState?.url || null,
          loading: Boolean(navState?.loading),
          canGoBack: Boolean(navState?.canGoBack),
        });
      },
      onMessage: handleBridgeMessage,
    }),
    [handleBridgeMessage, handleWebViewLoadEnd, handleWebViewLoadStart, log],
  );

  return {
    webViewRef,
    webViewProps,
    searchSongs,
    getAlbumTracks,
    startDownload,
    getDownloadJobs,
    retryDownload,
    cancelDownload,
  };
}

export default useSquidWebViewDownloader;
