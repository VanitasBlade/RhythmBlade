/* eslint-disable no-bitwise */
import {
  readSyncSafeInt,
  readUint32BE,
  toAsciiString,
} from '../../artwork/helpers/binary.helpers';
import {
  clampDurationSeconds,
  readChunkAsBuffer,
  readFileSize,
} from '../helpers/readFile.helpers';

const BITRATE_TABLES = {
  V1L1: [
    0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0,
  ],
  V1L2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
  V1L3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  V2L1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
  V2L2L3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};

const SAMPLE_RATES = {
  0: [11025, 12000, 8000], // MPEG 2.5
  2: [22050, 24000, 16000], // MPEG 2
  3: [44100, 48000, 32000], // MPEG 1
};

const MP3_SCAN_STEPS = [
  192 * 1024, // 192 KB
  1024 * 1024, // 1 MB
  4 * 1024 * 1024, // 4 MB
];

function resolveTagEndOffset(bytes) {
  if (!bytes || bytes.length < 10) {
    return 0;
  }

  if (toAsciiString(bytes, 0, 3) !== 'ID3') {
    return 0;
  }

  const majorVersion = bytes[3] || 0;
  const flags = bytes[5] || 0;
  const tagSize = readSyncSafeInt(bytes, 6);
  let fullTagSize = 10 + Math.max(0, tagSize);
  if (majorVersion === 4 && (flags & 0x10) !== 0) {
    fullTagSize += 10;
  }
  return fullTagSize;
}

function parseMp3Header(bytes, offset) {
  if (!bytes || offset + 4 > bytes.length) {
    return null;
  }

  const b0 = bytes[offset] || 0;
  const b1 = bytes[offset + 1] || 0;
  const b2 = bytes[offset + 2] || 0;
  const b3 = bytes[offset + 3] || 0;

  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) {
    return null;
  }

  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  const channelMode = (b3 >> 6) & 0x03;
  const hasCrc = (b1 & 0x01) === 0;

  if (
    versionBits === 1 ||
    layerBits === 0 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleRateIndex === 3
  ) {
    return null;
  }

  const layer = layerBits === 3 ? 1 : layerBits === 2 ? 2 : 3;
  const sampleRate = SAMPLE_RATES[versionBits]?.[sampleRateIndex] || 0;
  if (!sampleRate) {
    return null;
  }

  let bitrateKbps = 0;
  if (versionBits === 3) {
    if (layer === 1) {
      bitrateKbps = BITRATE_TABLES.V1L1[bitrateIndex] || 0;
    } else if (layer === 2) {
      bitrateKbps = BITRATE_TABLES.V1L2[bitrateIndex] || 0;
    } else {
      bitrateKbps = BITRATE_TABLES.V1L3[bitrateIndex] || 0;
    }
  } else if (layer === 1) {
    bitrateKbps = BITRATE_TABLES.V2L1[bitrateIndex] || 0;
  } else {
    bitrateKbps = BITRATE_TABLES.V2L2L3[bitrateIndex] || 0;
  }
  if (!bitrateKbps) {
    return null;
  }

  let frameLength = 0;
  if (layer === 1) {
    frameLength = Math.floor(
      ((12 * bitrateKbps * 1000) / sampleRate + padding) * 4,
    );
  } else if (layer === 2) {
    frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRate + padding);
  } else if (versionBits === 3) {
    frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRate + padding);
  } else {
    frameLength = Math.floor((72 * bitrateKbps * 1000) / sampleRate + padding);
  }
  if (!frameLength || frameLength < 24) {
    return null;
  }

  const samplesPerFrame =
    layer === 1 ? 384 : layer === 2 ? 1152 : versionBits === 3 ? 1152 : 576;

  return {
    versionBits,
    layer,
    bitrateKbps,
    sampleRate,
    frameLength,
    samplesPerFrame,
    channelMode,
    hasCrc,
  };
}

function findFirstFrame(bytes, startOffset) {
  for (
    let offset = Math.max(0, startOffset);
    offset + 4 <= bytes.length;
    offset += 1
  ) {
    const header = parseMp3Header(bytes, offset);
    if (!header) {
      continue;
    }

    const nextOffset = offset + header.frameLength;
    if (nextOffset + 4 <= bytes.length) {
      const nextHeader = parseMp3Header(bytes, nextOffset);
      if (!nextHeader) {
        continue;
      }
    }

    return {offset, ...header};
  }

  return null;
}

function tryParseXingDuration(bytes, frame) {
  if (!frame || frame.layer !== 3) {
    return 0;
  }

  const crcBytes = frame.hasCrc ? 2 : 0;
  const sideInfoBytes =
    frame.versionBits === 3
      ? frame.channelMode === 3
        ? 17
        : 32
      : frame.channelMode === 3
      ? 9
      : 17;

  const xingOffset = frame.offset + 4 + crcBytes + sideInfoBytes;
  if (xingOffset + 12 > bytes.length) {
    return 0;
  }

  const tag = toAsciiString(bytes, xingOffset, xingOffset + 4);
  if (tag !== 'Xing' && tag !== 'Info') {
    return 0;
  }

  const flags = readUint32BE(bytes, xingOffset + 4);
  const hasFrameCount = (flags & 0x1) === 0x1;
  if (!hasFrameCount || xingOffset + 12 > bytes.length) {
    return 0;
  }

  const frameCount = readUint32BE(bytes, xingOffset + 8);
  if (!frameCount) {
    return 0;
  }

  return clampDurationSeconds(
    (frameCount * frame.samplesPerFrame) / frame.sampleRate,
  );
}

function tryParseVbriDuration(bytes, frame) {
  if (!frame || frame.layer !== 3) {
    return 0;
  }

  const crcBytes = frame.hasCrc ? 2 : 0;
  const vbriOffset = frame.offset + 4 + crcBytes + 32;
  if (vbriOffset + 18 > bytes.length) {
    return 0;
  }

  const tag = toAsciiString(bytes, vbriOffset, vbriOffset + 4);
  if (tag !== 'VBRI') {
    return 0;
  }

  const frameCount = readUint32BE(bytes, vbriOffset + 14);
  if (!frameCount) {
    return 0;
  }

  return clampDurationSeconds(
    (frameCount * frame.samplesPerFrame) / frame.sampleRate,
  );
}

function parseDurationFromHeadBytes(bytes, fileSize) {
  if (!bytes || !bytes.length || !fileSize) {
    return 0;
  }

  const dataOffset = resolveTagEndOffset(bytes);
  const frame = findFirstFrame(bytes, dataOffset);
  if (!frame) {
    return 0;
  }

  const xingDuration = tryParseXingDuration(bytes, frame);
  if (xingDuration > 0) {
    return xingDuration;
  }

  const vbriDuration = tryParseVbriDuration(bytes, frame);
  if (vbriDuration > 0) {
    return vbriDuration;
  }

  const audioBytes = Math.max(0, fileSize - frame.offset);
  if (!audioBytes || !frame.bitrateKbps) {
    return 0;
  }

  return clampDurationSeconds((audioBytes * 8) / (frame.bitrateKbps * 1000));
}

export async function extractMp3DurationSeconds(filePath, options = {}) {
  const fileSize = await readFileSize(filePath);
  if (!fileSize) {
    return 0;
  }

  const scanSteps = Array.isArray(options.scanSteps)
    ? options.scanSteps
    : MP3_SCAN_STEPS;

  for (const requestedBytes of scanSteps) {
    const bytesToRead = Math.min(
      fileSize,
      Math.max(64 * 1024, Number(requestedBytes) || 0),
    );
    const headBytes = await readChunkAsBuffer(filePath, bytesToRead, 0);
    if (!headBytes) {
      continue;
    }

    const duration = parseDurationFromHeadBytes(headBytes, fileSize);
    if (duration > 0) {
      return duration;
    }

    if (bytesToRead >= fileSize) {
      break;
    }
  }

  return 0;
}
