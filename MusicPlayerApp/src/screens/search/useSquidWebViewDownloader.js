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
import SQUID_BRIDGE_SCRIPT from './webview/squidBridgeScript';

const SQUID_WEB_URL = 'https://tidal.squid.wtf/';
const MAX_STORED_JOBS = 120;
const DEFAULT_DOWNLOAD_SETTING = 'Hi-Res';
const ACTIVE_STATUSES = new Set(['queued', 'preparing', 'downloading']);
const CANCELLED_ERROR = '__RB_DOWNLOAD_CANCELLED__';
const BRIDGE_BOOTSTRAP_TIMEOUT_MS = 25000;
const BRIDGE_BOOTSTRAP_RETRY_MS = 1200;
const BRIDGE_PING_TIMEOUT_MS = 3500;
const MAX_NATIVE_DOWNLOAD_ATTEMPTS = 2;
const MIN_VALID_AUDIO_FILE_BYTES = 64 * 1024;
const SQUID_ORIGIN = 'https://tidal.squid.wtf';
const BRIDGE_DOWNLOAD_CHUNK_EVENT = 'bridge-download-chunk';

function now() {
  return Date.now();
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
    const key = String(rawKey || '').trim().toLowerCase();
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
  const referer = String(bridgeDownload?.referer || SQUID_WEB_URL).trim() || SQUID_WEB_URL;
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
  const commandCounterRef = useRef(1);
  const jobsRef = useRef(new Map());
  const processingRef = useRef(false);
  const activeNativeDownloadRef = useRef(null);
  const cancelledJobsRef = useRef(new Set());

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

  const rejectPendingRequests = useCallback(message => {
    log('Rejecting pending bridge commands.', {
      count: pendingRequestsRef.current.size,
      message,
    });
    pendingRequestsRef.current.forEach(pending => {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(message));
    });
    pendingRequestsRef.current.clear();
  }, [log]);

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

  const waitForBridgeReady = useCallback((timeoutMs = 25000) => {
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
  }, [log]);

  const sendBridgeCommandRaw = useCallback(
    async (type, payload = {}, timeoutMs = 45000) => {
      const webView = webViewRef.current;
      if (!webView || typeof webView.postMessage !== 'function') {
        throw new Error('Hidden webview is unavailable.');
      }

      const id = `cmd_${now()}_${commandCounterRef.current++}`;
      const body = JSON.stringify({id, type, payload});

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
          pendingRequestsRef.current.delete(id);
          log('Bridge command timed out.', {id, type, timeoutMs});
          reject(new Error(`Webview command timed out: ${type}`));
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
        });

        log('Posting bridge command.', {id, type});
        webView.postMessage(body);
      });
    },
    [log],
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
            await new Promise(resolve => setTimeout(resolve, BRIDGE_BOOTSTRAP_RETRY_MS));
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

          await new Promise(resolve => setTimeout(resolve, BRIDGE_BOOTSTRAP_RETRY_MS));
        }
      } finally {
        bridgeBootstrappingRef.current = false;
      }

      throw new Error('Hidden webview bridge is not ready.');
    },
    [log, markBridgeReady, sendBridgeCommandRaw, waitForBridgeReady],
  );

  const handleBridgeMessage = useCallback(event => {
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
      return;
    }

    clearTimeout(pending.timeoutId);
    pendingRequestsRef.current.delete(parsed.id);

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
          filename:
            String(result.filename || pending.chunkState.filename || '').trim(),
          mimeType:
            String(result.mimeType || pending.chunkState.mimeType || '').trim(),
        };
      }

      pending.resolve(result);
      return;
    }

    pending.reject(new Error(parsed.error || 'Webview command failed.'));
  }, [log, markBridgeReady]);

  const postBridgeCommand = useCallback(
    async (type, payload = {}, timeoutMs = 45000) => {
      await bootstrapBridge();
      return sendBridgeCommandRaw(type, payload, timeoutMs);
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

  const queueDownloadJob = useCallback((song, index, downloadSetting) => {
    const requestSong = normalizeSong(song);
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
      downloadSetting: downloadSetting || DEFAULT_DOWNLOAD_SETTING,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      song: null,
      request: {
        index: requestIndex,
        song: requestSong,
        downloadSetting: downloadSetting || DEFAULT_DOWNLOAD_SETTING,
      },
      createdAt,
      updatedAt: createdAt,
    };

    jobsRef.current.set(job.id, job);
    trimJobs();
    return cloneJob(job);
  }, [trimJobs]);

  const toPublicJobs = useCallback((limit = 60) => {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 60, 200));
    const jobs = Array.from(jobsRef.current.values());
    return jobs.slice(-safeLimit).map(cloneJob);
  }, []);

  const runJobDownload = useCallback(
    async job => {
      const jobId = job.id;
      const requestSong = normalizeSong(job?.request?.song || {});
      log('Running download job.', {
        jobId,
        title: requestSong.title,
        artist: requestSong.artist,
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

          bridgeDownload = await postBridgeCommand(
            'download',
            {
              song: requestSong,
              downloadSetting: job.downloadSetting || DEFAULT_DOWNLOAD_SETTING,
              attempt,
            },
            130000,
          );

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
            destinationPath = await storageService.ensureUniquePath(preferredPath);

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

            for (let chunkIndex = 1; chunkIndex < expectedChunks; chunkIndex += 1) {
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
            destinationPath = await storageService.ensureUniquePath(preferredPath);

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
                const total = Number(response?.contentLength) || knownTotalBytes;
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
                const total = Number(response?.contentLength) || knownTotalBytes;
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
                `Native file download failed (${downloadResponse?.statusCode || 'unknown'}).`,
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

          if (
            error?.message === CANCELLED_ERROR ||
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
          log('Embedded artwork not found in downloaded file. Using fallback artwork URL.', {
            jobId,
            path: destinationPath,
          });
        }
      } else {
        log('Artwork parser does not support this file extension. Using fallback artwork URL.', {
          jobId,
          path: destinationPath,
        });
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
    [assertJobActive, log, patchJob, postBridgeCommand],
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
    [log, postBridgeCommand],
  );

  const getAlbumTracks = useCallback(
    async album => {
      log('Loading album tracks.', {
        url: album?.url || null,
        title: album?.title || null,
      });
      const response = await postBridgeCommand(
        'albumTracks',
        {
          url: album?.url || album?.albumUrl || '',
          album: album?.title || album?.album || '',
          artist: album?.artist || '',
          artwork: album?.artwork || '',
        },
        70000,
      );
      const items = Array.isArray(response?.items) ? response.items : [];
      log('Album tracks loaded.', {
        url: album?.url || null,
        count: items.length,
      });
      return items.map((item, index) => normalizeResultItem(item, index, 'track'));
    },
    [log, postBridgeCommand],
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

  const getDownloadJobs = useCallback(async limit => toPublicJobs(limit), [toPublicJobs]);

  const retryDownload = useCallback(
    async (jobId, fallbackSong = null, downloadSetting = DEFAULT_DOWNLOAD_SETTING) => {
      const job = jobsRef.current.get(jobId);
      if (!job) {
        throw new Error('Download job not found');
      }
      if (ACTIVE_STATUSES.has(job.status)) {
        throw new Error('Download is already in progress.');
      }

      const requestSong = normalizeSong(
        job?.request?.song || fallbackSong || {
          title: job.title,
          artist: job.artist,
          album: job.album,
          artwork: job.artwork,
          duration: job.duration,
        },
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
          downloadSetting: downloadSetting || job.downloadSetting,
        },
        downloadSetting: downloadSetting || job.downloadSetting,
      });

      log('Retry queued for job.', {jobId});
      processQueue().catch(() => {});
      return cloneJob(jobsRef.current.get(jobId));
    },
    [log, patchJob, processQueue],
  );

  const cancelDownload = useCallback(async jobId => {
    const existing = jobsRef.current.get(jobId);
    if (!existing) {
      return true;
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
  }, [log]);

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
      onLoadStart: event => {
        log('WebView onLoadStart.', {url: event?.nativeEvent?.url || null});
        resetBridgeState();
      },
      onLoadEnd: event => {
        log('WebView onLoadEnd.', {url: event?.nativeEvent?.url || null});
        bootstrapBridge(10000).catch(error => {
          log('Bootstrap after onLoadEnd failed.', {
            error: error?.message || String(error),
          });
        });
      },
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
    [bootstrapBridge, handleBridgeMessage, log, resetBridgeState],
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
