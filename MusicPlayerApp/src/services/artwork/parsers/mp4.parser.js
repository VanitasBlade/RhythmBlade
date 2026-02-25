import RNFS from 'react-native-fs';
import {Buffer} from 'buffer';
import {
  readUint32BE,
  readUint64BE,
  toAsciiString,
} from '../helpers/binary.helpers';
import {
  normalizeMimeType,
  sniffImageMimeType,
  toArtworkDataUri,
} from '../helpers/mime.helpers';

const DEFAULT_MP4_SCAN_WINDOWS = [
  384 * 1024, // 384 KB
  1024 * 1024, // 1 MB
  3 * 1024 * 1024, // 3 MB
  6 * 1024 * 1024, // 6 MB
];

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

function parseCovrDataAtom(bytes, atomStart, atomEnd, headerSize) {
  const dataSectionStart = atomStart + headerSize;
  if (dataSectionStart + 8 > atomEnd) {
    return null;
  }

  const typeField = readUint32BE(bytes, dataSectionStart);
  const dataType = typeField % 16777216;

  const payloadCandidates = [dataSectionStart + 8, dataSectionStart + 12];
  let payloadStart = payloadCandidates.find(offset =>
    Boolean(sniffImageMimeType(bytes, offset, atomEnd)),
  );

  if (payloadStart === undefined) {
    payloadStart = payloadCandidates[0];
  }

  if (payloadStart >= atomEnd) {
    return null;
  }

  const imageBytes = bytes.slice(payloadStart, atomEnd);
  if (!imageBytes.length) {
    return null;
  }

  let mime = '';
  if (dataType === 13) {
    mime = 'image/jpeg';
  } else if (dataType === 14) {
    mime = 'image/png';
  }

  if (!mime) {
    mime = sniffImageMimeType(imageBytes);
  }

  if (!mime) {
    return null;
  }

  return {
    mime: normalizeMimeType(mime),
    imageBytes,
  };
}

function parseCovrAtom(bytes, covrStart, covrEnd, covrHeaderSize) {
  let cursor = covrStart + covrHeaderSize;

  while (cursor + 8 <= covrEnd) {
    const atomMeta = readAtomSize(bytes, cursor, covrEnd);
    if (!atomMeta) {
      break;
    }

    const atomType = toAsciiString(bytes, cursor + 4, cursor + 8);
    const atomEnd = cursor + atomMeta.size;
    if (atomEnd > covrEnd || atomEnd <= cursor) {
      break;
    }

    if (atomType === 'data') {
      const parsedData = parseCovrDataAtom(
        bytes,
        cursor,
        atomEnd,
        atomMeta.headerSize,
      );
      if (parsedData) {
        return parsedData;
      }
    }

    cursor = atomEnd;
  }

  return null;
}

function parseMp4ArtworkFromBytes(bytes) {
  const limit = bytes.length;
  if (limit < 16) {
    return null;
  }

  for (let cursor = 4; cursor + 4 <= limit; cursor += 1) {
    if (
      bytes[cursor] !== 0x63 ||
      bytes[cursor + 1] !== 0x6f ||
      bytes[cursor + 2] !== 0x76 ||
      bytes[cursor + 3] !== 0x72
    ) {
      continue;
    }

    const covrStart = cursor - 4;
    const covrMeta = readAtomSize(bytes, covrStart, limit);
    if (!covrMeta) {
      continue;
    }

    const covrEnd = covrStart + covrMeta.size;
    if (covrEnd > limit || covrEnd <= covrStart) {
      continue;
    }

    const parsedCovr = parseCovrAtom(
      bytes,
      covrStart,
      covrEnd,
      covrMeta.headerSize,
    );
    if (parsedCovr) {
      return parsedCovr;
    }
  }

  return null;
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

async function extractMp4ArtworkDataUri(filePath, options = {}) {
  const stat = await RNFS.stat(filePath).catch(() => null);
  const fileSize = Number(stat?.size) || 0;
  if (!fileSize) {
    return null;
  }

  const scanWindows = Array.isArray(options.scanWindows)
    ? options.scanWindows
    : DEFAULT_MP4_SCAN_WINDOWS;
  const inspectedChunks = new Set();

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

      const parsed = parseMp4ArtworkFromBytes(chunkBytes);
      if (parsed?.imageBytes?.length) {
        return toArtworkDataUri(parsed.mime, parsed.imageBytes);
      }
    }
  }

  return null;
}

export {extractMp4ArtworkDataUri};
