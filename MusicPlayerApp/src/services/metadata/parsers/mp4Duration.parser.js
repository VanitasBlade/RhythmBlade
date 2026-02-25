import {
  readUint32BE,
  readUint64BE,
  toAsciiString,
} from '../../artwork/helpers/binary.helpers';
import {
  clampDurationSeconds,
  readChunkAsBuffer,
  readFileSize,
} from '../helpers/readFile.helpers';

const DEFAULT_MP4_DURATION_SCAN_WINDOWS = [
  384 * 1024, // 384 KB
  1024 * 1024, // 1 MB
  3 * 1024 * 1024, // 3 MB
  6 * 1024 * 1024, // 6 MB
];
const MAX_FULL_MP4_SCAN_BYTES = 16 * 1024 * 1024;

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

function parseMvhdAtomDuration(bytes, atomStart, atomEnd, headerSize) {
  const payloadStart = atomStart + headerSize;
  if (payloadStart + 24 > atomEnd) {
    return 0;
  }

  const version = bytes[payloadStart] || 0;
  let timescale = 0;
  let durationUnits = 0;
  if (version === 1) {
    if (payloadStart + 32 > atomEnd) {
      return 0;
    }
    timescale = readUint32BE(bytes, payloadStart + 20);
    durationUnits = readUint64BE(bytes, payloadStart + 24);
  } else {
    timescale = readUint32BE(bytes, payloadStart + 12);
    durationUnits = readUint32BE(bytes, payloadStart + 16);
  }

  if (!timescale || !durationUnits) {
    return 0;
  }

  return clampDurationSeconds(durationUnits / timescale);
}

function parseDurationFromMp4Bytes(bytes) {
  const limit = bytes?.length || 0;
  if (limit < 24) {
    return 0;
  }

  for (let cursor = 4; cursor + 4 <= limit; cursor += 1) {
    if (
      bytes[cursor] !== 0x6d || // m
      bytes[cursor + 1] !== 0x76 || // v
      bytes[cursor + 2] !== 0x68 || // h
      bytes[cursor + 3] !== 0x64 // d
    ) {
      continue;
    }

    const atomStart = cursor - 4;
    const atomMeta = readAtomSize(bytes, atomStart, limit);
    if (!atomMeta) {
      continue;
    }

    const atomType = toAsciiString(bytes, atomStart + 4, atomStart + 8);
    if (atomType !== 'mvhd') {
      continue;
    }

    const atomEnd = atomStart + atomMeta.size;
    if (atomEnd > limit || atomEnd <= atomStart) {
      continue;
    }

    const duration = parseMvhdAtomDuration(
      bytes,
      atomStart,
      atomEnd,
      atomMeta.headerSize,
    );
    if (duration > 0) {
      return duration;
    }
  }

  return 0;
}

export async function extractMp4DurationSeconds(filePath, options = {}) {
  const fileSize = await readFileSize(filePath);
  if (!fileSize) {
    return 0;
  }

  const scanWindows = Array.isArray(options.scanWindows)
    ? options.scanWindows
    : DEFAULT_MP4_DURATION_SCAN_WINDOWS;
  const inspectedChunks = new Set();

  for (const requestedWindow of scanWindows) {
    const windowSize = Math.min(
      fileSize,
      Math.max(256 * 1024, Number(requestedWindow) || 0),
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

      const chunkBytes = await readChunkAsBuffer(filePath, length, offset);
      if (!chunkBytes) {
        continue;
      }

      const duration = parseDurationFromMp4Bytes(chunkBytes);
      if (duration > 0) {
        return duration;
      }
    }
  }

  if (fileSize <= MAX_FULL_MP4_SCAN_BYTES) {
    const fullBytes = await readChunkAsBuffer(filePath, fileSize, 0);
    if (fullBytes) {
      return parseDurationFromMp4Bytes(fullBytes);
    }
  }

  return 0;
}
