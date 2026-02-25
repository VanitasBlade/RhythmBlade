/* eslint-disable no-bitwise */
import {
  readSyncSafeInt,
  toAsciiString,
} from '../../artwork/helpers/binary.helpers';
import {
  clampDurationSeconds,
  readChunkAsBuffer,
  readFileSize,
} from '../helpers/readFile.helpers';

const AAC_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
  8000, 7350,
];
const DEFAULT_AAC_SCAN_BYTES = 96 * 1024;

function resolveAacDataStart(bytes) {
  if (!bytes || bytes.length < 10) {
    return 0;
  }

  if (toAsciiString(bytes, 0, 3) !== 'ID3') {
    return 0;
  }

  const tagSize = readSyncSafeInt(bytes, 6);
  return 10 + Math.max(0, tagSize);
}

function parseAdtsHeader(bytes, start) {
  if (!bytes || start < 0 || start + 7 > bytes.length) {
    return null;
  }

  const b0 = bytes[start] || 0;
  const b1 = bytes[start + 1] || 0;
  const b2 = bytes[start + 2] || 0;
  const b3 = bytes[start + 3] || 0;
  const b4 = bytes[start + 4] || 0;
  const b5 = bytes[start + 5] || 0;
  const b6 = bytes[start + 6] || 0;

  const hasSync = b0 === 0xff && (b1 & 0xf0) === 0xf0;
  if (!hasSync) {
    return null;
  }

  const samplingFrequencyIndex = (b2 >> 2) & 0x0f;
  const sampleRate = AAC_SAMPLE_RATES[samplingFrequencyIndex] || 0;
  if (!sampleRate) {
    return null;
  }

  const frameLength = ((b3 & 0x03) << 11) | (b4 << 3) | ((b5 & 0xe0) >> 5);
  if (frameLength <= 0) {
    return null;
  }

  const rawDataBlocks = b6 & 0x03;
  const samplesPerFrame = (rawDataBlocks + 1) * 1024;
  return {
    sampleRate,
    frameLength,
    samplesPerFrame,
  };
}

function findFirstAdtsHeader(bytes, startOffset) {
  for (
    let index = Math.max(0, startOffset);
    index + 7 <= bytes.length;
    index += 1
  ) {
    const header = parseAdtsHeader(bytes, index);
    if (!header) {
      continue;
    }

    return {
      offset: index,
      ...header,
    };
  }

  return null;
}

export async function extractAacDurationSeconds(filePath, options = {}) {
  const fileSize = await readFileSize(filePath);
  if (!fileSize) {
    return 0;
  }

  const scanBytes = Math.min(
    fileSize,
    Math.max(16 * 1024, Number(options.scanBytes) || DEFAULT_AAC_SCAN_BYTES),
  );
  const headBytes = await readChunkAsBuffer(filePath, scanBytes, 0);
  if (!headBytes) {
    return 0;
  }

  const headerStart = resolveAacDataStart(headBytes);
  const frame = findFirstAdtsHeader(headBytes, headerStart);
  if (!frame) {
    return 0;
  }

  const estimatedSeconds =
    (fileSize * frame.samplesPerFrame) / (frame.frameLength * frame.sampleRate);
  return clampDurationSeconds(estimatedSeconds);
}
