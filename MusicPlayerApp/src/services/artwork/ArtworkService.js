import RNFS from 'react-native-fs';
import {getFileExtension, normalizeFilePath} from './helpers/path.helpers';
import {writeDataUriToArtworkCache} from './helpers/cache.helpers';
import {extractFlacArtworkDataUri} from './parsers/flac.parser';
import {extractMp3ArtworkDataUri} from './parsers/mp3.parser';
import {extractMp4ArtworkDataUri} from './parsers/mp4.parser';

const NO_ARTWORK = Symbol('NO_ARTWORK');
const artworkCache = new Map();
const artworkInFlight = new Map();

const ARTWORK_EXTRACTORS_BY_EXTENSION = {
  flac: extractFlacArtworkDataUri,
  mp3: extractMp3ArtworkDataUri,
  m4a: extractMp4ArtworkDataUri,
  mp4: extractMp4ArtworkDataUri,
  m4b: extractMp4ArtworkDataUri,
  aac: extractMp4ArtworkDataUri,
};

const INLINE_ARTWORK_URI_PREFIX = 'data:image/';

function resolveExtractor(filePath) {
  const extension = getFileExtension(filePath);
  return ARTWORK_EXTRACTORS_BY_EXTENSION[extension] || null;
}

function isExtractablePath(filePath) {
  return Boolean(filePath && resolveExtractor(filePath));
}

function resolveCacheKey(trackOrPath) {
  return normalizeFilePath(trackOrPath);
}

function normalizeArtworkUri(artworkUri) {
  const normalized = String(artworkUri || '').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('/')) {
    return `file://${normalized}`;
  }

  return normalized;
}

function isInlineArtworkUri(uri) {
  return String(uri || '')
    .trim()
    .toLowerCase()
    .startsWith(INLINE_ARTWORK_URI_PREFIX);
}

async function optimizeArtworkUri(sourceKey, artworkUri) {
  const normalizedUri = normalizeArtworkUri(artworkUri);
  if (!normalizedUri) {
    return null;
  }

  if (!isInlineArtworkUri(normalizedUri)) {
    return normalizedUri;
  }

  const cachedUri = await writeDataUriToArtworkCache(sourceKey, normalizedUri);
  return cachedUri || normalizedUri;
}

export function canExtractEmbeddedArtwork(trackOrPath) {
  const filePath = resolveCacheKey(trackOrPath);
  return isExtractablePath(filePath);
}

export async function optimizeArtworkUriForTrack(trackOrPath, artworkUri) {
  const sourceKey =
    resolveCacheKey(trackOrPath) ||
    String(trackOrPath?.id || trackOrPath?.url || artworkUri || '').trim();

  return optimizeArtworkUri(sourceKey, artworkUri);
}

export async function extractEmbeddedArtworkDataUri(trackOrPath) {
  const filePath = resolveCacheKey(trackOrPath);
  const extractor = resolveExtractor(filePath);
  if (!filePath || !extractor) {
    return null;
  }

  if (artworkCache.has(filePath)) {
    const cached = artworkCache.get(filePath);
    return cached === NO_ARTWORK ? null : cached;
  }

  const existingTask = artworkInFlight.get(filePath);
  if (existingTask) {
    return existingTask;
  }

  const extractionTask = (async () => {
    const exists = await RNFS.exists(filePath).catch(() => false);
    if (!exists) {
      artworkCache.set(filePath, NO_ARTWORK);
      return null;
    }

    const extractedArtwork = await extractor(filePath);
    if (!extractedArtwork) {
      artworkCache.set(filePath, NO_ARTWORK);
      return null;
    }

    const optimizedArtwork = await optimizeArtworkUri(
      filePath,
      extractedArtwork,
    );
    if (!optimizedArtwork) {
      artworkCache.set(filePath, NO_ARTWORK);
      return null;
    }

    artworkCache.set(filePath, optimizedArtwork);
    return optimizedArtwork;
  })()
    .catch(() => {
      artworkCache.set(filePath, NO_ARTWORK);
      return null;
    })
    .finally(() => {
      artworkInFlight.delete(filePath);
    });

  artworkInFlight.set(filePath, extractionTask);
  return extractionTask;
}
