import RNFS from 'react-native-fs';

const ARTWORK_CACHE_DIR_NAME = 'embedded-artwork';
const DATA_URI_PATTERN = /^data:([^;]+);base64,(.+)$/i;

const MIME_EXTENSION_MAP = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};

let artworkCacheDirPromise = null;

function hashText(value) {
  const input = String(value || '');
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33 + input.charCodeAt(index)) % 4294967296;
  }
  return hash.toString(36);
}

function toCacheFileExtension(mimeType) {
  const normalizedMime = String(mimeType || '')
    .trim()
    .toLowerCase();
  if (MIME_EXTENSION_MAP[normalizedMime]) {
    return MIME_EXTENSION_MAP[normalizedMime];
  }
  const fallback = normalizedMime.split('/')[1] || 'jpg';
  return fallback.replace(/[^a-z0-9]/gi, '') || 'jpg';
}

function parseImageDataUri(dataUri) {
  const source = String(dataUri || '').trim();
  const match = source.match(DATA_URI_PATTERN);
  if (!match) {
    return null;
  }

  return {
    mime: String(match[1] || '')
      .trim()
      .toLowerCase(),
    base64Payload: match[2] || '',
  };
}

async function ensureArtworkCacheDir() {
  if (!artworkCacheDirPromise) {
    artworkCacheDirPromise = (async () => {
      const dirPath = `${RNFS.CachesDirectoryPath}/${ARTWORK_CACHE_DIR_NAME}`;
      const exists = await RNFS.exists(dirPath).catch(() => false);
      if (!exists) {
        await RNFS.mkdir(dirPath);
      }
      return dirPath;
    })().catch(error => {
      artworkCacheDirPromise = null;
      throw error;
    });
  }

  return artworkCacheDirPromise;
}

async function writeDataUriToArtworkCache(sourceKey, dataUri) {
  const parsed = parseImageDataUri(dataUri);
  if (!parsed?.base64Payload) {
    return null;
  }

  try {
    const cacheDir = await ensureArtworkCacheDir();
    const extension = toCacheFileExtension(parsed.mime);
    const keyHash = hashText(sourceKey || dataUri.slice(0, 120));
    const filePath = `${cacheDir}/${keyHash}.${extension}`;
    const fileUri = `file://${filePath}`;

    const exists = await RNFS.exists(filePath).catch(() => false);
    if (exists) {
      return fileUri;
    }

    await RNFS.writeFile(filePath, parsed.base64Payload, 'base64');
    return fileUri;
  } catch (error) {
    return null;
  }
}

export {parseImageDataUri, writeDataUriToArtworkCache};
