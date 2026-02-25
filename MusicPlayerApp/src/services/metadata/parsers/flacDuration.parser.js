/* eslint-disable no-bitwise */
import {
  readUint24BE,
  toAsciiString,
} from '../../artwork/helpers/binary.helpers';
import {
  clampDurationSeconds,
  readChunkAsBuffer,
} from '../helpers/readFile.helpers';

const FLAC_SIGNATURE = 'fLaC';
const STREAMINFO_BLOCK_TYPE = 0;
const STREAMINFO_BLOCK_SIZE = 34;
const DEFAULT_FLAC_DURATION_SCAN_BYTES = 128 * 1024;

function parseFlacStreamInfoDuration(bufferBytes) {
  if (!bufferBytes || bufferBytes.length < 8) {
    return 0;
  }

  const signature = toAsciiString(bufferBytes, 0, 4);
  if (signature !== FLAC_SIGNATURE) {
    return 0;
  }

  let cursor = 4;
  while (cursor + 4 <= bufferBytes.length) {
    const headerByte = bufferBytes[cursor] || 0;
    const isLastBlock = headerByte >= 128;
    const blockType = headerByte % 128;
    const blockLength = readUint24BE(bufferBytes, cursor + 1);
    const blockStart = cursor + 4;
    const blockEnd = blockStart + blockLength;

    if (blockEnd > bufferBytes.length) {
      break;
    }

    if (
      blockType === STREAMINFO_BLOCK_TYPE &&
      blockLength >= STREAMINFO_BLOCK_SIZE
    ) {
      const streamInfoStart = blockStart;
      const sampleDataStart = streamInfoStart + 10;
      if (sampleDataStart + 8 > blockEnd) {
        return 0;
      }

      const b0 = bufferBytes[sampleDataStart] || 0;
      const b1 = bufferBytes[sampleDataStart + 1] || 0;
      const b2 = bufferBytes[sampleDataStart + 2] || 0;
      const b3 = bufferBytes[sampleDataStart + 3] || 0;
      const b4 = bufferBytes[sampleDataStart + 4] || 0;
      const b5 = bufferBytes[sampleDataStart + 5] || 0;
      const b6 = bufferBytes[sampleDataStart + 6] || 0;
      const b7 = bufferBytes[sampleDataStart + 7] || 0;

      const sampleRate = (b0 << 12) | (b1 << 4) | ((b2 & 0xf0) >> 4);
      const totalSamples =
        (b3 & 0x0f) * 4294967296 + (b4 << 24) + (b5 << 16) + (b6 << 8) + b7;

      if (sampleRate <= 0 || totalSamples <= 0) {
        return 0;
      }

      return clampDurationSeconds(totalSamples / sampleRate);
    }

    cursor = blockEnd;
    if (isLastBlock) {
      break;
    }
  }

  return 0;
}

export async function extractFlacDurationSeconds(filePath, options = {}) {
  const scanBytes = Math.max(
    32 * 1024,
    Number(options.scanBytes) || DEFAULT_FLAC_DURATION_SCAN_BYTES,
  );
  const headerBytes = await readChunkAsBuffer(filePath, scanBytes, 0);
  if (!headerBytes) {
    return 0;
  }

  return parseFlacStreamInfoDuration(headerBytes);
}
