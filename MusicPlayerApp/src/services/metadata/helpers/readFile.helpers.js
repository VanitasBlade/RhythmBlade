import RNFS from 'react-native-fs';
import {Buffer} from 'buffer';

export function clampDurationSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }

  return Math.max(1, Math.round(seconds));
}

export async function readFileSize(filePath) {
  const stat = await RNFS.stat(filePath).catch(() => null);
  const size = Number(stat?.size) || 0;
  return size > 0 ? size : 0;
}

export async function readChunkAsBuffer(filePath, bytesToRead, position = 0) {
  const safeLength = Math.max(0, Number(bytesToRead) || 0);
  const safePosition = Math.max(0, Number(position) || 0);
  if (!safeLength) {
    return null;
  }

  const chunkBase64 = await RNFS.read(
    filePath,
    safeLength,
    safePosition,
    'base64',
  ).catch(() => null);
  if (!chunkBase64) {
    return null;
  }

  return Buffer.from(chunkBase64, 'base64');
}
