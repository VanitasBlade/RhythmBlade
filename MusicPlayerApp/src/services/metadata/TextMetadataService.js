import RNFS from 'react-native-fs';
import {Buffer} from 'buffer';
import {getFileExtension, normalizeFilePath} from '../artwork/helpers/path.helpers';
import {
  readUint24BE,
  readUint32BE,
  readUint64BE,
  toAsciiString,
} from '../artwork/helpers/binary.helpers';

const DEFAULT_MP4_SCAN_WINDOWS = [
  384 * 1024,
  1024 * 1024,
  3 * 1024 * 1024,
  6 * 1024 * 1024,
];
const DEFAULT_FLAC_SCAN_WINDOWS = [
  256 * 1024,
  1024 * 1024,
  4 * 1024 * 1024,
];
const FLAC_SIGNATURE = 'fLaC';
const FLAC_VORBIS_COMMENT_BLOCK_TYPE = 4;

const MP4_FIELD_CODES = {
  title: [0xa9, 0x6e, 0x61, 0x6d], // cnam
  artist: [0xa9, 0x41, 0x52, 0x54], // cART
  album: [0xa9, 0x61, 0x6c, 0x62], // calb
  albumArtist: [0x61, 0x41, 0x52, 0x54], // aART
};

const MP4_TEXT_TAG_EXTENSIONS = new Set(['m4a', 'mp4', 'm4b', 'aac']);
const FLAC_TEXT_TAG_EXTENSIONS = new Set(['flac']);
const TEXT_METADATA_EXTENSIONS = new Set([
  ...MP4_TEXT_TAG_EXTENSIONS,
  ...FLAC_TEXT_TAG_EXTENSIONS,
]);

function normalizeTextValue(value) {
  return String(value || '')
    .split('\u0000')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function readAtomSize(bytes, start, limit) {
  if (start + 8 > limit) {
    return null;
  }

  const size32 = readUint32BE(bytes, start);
  if (size32 === 1) {
    if (start + 16 > limit) {
      return null;
    }
    const extendedSize = readUint64BE(bytes, start + 8);
    if (!Number.isFinite(extendedSize) || extendedSize < 16) {
      return null;
    }
    return {size: extendedSize, headerSize: 16};
  }

  if (size32 === 0) {
    return {size: limit - start, headerSize: 8};
  }

  if (size32 < 8) {
    return null;
  }

  return {size: size32, headerSize: 8};
}

function bytesMatch(bytes, offset, sequence) {
  if (offset < 0 || offset + sequence.length > bytes.length) {
    return false;
  }

  for (let index = 0; index < sequence.length; index += 1) {
    if ((bytes[offset + index] || 0) !== sequence[index]) {
      return false;
    }
  }

  return true;
}

function decodeUtf16BigEndian(bufferBytes) {
  const source = Buffer.from(bufferBytes || []);
  const byteLength = source.length - (source.length % 2);
  if (!byteLength) {
    return '';
  }

  const swapped = Buffer.allocUnsafe(byteLength);
  for (let index = 0; index < byteLength; index += 2) {
    swapped[index] = source[index + 1];
    swapped[index + 1] = source[index];
  }
  return swapped.toString('utf16le');
}

function decodePayloadText(payload) {
  if (!payload?.length) {
    return '';
  }

  const source = Buffer.from(payload);
  if (!source.length) {
    return '';
  }

  let decoded = '';
  if (source.length >= 2 && source[0] === 0xfe && source[1] === 0xff) {
    decoded = decodeUtf16BigEndian(source.slice(2));
  } else if (source.length >= 2 && source[0] === 0xff && source[1] === 0xfe) {
    decoded = source.slice(2).toString('utf16le');
  } else {
    decoded = source.toString('utf8');
  }

  return normalizeTextValue(decoded);
}

function parseTextDataAtom(bytes, atomStart, atomEnd, headerSize) {
  const dataSectionStart = atomStart + headerSize;
  if (dataSectionStart + 8 > atomEnd) {
    return '';
  }

  const payloadCandidates = [dataSectionStart + 8, dataSectionStart + 12];
  for (const payloadStart of payloadCandidates) {
    if (payloadStart >= atomEnd) {
      continue;
    }
    const text = decodePayloadText(bytes.slice(payloadStart, atomEnd));
    if (text) {
      return text;
    }
  }

  return '';
}

function parseTextFieldAtom(bytes, fieldStart, fieldEnd, fieldHeaderSize) {
  let cursor = fieldStart + fieldHeaderSize;

  while (cursor + 8 <= fieldEnd) {
    const atomMeta = readAtomSize(bytes, cursor, fieldEnd);
    if (!atomMeta) {
      break;
    }

    const atomEnd = cursor + atomMeta.size;
    if (atomEnd > fieldEnd || atomEnd <= cursor) {
      break;
    }

    const isDataAtom =
      bytes[cursor + 4] === 0x64 &&
      bytes[cursor + 5] === 0x61 &&
      bytes[cursor + 6] === 0x74 &&
      bytes[cursor + 7] === 0x61;

    if (isDataAtom) {
      const text = parseTextDataAtom(
        bytes,
        cursor,
        atomEnd,
        atomMeta.headerSize,
      );
      if (text) {
        return text;
      }
    }

    cursor = atomEnd;
  }

  return '';
}

function parseMp4TextMetadataFromBytes(bytes) {
  const limit = bytes.length;
  if (limit < 16) {
    return null;
  }

  const extracted = {
    title: '',
    artist: '',
    album: '',
    albumArtist: '',
  };

  for (let cursor = 4; cursor + 4 <= limit; cursor += 1) {
    for (const [field, sequence] of Object.entries(MP4_FIELD_CODES)) {
      if (!bytesMatch(bytes, cursor, sequence)) {
        continue;
      }
      if (extracted[field]) {
        continue;
      }

      const fieldStart = cursor - 4;
      const fieldMeta = readAtomSize(bytes, fieldStart, limit);
      if (!fieldMeta) {
        continue;
      }

      const fieldEnd = fieldStart + fieldMeta.size;
      if (fieldEnd > limit || fieldEnd <= fieldStart) {
        continue;
      }

      const parsed = parseTextFieldAtom(
        bytes,
        fieldStart,
        fieldEnd,
        fieldMeta.headerSize,
      );
      if (parsed) {
        extracted[field] = parsed;
      }
    }
  }

  const title = normalizeTextValue(extracted.title);
  const artist = normalizeTextValue(extracted.artist || extracted.albumArtist);
  const album = normalizeTextValue(extracted.album);
  if (!title && !artist && !album) {
    return null;
  }

  return {
    title: title || '',
    artist: artist || '',
    album: album || '',
  };
}

function readUint32LE(bytes, offset) {
  return (
    (bytes[offset] || 0) +
    (bytes[offset + 1] || 0) * 256 +
    (bytes[offset + 2] || 0) * 65536 +
    (bytes[offset + 3] || 0) * 16777216
  );
}

function parseVorbisCommentBlock(bytes, blockStart, blockLength) {
  const blockEnd = blockStart + blockLength;
  if (blockEnd > bytes.length || blockLength < 8) {
    return null;
  }

  let cursor = blockStart;
  const vendorLength = readUint32LE(bytes, cursor);
  cursor += 4 + vendorLength;
  if (cursor + 4 > blockEnd) {
    return null;
  }

  const userCommentCount = readUint32LE(bytes, cursor);
  cursor += 4;

  const extracted = {
    title: '',
    artist: '',
    album: '',
  };

  for (let index = 0; index < userCommentCount; index += 1) {
    if (cursor + 4 > blockEnd) {
      break;
    }
    const fieldLength = readUint32LE(bytes, cursor);
    cursor += 4;

    if (fieldLength <= 0 || cursor + fieldLength > blockEnd) {
      break;
    }

    const rawField = Buffer.from(bytes.slice(cursor, cursor + fieldLength))
      .toString('utf8')
      .trim();
    cursor += fieldLength;

    if (!rawField) {
      continue;
    }

    const separatorIndex = rawField.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = rawField.slice(0, separatorIndex).trim().toLowerCase();
    const value = normalizeTextValue(rawField.slice(separatorIndex + 1));
    if (!value) {
      continue;
    }

    if ((key === 'title' || key === 'tracktitle') && !extracted.title) {
      extracted.title = value;
      continue;
    }
    if (
      (key === 'artist' || key === 'albumartist' || key === 'performer') &&
      !extracted.artist
    ) {
      extracted.artist = value;
      continue;
    }
    if (key === 'album' && !extracted.album) {
      extracted.album = value;
    }
  }

  if (!extracted.title && !extracted.artist && !extracted.album) {
    return null;
  }

  return extracted;
}

function parseFlacTextMetadataFromBytes(bytes) {
  if (!bytes || bytes.length < 8) {
    return null;
  }

  const signature = toAsciiString(bytes, 0, 4);
  if (signature !== FLAC_SIGNATURE) {
    return null;
  }

  let cursor = 4;
  let best = null;

  while (cursor + 4 <= bytes.length) {
    const headerByte = bytes[cursor] || 0;
    const isLastBlock = headerByte >= 128;
    const blockType = headerByte % 128;
    const blockLength = readUint24BE(bytes, cursor + 1);
    const blockStart = cursor + 4;
    const blockEnd = blockStart + blockLength;
    if (blockEnd > bytes.length) {
      break;
    }

    if (blockType === FLAC_VORBIS_COMMENT_BLOCK_TYPE) {
      const parsed = parseVorbisCommentBlock(bytes, blockStart, blockLength);
      if (parsed) {
        best = mergeMetadata(best, parsed);
        if (best.title && best.artist && best.album) {
          return best;
        }
      }
    }

    cursor = blockEnd;
    if (isLastBlock) {
      break;
    }
  }

  return best;
}

async function readChunk(filePath, bytesToRead, position) {
  const chunkBase64 = await RNFS.read(
    filePath,
    bytesToRead,
    position,
    'base64',
  ).catch(() => null);
  if (!chunkBase64) {
    return null;
  }
  return Buffer.from(chunkBase64, 'base64');
}

function mergeMetadata(base = {}, incoming = {}) {
  return {
    title: incoming.title || base.title || '',
    artist: incoming.artist || base.artist || '',
    album: incoming.album || base.album || '',
  };
}

async function extractMp4TextMetadata(filePath, options = {}) {
  const stat = await RNFS.stat(filePath).catch(() => null);
  const fileSize = Number(stat?.size) || 0;
  if (!fileSize) {
    return null;
  }

  const scanWindows = Array.isArray(options.scanWindows)
    ? options.scanWindows
    : DEFAULT_MP4_SCAN_WINDOWS;
  const inspectedChunks = new Set();
  let best = null;

  for (const requestedWindow of scanWindows) {
    const windowSize = Math.min(
      fileSize,
      Math.max(256 * 1024, requestedWindow),
    );
    const headOffset = 0;
    const tailOffset = Math.max(0, fileSize - windowSize);
    const chunkPlans = [
      [headOffset, windowSize],
      [tailOffset, windowSize],
    ];

    for (const [offset, length] of chunkPlans) {
      const key = `${offset}:${length}`;
      if (inspectedChunks.has(key)) {
        continue;
      }
      inspectedChunks.add(key);

      const chunkBytes = await readChunk(filePath, length, offset);
      if (!chunkBytes) {
        continue;
      }

      const parsed = parseMp4TextMetadataFromBytes(chunkBytes);
      if (!parsed) {
        continue;
      }

      best = mergeMetadata(best, parsed);
      if (best.title && best.artist && best.album) {
        return best;
      }
    }
  }

  return best;
}

async function extractFlacTextMetadata(filePath, options = {}) {
  const stat = await RNFS.stat(filePath).catch(() => null);
  const fileSize = Number(stat?.size) || 0;
  if (!fileSize) {
    return null;
  }

  const scanWindows = Array.isArray(options.scanWindows)
    ? options.scanWindows
    : DEFAULT_FLAC_SCAN_WINDOWS;

  for (const requestedWindow of scanWindows) {
    const windowSize = Math.min(
      fileSize,
      Math.max(64 * 1024, Number(requestedWindow) || 0),
    );
    if (!windowSize) {
      continue;
    }

    const chunkBytes = await readChunk(filePath, windowSize, 0);
    if (!chunkBytes) {
      return null;
    }

    const parsed = parseFlacTextMetadataFromBytes(chunkBytes);
    if (parsed) {
      return parsed;
    }

    if (chunkBytes.length < windowSize) {
      break;
    }
  }

  return null;
}

export function canExtractEmbeddedTextMetadata(trackOrPath) {
  const filePath = normalizeFilePath(trackOrPath);
  const extension = getFileExtension(filePath);
  return Boolean(filePath) && TEXT_METADATA_EXTENSIONS.has(extension);
}

export async function extractEmbeddedTextMetadata(trackOrPath, options = {}) {
  const filePath = normalizeFilePath(trackOrPath);
  if (!filePath) {
    return null;
  }

  const extension = getFileExtension(filePath);
  if (!TEXT_METADATA_EXTENSIONS.has(extension)) {
    return null;
  }

  const extractor = FLAC_TEXT_TAG_EXTENSIONS.has(extension)
    ? extractFlacTextMetadata
    : extractMp4TextMetadata;

  try {
    return await extractor(filePath, options);
  } catch (error) {
    return null;
  }
}

