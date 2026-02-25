import {Buffer} from 'buffer';

const DEFAULT_IMAGE_MIME = 'image/jpeg';

function normalizeMimeType(mime) {
  const normalized = String(mime || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return DEFAULT_IMAGE_MIME;
  }
  if (normalized === 'image/jpg') {
    return 'image/jpeg';
  }
  if (normalized === 'jpg') {
    return 'image/jpeg';
  }
  if (normalized === 'png') {
    return 'image/png';
  }
  return normalized.includes('/')
    ? normalized
    : `image/${normalized.replace(/^x-/, '')}`;
}

function sniffImageMimeType(bytes, start = 0, end = bytes.length) {
  const length = end - start;
  if (length < 4) {
    return '';
  }

  if (
    bytes[start] === 0xff &&
    bytes[start + 1] === 0xd8 &&
    bytes[start + 2] === 0xff
  ) {
    return 'image/jpeg';
  }

  if (
    bytes[start] === 0x89 &&
    bytes[start + 1] === 0x50 &&
    bytes[start + 2] === 0x4e &&
    bytes[start + 3] === 0x47
  ) {
    return 'image/png';
  }

  if (
    bytes[start] === 0x47 &&
    bytes[start + 1] === 0x49 &&
    bytes[start + 2] === 0x46 &&
    bytes[start + 3] === 0x38
  ) {
    return 'image/gif';
  }

  if (
    length >= 12 &&
    bytes[start] === 0x52 &&
    bytes[start + 1] === 0x49 &&
    bytes[start + 2] === 0x46 &&
    bytes[start + 3] === 0x46 &&
    bytes[start + 8] === 0x57 &&
    bytes[start + 9] === 0x45 &&
    bytes[start + 10] === 0x42 &&
    bytes[start + 11] === 0x50
  ) {
    return 'image/webp';
  }

  return '';
}

function toArtworkDataUri(mime, imageBytes) {
  const normalizedMime = normalizeMimeType(
    mime || sniffImageMimeType(imageBytes),
  );
  const base64Image = Buffer.from(imageBytes).toString('base64');
  return `data:${normalizedMime};base64,${base64Image}`;
}

export {normalizeMimeType, sniffImageMimeType, toArtworkDataUri};
