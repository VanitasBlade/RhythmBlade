import RNFS from 'react-native-fs';
import {Buffer} from 'buffer';
import {
  findByte,
  findDoubleZero,
  isAllZero,
  readSyncSafeInt,
  readUint24BE,
  readUint32BE,
  toAsciiString,
} from '../helpers/binary.helpers';
import {
  normalizeMimeType,
  sniffImageMimeType,
  toArtworkDataUri,
} from '../helpers/mime.helpers';

const ID3_HEADER_SIZE = 10;
const FRONT_COVER_PICTURE_TYPE = 3;
const DEFAULT_MP3_SCAN_STEPS = [
  96 * 1024, // 96 KB
  384 * 1024, // 384 KB
  1024 * 1024, // 1 MB
  4 * 1024 * 1024, // 4 MB
];
const MAX_DYNAMIC_ID3_READ_BYTES = 12 * 1024 * 1024; // 12 MB

function hasByteFlag(value, mask) {
  const byteValue = Number(value) || 0;
  const flagMask = Number(mask) || 0;
  if (flagMask <= 0) {
    return false;
  }
  return Math.floor(byteValue / flagMask) % 2 === 1;
}

function isValidFrameId(frameId, expectedLength) {
  if (!frameId || frameId.length !== expectedLength) {
    return false;
  }
  return /^[A-Z0-9]+$/.test(frameId);
}

function getImageStartAfterDescription(payload, start, encoding) {
  if (start >= payload.length) {
    return -1;
  }

  const isWideEncoding = encoding === 1 || encoding === 2;
  if (!isWideEncoding) {
    const terminator = findByte(payload, 0, start, payload.length);
    if (terminator === -1) {
      return start;
    }
    return terminator + 1;
  }

  const wideTerminator = findDoubleZero(payload, start, payload.length);
  if (wideTerminator === -1) {
    return start;
  }
  return wideTerminator + 2;
}

function mapPicFormatToMime(picFormat) {
  const normalized = String(picFormat || '')
    .trim()
    .toUpperCase();
  if (normalized === 'JPG' || normalized === 'JPEG') {
    return 'image/jpeg';
  }
  if (normalized === 'PNG') {
    return 'image/png';
  }
  if (normalized === 'GIF') {
    return 'image/gif';
  }
  return normalizeMimeType(normalized.toLowerCase());
}

function resolveImagePayloadStart(payload, initialStart) {
  if (initialStart < 0 || initialStart >= payload.length) {
    return -1;
  }

  if (sniffImageMimeType(payload, initialStart, payload.length)) {
    return initialStart;
  }

  for (let index = initialStart + 1; index + 3 < payload.length; index += 1) {
    if (sniffImageMimeType(payload, index, payload.length)) {
      return index;
    }
  }

  return initialStart;
}

function parseApicFramePayload(payload) {
  if (!payload || payload.length < 4) {
    return null;
  }

  const encoding = payload[0] || 0;
  let cursor = 1;

  const mimeEnd = findByte(payload, 0, cursor, payload.length);
  if (mimeEnd === -1 || mimeEnd <= cursor) {
    return null;
  }

  const rawMime = toAsciiString(payload, cursor, mimeEnd);
  if (rawMime === '-->') {
    return null;
  }
  const mime = normalizeMimeType(rawMime);
  cursor = mimeEnd + 1;
  if (cursor >= payload.length) {
    return null;
  }

  const pictureType = payload[cursor] || 0;
  cursor += 1;

  const rawImageStart = getImageStartAfterDescription(
    payload,
    cursor,
    encoding,
  );
  const imageDataStart = resolveImagePayloadStart(payload, rawImageStart);
  if (imageDataStart < 0 || imageDataStart >= payload.length) {
    return null;
  }

  const imageBytes = payload.slice(imageDataStart);
  if (!imageBytes.length) {
    return null;
  }

  return {
    mime,
    pictureType,
    imageBytes,
  };
}

function parsePicFramePayload(payload) {
  if (!payload || payload.length < 6) {
    return null;
  }

  const encoding = payload[0] || 0;
  const pictureFormat = toAsciiString(payload, 1, 4);
  const mime = mapPicFormatToMime(pictureFormat);
  const pictureType = payload[4] || 0;
  const rawImageStart = getImageStartAfterDescription(payload, 5, encoding);
  const imageDataStart = resolveImagePayloadStart(payload, rawImageStart);
  if (imageDataStart < 0 || imageDataStart >= payload.length) {
    return null;
  }

  const imageBytes = payload.slice(imageDataStart);
  if (!imageBytes.length) {
    return null;
  }

  return {
    mime,
    pictureType,
    imageBytes,
  };
}

function resolveTagEnd(bytes) {
  if (bytes.length < ID3_HEADER_SIZE) {
    return 0;
  }

  const signature = toAsciiString(bytes, 0, 3);
  if (signature !== 'ID3') {
    return 0;
  }

  const majorVersion = bytes[3] || 0;
  const flags = bytes[5] || 0;
  const tagSize = readSyncSafeInt(bytes, 6);
  let fullTagSize = ID3_HEADER_SIZE + tagSize;

  // ID3v2.4 footer occupies an additional 10 bytes after the tag payload.
  if (majorVersion === 4 && hasByteFlag(flags, 0x10)) {
    fullTagSize += ID3_HEADER_SIZE;
  }

  return fullTagSize;
}

function skipExtendedHeader(bytes, cursor, tagEnd, majorVersion, flags) {
  const hasExtendedHeader = hasByteFlag(flags, 0x40);
  if (!hasExtendedHeader) {
    return cursor;
  }

  if (cursor + 4 > tagEnd) {
    return tagEnd;
  }

  const rawSize =
    majorVersion === 4
      ? readSyncSafeInt(bytes, cursor)
      : readUint32BE(bytes, cursor);
  if (!rawSize) {
    return cursor;
  }

  const includeSizeField = cursor + 4 + rawSize;
  if (includeSizeField <= tagEnd) {
    return includeSizeField;
  }

  const direct = cursor + rawSize;
  if (direct <= tagEnd) {
    return direct;
  }

  return tagEnd;
}

function parseId3ArtworkFromBytes(bytes) {
  if (bytes.length < ID3_HEADER_SIZE) {
    return null;
  }

  const signature = toAsciiString(bytes, 0, 3);
  if (signature !== 'ID3') {
    return null;
  }

  const majorVersion = bytes[3] || 0;
  if (![2, 3, 4].includes(majorVersion)) {
    return null;
  }
  const flags = bytes[5] || 0;
  const requiredTagBytes = resolveTagEnd(bytes);
  if (!requiredTagBytes || bytes.length < requiredTagBytes) {
    return null;
  }

  const tagEnd = Math.min(requiredTagBytes, bytes.length);
  let cursor = ID3_HEADER_SIZE;
  cursor = skipExtendedHeader(bytes, cursor, tagEnd, majorVersion, flags);

  const usesShortHeaders = majorVersion === 2;
  const frameHeaderSize = usesShortHeaders ? 6 : 10;
  let fallbackArtwork = null;

  while (cursor + frameHeaderSize <= tagEnd) {
    if (isAllZero(bytes, cursor, frameHeaderSize)) {
      break;
    }

    let frameId = '';
    let frameSize = 0;
    let dataStart = 0;

    if (usesShortHeaders) {
      frameId = toAsciiString(bytes, cursor, cursor + 3);
      frameSize = readUint24BE(bytes, cursor + 3);
      dataStart = cursor + 6;
      if (!isValidFrameId(frameId, 3)) {
        break;
      }
    } else {
      frameId = toAsciiString(bytes, cursor, cursor + 4);
      frameSize =
        majorVersion === 4
          ? readSyncSafeInt(bytes, cursor + 4)
          : readUint32BE(bytes, cursor + 4);
      dataStart = cursor + 10;
      if (!isValidFrameId(frameId, 4)) {
        break;
      }
    }

    if (frameSize <= 0) {
      break;
    }

    const frameEnd = dataStart + frameSize;
    if (frameEnd > tagEnd) {
      break;
    }

    let parsedPicture = null;
    if (!usesShortHeaders && frameId === 'APIC') {
      parsedPicture = parseApicFramePayload(bytes.slice(dataStart, frameEnd));
    } else if (usesShortHeaders && frameId === 'PIC') {
      parsedPicture = parsePicFramePayload(bytes.slice(dataStart, frameEnd));
    }

    if (parsedPicture?.imageBytes?.length) {
      if (parsedPicture.pictureType === FRONT_COVER_PICTURE_TYPE) {
        return parsedPicture;
      }
      if (!fallbackArtwork) {
        fallbackArtwork = parsedPicture;
      }
    }

    cursor = frameEnd;
  }

  return fallbackArtwork;
}

async function readHeadBytes(filePath, bytesToRead) {
  const chunkBase64 = await RNFS.read(filePath, bytesToRead, 0, 'base64').catch(
    () => null,
  );
  if (!chunkBase64) {
    return null;
  }
  return Buffer.from(chunkBase64, 'base64');
}

async function extractMp3ArtworkDataUri(filePath, options = {}) {
  const scanSteps = Array.isArray(options.scanSteps)
    ? options.scanSteps
    : DEFAULT_MP3_SCAN_STEPS;
  const uniqueScanSteps = Array.from(
    new Set(scanSteps.filter(step => Number(step) > 0)),
  );

  for (const scanBytes of uniqueScanSteps) {
    const headBytes = await readHeadBytes(filePath, scanBytes);
    if (!headBytes) {
      return null;
    }

    const signature = toAsciiString(headBytes, 0, 3);
    if (signature !== 'ID3') {
      return null;
    }

    const requiredTagBytes = resolveTagEnd(headBytes);
    if (requiredTagBytes && headBytes.length < requiredTagBytes) {
      if (requiredTagBytes <= MAX_DYNAMIC_ID3_READ_BYTES) {
        const expandedBytes = await readHeadBytes(filePath, requiredTagBytes);
        if (expandedBytes && expandedBytes.length >= requiredTagBytes) {
          const expandedPicture = parseId3ArtworkFromBytes(expandedBytes);
          if (expandedPicture?.imageBytes?.length) {
            const mime =
              normalizeMimeType(expandedPicture.mime) ||
              sniffImageMimeType(expandedPicture.imageBytes);
            return toArtworkDataUri(mime, expandedPicture.imageBytes);
          }
          return null;
        }
      }

      if (headBytes.length < scanBytes) {
        break;
      }
      continue;
    }

    const parsedPicture = parseId3ArtworkFromBytes(headBytes);
    if (parsedPicture?.imageBytes?.length) {
      const mime =
        normalizeMimeType(parsedPicture.mime) ||
        sniffImageMimeType(parsedPicture.imageBytes);
      return toArtworkDataUri(mime, parsedPicture.imageBytes);
    }

    if (headBytes.length < scanBytes) {
      break;
    }
  }

  return null;
}

export {extractMp3ArtworkDataUri};
