import RNFS from 'react-native-fs';
import {Buffer} from 'buffer';
import {
  readUint24BE,
  readUint32BE,
  toAsciiString,
} from '../helpers/binary.helpers';
import {normalizeMimeType} from '../helpers/mime.helpers';

const FLAC_SIGNATURE = 'fLaC';
const FLAC_PICTURE_BLOCK_TYPE = 6;
const FRONT_COVER_PICTURE_TYPE = 3;
const DEFAULT_FLAC_SCAN_STEPS = [
  256 * 1024, // 256 KB
  1024 * 1024, // 1 MB
  4 * 1024 * 1024, // 4 MB
];

function parseFlacPictureBlock(bufferBytes, blockStart, blockLength) {
  const blockEnd = blockStart + blockLength;
  if (blockEnd > bufferBytes.length) {
    return null;
  }

  let cursor = blockStart;
  if (cursor + 32 > blockEnd) {
    return null;
  }

  const pictureType = readUint32BE(bufferBytes, cursor);
  cursor += 4;

  const mimeLength = readUint32BE(bufferBytes, cursor);
  cursor += 4;
  if (cursor + mimeLength > blockEnd) {
    return null;
  }
  const mime = Buffer.from(
    bufferBytes.slice(cursor, cursor + mimeLength),
  ).toString('utf8');
  cursor += mimeLength;

  const descriptionLength = readUint32BE(bufferBytes, cursor);
  cursor += 4 + descriptionLength;
  if (cursor + 16 > blockEnd) {
    return null;
  }

  // Skip width/height/depth/colors (4 uint32 values).
  cursor += 16;

  if (cursor + 4 > blockEnd) {
    return null;
  }
  const imageDataLength = readUint32BE(bufferBytes, cursor);
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

  const signature = toAsciiString(bufferBytes, 0, 4);
  if (signature !== FLAC_SIGNATURE) {
    return null;
  }

  let cursor = 4;
  let fallback = null;

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

async function readFlacPictureMetadata(filePath, scanSteps) {
  for (const scanBytes of scanSteps) {
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

async function extractFlacArtworkDataUri(filePath, options = {}) {
  const scanSteps = Array.isArray(options.scanSteps)
    ? options.scanSteps
    : DEFAULT_FLAC_SCAN_STEPS;

  const picture = await readFlacPictureMetadata(filePath, scanSteps);
  if (!picture || !picture.dataLength) {
    return null;
  }

  const imageBase64 = await RNFS.read(
    filePath,
    picture.dataLength,
    picture.dataOffset,
    'base64',
  ).catch(() => null);

  if (!imageBase64) {
    return null;
  }

  return `data:${normalizeMimeType(picture.mime)};base64,${imageBase64}`;
}

export {extractFlacArtworkDataUri};
