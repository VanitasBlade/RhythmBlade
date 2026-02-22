import RNFS from 'react-native-fs';
import {Buffer} from 'buffer';

const FLAC_SIGNATURE = 'fLaC';
const FLAC_PICTURE_BLOCK_TYPE = 6;
const FRONT_COVER_PICTURE_TYPE = 3;
const METADATA_SCAN_STEPS = [
  256 * 1024, // 256 KB
  1024 * 1024, // 1 MB
  4 * 1024 * 1024, // 4 MB
];
const NO_ARTWORK = Symbol('NO_ARTWORK');
const artworkCache = new Map();
const artworkInFlight = new Map();

function safeDecodeUriComponent(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }

  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function normalizePathToken(value) {
  const cleaned = String(value || '')
    .trim()
    .split('?')[0]
    .split('#')[0];
  return safeDecodeUriComponent(cleaned);
}

function normalizeFilePath(trackOrPath) {
  if (!trackOrPath) {
    return '';
  }

  if (typeof trackOrPath === 'string') {
    const normalizedValue = normalizePathToken(trackOrPath);
    if (normalizedValue.startsWith('file://')) {
      return normalizePathToken(normalizedValue.slice(7));
    }
    if (normalizedValue.startsWith('content://')) {
      return '';
    }
    return normalizedValue;
  }

  const localPath = normalizePathToken(trackOrPath.localPath || '');
  if (localPath) {
    if (localPath.startsWith('content://')) {
      return '';
    }
    return localPath.startsWith('file://')
      ? normalizePathToken(localPath.slice(7))
      : localPath;
  }

  const url = normalizePathToken(trackOrPath.url || '');
  if (url.startsWith('content://')) {
    return '';
  }
  if (url.startsWith('file://')) {
    return normalizePathToken(url.slice(7));
  }

  return '';
}

function isFlacPath(filePath) {
  return /\.flac$/i.test(String(filePath || ''));
}

function readUint32(bytes, offset) {
  return (
    (bytes[offset] || 0) * 16777216 +
    (bytes[offset + 1] || 0) * 65536 +
    (bytes[offset + 2] || 0) * 256 +
    (bytes[offset + 3] || 0)
  );
}

function parseFlacPictureBlock(bufferBytes, blockStart, blockLength) {
  const blockEnd = blockStart + blockLength;
  if (blockEnd > bufferBytes.length) {
    return null;
  }

  let cursor = blockStart;
  if (cursor + 32 > blockEnd) {
    return null;
  }

  const pictureType = readUint32(bufferBytes, cursor);
  cursor += 4;

  const mimeLength = readUint32(bufferBytes, cursor);
  cursor += 4;
  if (cursor + mimeLength > blockEnd) {
    return null;
  }
  const mime = Buffer.from(
    bufferBytes.slice(cursor, cursor + mimeLength),
  ).toString('utf8');
  cursor += mimeLength;

  const descriptionLength = readUint32(bufferBytes, cursor);
  cursor += 4 + descriptionLength;
  if (cursor + 16 > blockEnd) {
    return null;
  }

  // Skip width/height/depth/colors (4 uint32 values)
  cursor += 16;

  if (cursor + 4 > blockEnd) {
    return null;
  }
  const imageDataLength = readUint32(bufferBytes, cursor);
  cursor += 4;

  if (cursor + imageDataLength > blockEnd) {
    return null;
  }

  return {
    pictureType,
    mime: mime || 'image/jpeg',
    dataOffset: cursor,
    dataLength: imageDataLength,
  };
}

function parseFlacMetadataForPicture(bufferBytes) {
  if (bufferBytes.length < 8) {
    return null;
  }

  const signature = Buffer.from(bufferBytes.slice(0, 4)).toString('ascii');
  if (signature !== FLAC_SIGNATURE) {
    return null;
  }

  let cursor = 4;
  let fallback = null;

  while (cursor + 4 <= bufferBytes.length) {
    const headerByte = bufferBytes[cursor] || 0;
    const isLastBlock = headerByte >= 128;
    const blockType = headerByte % 128;
    const blockLength =
      (bufferBytes[cursor + 1] || 0) * 65536 +
      (bufferBytes[cursor + 2] || 0) * 256 +
      (bufferBytes[cursor + 3] || 0);

    const blockStart = cursor + 4;
    const blockEnd = blockStart + blockLength;
    if (blockEnd > bufferBytes.length) {
      break;
    }

    if (blockType === FLAC_PICTURE_BLOCK_TYPE) {
      const parsedPicture = parseFlacPictureBlock(
        bufferBytes,
        blockStart,
        blockLength,
      );
      if (parsedPicture) {
        if (parsedPicture.pictureType === FRONT_COVER_PICTURE_TYPE) {
          return parsedPicture;
        }
        if (!fallback) {
          fallback = parsedPicture;
        }
      }
    }

    cursor = blockEnd;
    if (isLastBlock) {
      break;
    }
  }

  return fallback;
}

function normalizeMimeType(mime) {
  const normalized = String(mime || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return 'image/jpeg';
  }
  if (normalized === 'image/jpg') {
    return 'image/jpeg';
  }
  return normalized;
}

async function readFlacPictureMetadata(filePath) {
  for (const scanBytes of METADATA_SCAN_STEPS) {
    const headerBase64 = await RNFS.read(
      filePath,
      scanBytes,
      0,
      'base64',
    ).catch(() => null);
    if (!headerBase64) {
      return null;
    }

    const headerBytes = Buffer.from(headerBase64, 'base64');
    const picture = parseFlacMetadataForPicture(headerBytes);
    if (picture?.dataLength) {
      return picture;
    }

    if (headerBytes.length < scanBytes) {
      break;
    }
  }

  return null;
}

export async function extractEmbeddedArtworkDataUri(trackOrPath) {
  const filePath = normalizeFilePath(trackOrPath);
  if (!filePath || !isFlacPath(filePath)) {
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

    const picture = await readFlacPictureMetadata(filePath);
    if (!picture || !picture.dataLength) {
      artworkCache.set(filePath, NO_ARTWORK);
      return null;
    }

    const imageBase64 = await RNFS.read(
      filePath,
      picture.dataLength,
      picture.dataOffset,
      'base64',
    ).catch(() => null);

    if (!imageBase64) {
      artworkCache.set(filePath, NO_ARTWORK);
      return null;
    }

    const dataUri = `data:${normalizeMimeType(
      picture.mime,
    )};base64,${imageBase64}`;
    artworkCache.set(filePath, dataUri);
    return dataUri;
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
