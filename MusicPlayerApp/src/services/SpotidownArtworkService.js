import RNFS from 'react-native-fs';
import {Buffer} from 'buffer';
import storageService from './storage/StorageService';
import {
  sanitizeFileSegment,
  toFileUriFromPath,
} from './storage/storage.helpers';

const LOG_PREFIX = '[SpotidownArtworkService]';

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

function resolveCoverFileName(artist, title) {
  const rawBase = `${String(artist || '').trim()}_${String(
    title || '',
  ).trim()}`;
  const sanitized = sanitizeFileSegment(rawBase) || `Spotidown_${Date.now()}`;
  return `${sanitized}.jpg`;
}

function toBase64FromArrayBuffer(arrayBuffer) {
  if (!arrayBuffer) {
    return '';
  }
  return Buffer.from(arrayBuffer).toString('base64');
}

function resolveInternalCoverDirectory() {
  return `${String(storageService.musicDir || '').trim()}/AlbumCovers`;
}

export async function ensureSpotidownCover({artworkUrl, artist, title} = {}) {
  const normalizedUrl = String(artworkUrl || '').trim();
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

    const filename = resolveCoverFileName(artist, title);
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

    log('Downloading Spotidown 640x640 artwork via fetch/writeFile.', {
      artworkUrl: normalizedUrl,
      coverPath,
      key: key || null,
    });
    const response = await fetch(normalizedUrl, {
      method: 'GET',
      headers: {
        Accept: 'image/*,*/*;q=0.8',
      },
    });
    const statusCode = Number(response?.status) || 0;
    if (statusCode < 200 || statusCode >= 300) {
      return {
        ok: false,
        skipped: false,
        reason: `cover-download-status-${statusCode}`,
        artworkUrl: normalizedUrl,
        artworkKey: key || null,
        coverPath: null,
        coverUri: null,
        downloaded: false,
        existed: false,
        bytes: 0,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = toBase64FromArrayBuffer(arrayBuffer);
    if (!base64) {
      return {
        ok: false,
        skipped: false,
        reason: 'cover-empty-response-body',
        artworkUrl: normalizedUrl,
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
        artworkUrl: normalizedUrl,
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
      artworkUrl: normalizedUrl,
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
  ensureSpotidownCover,
};
