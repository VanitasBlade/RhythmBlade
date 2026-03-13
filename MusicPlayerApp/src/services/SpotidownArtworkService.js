import RNFS from 'react-native-fs';
import {Buffer} from 'buffer';
import storageService from './storage/StorageService';
import {
  sanitizeFileSegment,
  toFileUriFromPath,
} from './storage/storage.helpers';

const LOG_PREFIX = '[SpotidownArtworkService]';
const SPOTIFY_ARTWORK_300_TOKEN = 'ab67616d00001e02';
const SPOTIFY_ARTWORK_640_TOKEN = 'ab67616d0000b273';
const COVER_FETCH_TIMEOUT_MS = 12000;
const SPOTIFY_CANONICAL_ARTWORK_HOST = 'i.scdn.co';

function log(message, context = null) {
  if (context === null || typeof context === 'undefined') {
    console.log(`${LOG_PREFIX} ${message}`);
    return;
  }
  console.log(`${LOG_PREFIX} ${message}`, context);
}

export function buildArtworkKey(artist, title) {
  const normalizedArtist = String(artist || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const normalizedTitle = String(title || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!normalizedArtist && !normalizedTitle) {
    return '';
  }
  return `${normalizedArtist}::${normalizedTitle}`;
}

export function isSpotidownArtworkUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return false;
  }
  const lower = raw.toLowerCase();
  if (!lower.includes('i.scdn.co')) {
    return false;
  }
  const authorityMatch = lower.match(/^https?:\/\/([^/?#]+)/i);
  if (!authorityMatch?.[1]) {
    return lower.includes('i.scdn.co');
  }
  const authority = String(authorityMatch[1] || '');
  const hostPort = authority.includes('@')
    ? String(authority.split('@').pop() || '')
    : authority;
  const host = String(hostPort.split(':')[0] || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  return host === 'i.scdn.co' || host.endsWith('.i.scdn.co');
}

function toCanonicalSpotifyArtworkUrl(url) {
  const normalized = String(url || '').trim();
  if (!normalized) {
    return '';
  }
  const schemeMatch = normalized.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  const scheme = String(schemeMatch?.[1] || '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    return '';
  }
  const authorityMatch = normalized.match(/^https?:\/\/([^/?#]+)/i);
  const authority = String(authorityMatch?.[1] || '');
  if (!authority) {
    return '';
  }
  const hostPort = authority.includes('@')
    ? String(authority.split('@').pop() || '')
    : authority;
  const host = String(hostPort.split(':')[0] || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  const allowedHost =
    host === SPOTIFY_CANONICAL_ARTWORK_HOST ||
    /^image-cdn-[a-z0-9-]+\.spotifycdn\.com$/i.test(host);
  if (!allowedHost) {
    return '';
  }
  const pathMatch = normalized.match(/^https?:\/\/[^/?#]+([^?#]*)/i);
  const pathname = String(pathMatch?.[1] || '/');
  const pathSegments = pathname.split('/').filter(Boolean);
  if (
    pathSegments.length < 2 ||
    String(pathSegments[0] || '').toLowerCase() !== 'image'
  ) {
    return '';
  }
  const artworkHash = String(pathSegments[1] || '').trim();
  if (!artworkHash) {
    return '';
  }
  const queryMatch = normalized.match(/\?[^#]*/);
  const query = String(queryMatch?.[0] || '').trim();
  return `https://${SPOTIFY_CANONICAL_ARTWORK_HOST}/image/${artworkHash}${query}`;
}

function extractSpotifyArtworkHash(url) {
  const normalized = toCanonicalSpotifyArtworkUrl(url);
  if (!normalized) {
    return '';
  }
  const pathMatch = normalized.match(/^https?:\/\/[^/?#]+([^?#]*)/i);
  const pathname = String(pathMatch?.[1] || '/');
  const pathSegments = pathname.split('/').filter(Boolean);
  if (
    pathSegments.length < 2 ||
    String(pathSegments[0] || '').toLowerCase() !== 'image'
  ) {
    return '';
  }
  return String(pathSegments[1] || '')
    .trim()
    .toLowerCase();
}

function resolveCoverFileName(artist, title, artworkUrl) {
  const artworkHash = extractSpotifyArtworkHash(artworkUrl);
  const rawBase = `${String(artist || '').trim()}_${String(
    title || '',
  ).trim()}${artworkHash ? `_${artworkHash}` : ''}`;
  const sanitized = sanitizeFileSegment(rawBase) || `Spotidown_${Date.now()}`;
  return `${sanitized}.jpg`;
}

function toBase64FromArrayBuffer(arrayBuffer) {
  if (!arrayBuffer) {
    return '';
  }
  return Buffer.from(arrayBuffer).toString('base64');
}

export function mutateSpotifyArtworkUrlTo640(url) {
  const normalized = toCanonicalSpotifyArtworkUrl(url);
  if (!normalized) {
    return '';
  }
  const pathMatch = normalized.match(/^https?:\/\/[^/?#]+([^?#]*)/i);
  const pathname = String(pathMatch?.[1] || '/');
  const pathSegments = pathname.split('/').filter(Boolean);
  if (
    pathSegments.length < 2 ||
    String(pathSegments[0] || '').toLowerCase() !== 'image'
  ) {
    return '';
  }
  const artworkHash = String(pathSegments[1] || '').trim();
  if (!artworkHash) {
    return '';
  }
  const upgradedHash = artworkHash.replace(
    new RegExp(SPOTIFY_ARTWORK_300_TOKEN, 'ig'),
    SPOTIFY_ARTWORK_640_TOKEN,
  );
  if (
    upgradedHash.toLowerCase() === artworkHash.toLowerCase() &&
    artworkHash.toLowerCase().includes(SPOTIFY_ARTWORK_640_TOKEN.toLowerCase())
  ) {
    return normalized;
  }
  const queryMatch = normalized.match(/\?[^#]*/);
  const query = String(queryMatch?.[0] || '');
  return `https://${SPOTIFY_CANONICAL_ARTWORK_HOST}/image/${upgradedHash}${String(
    query || '',
  )}`;
}

function resolveArtworkCandidates(url) {
  const canonicalOriginal = toCanonicalSpotifyArtworkUrl(url);
  if (!canonicalOriginal) {
    return [];
  }
  const mutated = mutateSpotifyArtworkUrlTo640(canonicalOriginal);
  if (!mutated || mutated === canonicalOriginal) {
    return [canonicalOriginal];
  }
  return [mutated, canonicalOriginal];
}

async function fetchArrayBufferWithTimeout(
  url,
  timeoutMs = COVER_FETCH_TIMEOUT_MS,
) {
  const requestUrl = String(url || '').trim();
  if (!requestUrl) {
    throw new Error('cover-url-missing');
  }
  const supportsAbort =
    typeof AbortController === 'function' && typeof AbortSignal === 'function';
  const controller = supportsAbort ? new AbortController() : null;
  const timer = setTimeout(() => {
    if (controller) {
      try {
        controller.abort();
      } catch (_) {
        // Ignore abort errors.
      }
    }
  }, Math.max(1000, Number(timeoutMs) || COVER_FETCH_TIMEOUT_MS));

  try {
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        Accept: 'image/*,*/*;q=0.8',
      },
      ...(controller ? {signal: controller.signal} : {}),
    });
    const statusCode = Number(response?.status) || 0;
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`cover-download-status-${statusCode}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      arrayBuffer,
      statusCode,
    };
  } catch (error) {
    const message = String(error?.message || error || '').trim();
    if (message.toLowerCase().includes('abort')) {
      throw new Error('cover-download-timeout');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function resolveInternalCoverDirectory() {
  return `${String(storageService.musicDir || '').trim()}/AlbumCovers`;
}

export async function ensureSpotidownCover({artworkUrl, artist, title} = {}) {
  const normalizedUrl = toCanonicalSpotifyArtworkUrl(artworkUrl);
  const artworkCandidates = resolveArtworkCandidates(normalizedUrl);
  const key = buildArtworkKey(artist, title);
  if (!isSpotidownArtworkUrl(normalizedUrl)) {
    log('Skipping cover download because URL is not Spotidown artwork.', {
      artworkUrl: normalizedUrl || null,
      key: key || null,
    });
    return {
      ok: false,
      skipped: true,
      reason: 'non-spotidown-artwork-url',
      artworkUrl: normalizedUrl || null,
      artworkKey: key || null,
      coverPath: null,
      coverUri: null,
      downloaded: false,
      existed: false,
      bytes: 0,
    };
  }

  try {
    const coversDir = resolveInternalCoverDirectory();
    if (!coversDir) {
      return {
        ok: false,
        skipped: false,
        reason: 'cover-directory-unavailable',
        artworkUrl: normalizedUrl || null,
        artworkKey: key || null,
        coverPath: null,
        coverUri: null,
        downloaded: false,
        existed: false,
        bytes: 0,
      };
    }

    const filename = resolveCoverFileName(artist, title, normalizedUrl);
    await storageService.ensureDirectory(coversDir);
    const coverPath = `${coversDir}/${filename}`;
    const coverUri = toFileUriFromPath(coverPath);
    const exists = await RNFS.exists(coverPath);
    if (exists) {
      const existingStat = await RNFS.stat(coverPath).catch(() => null);
      const existingBytes = Number(existingStat?.size) || 0;
      if (existingBytes > 0) {
        log('Reusing existing Spotidown cover file.', {
          coverPath,
          bytes: existingBytes,
          key: key || null,
        });
        return {
          ok: true,
          skipped: true,
          reason: 'cover-already-exists',
          artworkUrl: normalizedUrl,
          artworkKey: key || null,
          coverPath,
          coverUri,
          downloaded: false,
          existed: true,
          bytes: existingBytes,
        };
      }

      await RNFS.unlink(coverPath).catch(() => {});
    }

    let selectedUrl = normalizedUrl;
    let base64 = '';
    let lastFailure = null;
    for (const candidateUrl of artworkCandidates) {
      if (!candidateUrl) {
        continue;
      }
      selectedUrl = candidateUrl;
      log('Downloading Spotidown artwork candidate.', {
        artworkUrl: candidateUrl,
        coverPath,
        key: key || null,
      });
      try {
        const {arrayBuffer} = await fetchArrayBufferWithTimeout(candidateUrl);
        base64 = toBase64FromArrayBuffer(arrayBuffer);
        if (base64) {
          break;
        }
        lastFailure = 'cover-empty-response-body';
      } catch (error) {
        lastFailure = error?.message || 'cover-download-failed';
      }
    }

    if (!base64) {
      return {
        ok: false,
        skipped: false,
        reason: lastFailure || 'cover-empty-response-body',
        artworkUrl: selectedUrl || normalizedUrl,
        artworkKey: key || null,
        coverPath: null,
        coverUri: null,
        downloaded: false,
        existed: false,
        bytes: 0,
      };
    }

    await storageService.ensureDirectory(coversDir);
    await RNFS.writeFile(coverPath, base64, 'base64');

    const stat = await RNFS.stat(coverPath).catch(() => null);
    const bytes = Number(stat?.size) || 0;
    if (bytes <= 0) {
      await RNFS.unlink(coverPath).catch(() => {});
      return {
        ok: false,
        skipped: false,
        reason: 'cover-empty-file',
        artworkUrl: selectedUrl || normalizedUrl,
        artworkKey: key || null,
        coverPath: null,
        coverUri: null,
        downloaded: false,
        existed: false,
        bytes: 0,
      };
    }

    log('Spotidown cover ready.', {
      coverPath,
      bytes,
      key: key || null,
    });
    return {
      ok: true,
      skipped: false,
      reason: null,
      artworkUrl: selectedUrl || normalizedUrl,
      artworkKey: key || null,
      coverPath,
      coverUri,
      downloaded: true,
      existed: false,
      bytes,
    };
  } catch (error) {
    log('Failed to ensure Spotidown cover.', {
      artworkUrl: normalizedUrl || null,
      key: key || null,
      error: error?.message || String(error),
    });
    return {
      ok: false,
      skipped: false,
      reason: error?.message || 'cover-download-failed',
      artworkUrl: normalizedUrl || null,
      artworkKey: key || null,
      coverPath: null,
      coverUri: null,
      downloaded: false,
      existed: false,
      bytes: 0,
    };
  }
}

export default {
  buildArtworkKey,
  isSpotidownArtworkUrl,
  mutateSpotifyArtworkUrlTo640,
  ensureSpotidownCover,
};
