import RNFS from 'react-native-fs';
import {Buffer} from 'buffer';
import jsmediatags from 'jsmediatags/build2/jsmediatags';

const LOG_PREFIX = '[ArtworkEmbedService]';
const ID3_HEADER_SIZE = 10;

function log(message, context = null) {
  if (context === null || typeof context === 'undefined') {
    console.log(`${LOG_PREFIX} ${message}`);
    return;
  }
  console.log(`${LOG_PREFIX} ${message}`, context);
}

function readSyncSafeInt(bytes, offset) {
  return (
    (bytes[offset] || 0) * 2097152 +
    (bytes[offset + 1] || 0) * 16384 +
    (bytes[offset + 2] || 0) * 128 +
    (bytes[offset + 3] || 0)
  );
}

function writeSyncSafeInt(value) {
  const safe = Math.max(0, Math.floor(Number(value) || 0));
  return Buffer.from([
    Math.floor(safe / 2097152) % 128,
    Math.floor(safe / 16384) % 128,
    Math.floor(safe / 128) % 128,
    safe % 128,
  ]);
}

function readUint24BE(bytes, offset) {
  return (
    (bytes[offset] || 0) * 65536 +
    (bytes[offset + 1] || 0) * 256 +
    (bytes[offset + 2] || 0)
  );
}

function readUint32BE(bytes, offset) {
  return (
    (bytes[offset] || 0) * 16777216 +
    (bytes[offset + 1] || 0) * 65536 +
    (bytes[offset + 2] || 0) * 256 +
    (bytes[offset + 3] || 0)
  );
}

function writeUint24BE(value) {
  const safe = Math.max(0, Math.floor(Number(value) || 0));
  return Buffer.from([
    Math.floor(safe / 65536) % 256,
    Math.floor(safe / 256) % 256,
    safe % 256,
  ]);
}

function writeUint32BE(value) {
  const safe = Math.max(
    0,
    Math.min(4294967295, Math.floor(Number(value) || 0)),
  );
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(safe, 0);
  return buffer;
}

function hasFlag(value, mask) {
  const byteValue = Number(value) || 0;
  const flagMask = Number(mask) || 0;
  if (flagMask <= 0) {
    return false;
  }
  return Math.floor(byteValue / flagMask) % 2 === 1;
}

function isFrameIdValid(frameId, version) {
  if (!frameId) {
    return false;
  }
  if (version === 2) {
    return /^[A-Z0-9]{3}$/.test(frameId);
  }
  return /^[A-Z0-9]{4}$/.test(frameId);
}

function parseExistingId3Tag(songBytes) {
  if (!songBytes || songBytes.length < ID3_HEADER_SIZE) {
    return null;
  }
  if (songBytes.toString('ascii', 0, 3) !== 'ID3') {
    return null;
  }

  const majorVersion = Number(songBytes[3]) || 0;
  const revision = Number(songBytes[4]) || 0;
  const flags = Number(songBytes[5]) || 0;
  if (![2, 3, 4].includes(majorVersion)) {
    return null;
  }

  const tagPayloadSize = readSyncSafeInt(songBytes, 6);
  const tagWithoutFooterSize = ID3_HEADER_SIZE + tagPayloadSize;
  const footerPresent = majorVersion === 4 && hasFlag(flags, 0x10);
  const footerSize = footerPresent ? ID3_HEADER_SIZE : 0;
  const totalTagSize = tagWithoutFooterSize + footerSize;
  if (!tagPayloadSize || totalTagSize > songBytes.length) {
    return null;
  }

  return {
    majorVersion,
    revision,
    flags,
    footerPresent,
    totalTagSize,
    tagWithoutFooterSize,
    tagBytes: songBytes.slice(0, tagWithoutFooterSize),
  };
}

function skipExtendedHeader(tagBytes, majorVersion, flags) {
  let cursor = ID3_HEADER_SIZE;
  if (!hasFlag(flags, 0x40)) {
    return cursor;
  }
  if (cursor + 4 > tagBytes.length) {
    return tagBytes.length;
  }

  const extSize =
    majorVersion === 4
      ? readSyncSafeInt(tagBytes, cursor)
      : readUint32BE(tagBytes, cursor);
  if (!extSize || extSize < 0) {
    return cursor;
  }

  const withLengthField = cursor + 4 + extSize;
  if (withLengthField <= tagBytes.length) {
    return withLengthField;
  }

  const direct = cursor + extSize;
  if (direct <= tagBytes.length) {
    return direct;
  }
  return tagBytes.length;
}

function parseFramesPreservingBytes(tagBytes, majorVersion, flags) {
  if (!tagBytes || tagBytes.length <= ID3_HEADER_SIZE) {
    return {
      prefixBytes: Buffer.alloc(0),
      frames: [],
    };
  }
  const frameHeaderSize = majorVersion === 2 ? 6 : 10;
  const frameStart = skipExtendedHeader(tagBytes, majorVersion, flags);
  const prefixBytes = tagBytes.slice(ID3_HEADER_SIZE, frameStart);
  const frames = [];
  let cursor = frameStart;

  while (cursor + frameHeaderSize <= tagBytes.length) {
    const header = tagBytes.slice(cursor, cursor + frameHeaderSize);
    if (header.every(byte => byte === 0)) {
      break;
    }

    const idLength = majorVersion === 2 ? 3 : 4;
    const frameId = tagBytes.toString('ascii', cursor, cursor + idLength);
    if (!isFrameIdValid(frameId, majorVersion)) {
      break;
    }

    let frameSize = 0;
    if (majorVersion === 2) {
      frameSize = readUint24BE(tagBytes, cursor + 3);
    } else if (majorVersion === 4) {
      frameSize = readSyncSafeInt(tagBytes, cursor + 4);
    } else {
      frameSize = readUint32BE(tagBytes, cursor + 4);
    }

    if (!frameSize || frameSize < 0) {
      break;
    }

    const frameEnd = cursor + frameHeaderSize + frameSize;
    if (frameEnd > tagBytes.length) {
      break;
    }

    frames.push({
      id: frameId,
      bytes: tagBytes.slice(cursor, frameEnd),
    });
    cursor = frameEnd;
  }

  return {
    prefixBytes,
    frames,
  };
}

function resolveImageMime(imageBytes, imagePath) {
  const path = String(imagePath || '').toLowerCase();
  if (path.endsWith('.png')) {
    return 'image/png';
  }
  if (path.endsWith('.gif')) {
    return 'image/gif';
  }
  if (path.endsWith('.webp')) {
    return 'image/webp';
  }
  if (
    imageBytes &&
    imageBytes.length > 8 &&
    imageBytes[0] === 0x89 &&
    imageBytes[1] === 0x50 &&
    imageBytes[2] === 0x4e &&
    imageBytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    imageBytes &&
    imageBytes.length > 3 &&
    imageBytes[0] === 0xff &&
    imageBytes[1] === 0xd8 &&
    imageBytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  return 'image/jpeg';
}

function resolvePicFormat(mime) {
  const normalized = String(mime || '').toLowerCase();
  if (normalized.includes('png')) {
    return 'PNG';
  }
  if (normalized.includes('gif')) {
    return 'GIF';
  }
  return 'JPG';
}

function buildArtworkFrame(imageBytes, imagePath, version = 3) {
  const mime = resolveImageMime(imageBytes, imagePath);
  if (version === 2) {
    const payload = Buffer.concat([
      Buffer.from([0x00]),
      Buffer.from(resolvePicFormat(mime), 'ascii'),
      Buffer.from([0x03]),
      Buffer.from([0x00]),
      imageBytes,
    ]);
    return Buffer.concat([
      Buffer.from('PIC', 'ascii'),
      writeUint24BE(payload.length),
      payload,
    ]);
  }

  const payload = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from(mime, 'ascii'),
    Buffer.from([0x00]),
    Buffer.from([0x03]),
    Buffer.from([0x00]),
    imageBytes,
  ]);
  const frameId = Buffer.from('APIC', 'ascii');
  const frameSize =
    version === 4
      ? writeSyncSafeInt(payload.length)
      : writeUint32BE(payload.length);
  return Buffer.concat([
    frameId,
    frameSize,
    Buffer.from([0x00, 0x00]),
    payload,
  ]);
}

async function readBinaryFile(filePath) {
  const base64 = await RNFS.readFile(filePath, 'base64');
  return Buffer.from(base64, 'base64');
}

async function writeBinaryFile(filePath, bytes) {
  await RNFS.writeFile(
    filePath,
    Buffer.from(bytes).toString('base64'),
    'base64',
  );
}

async function ensureInternalTempDir() {
  const candidates = [
    RNFS.TemporaryDirectoryPath,
    RNFS.CachesDirectoryPath,
    RNFS.DocumentDirectoryPath,
  ].filter(Boolean);

  for (const basePath of candidates) {
    const dirPath = `${String(basePath).replace(/\/+$/, '')}/RhythmBladeTmp`;
    try {
      const exists = await RNFS.exists(dirPath);
      if (!exists) {
        await RNFS.mkdir(dirPath);
      }
      return dirPath;
    } catch (error) {
      // Try next internal candidate.
    }
  }

  throw new Error('internal-temp-directory-unavailable');
}

async function atomicReplaceFile(targetPath, nextBytes) {
  const tempDir = await ensureInternalTempDir();
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const backupPath = `${tempDir}/apic_backup_${token}.mp3`;

  try {
    const hasTarget = await RNFS.exists(targetPath).catch(() => false);
    if (hasTarget) {
      await RNFS.copyFile(targetPath, backupPath);
    }
    await writeBinaryFile(targetPath, nextBytes);
  } catch (error) {
    const hasBackup = await RNFS.exists(backupPath).catch(() => false);
    if (hasBackup) {
      await RNFS.copyFile(backupPath, targetPath).catch(() => {});
    }
    throw error;
  } finally {
    await RNFS.unlink(backupPath).catch(() => {});
  }
}

function readTagsSnapshot(songPath) {
  return new Promise(resolve => {
    try {
      jsmediatags.read(songPath, {
        onSuccess: result => {
          const tags = result?.tags || {};
          resolve({
            ok: true,
            title: String(tags?.title || '').trim() || null,
            artist: String(tags?.artist || '').trim() || null,
            album: String(tags?.album || '').trim() || null,
          });
        },
        onError: error => {
          resolve({
            ok: false,
            reason: String(error?.info || error?.message || error || '').trim(),
          });
        },
      });
    } catch (error) {
      resolve({
        ok: false,
        reason: String(error?.message || error || '').trim(),
      });
    }
  });
}

export async function replaceMp3ApicPreserveFrames({songPath, imagePath} = {}) {
  const normalizedSongPath = String(songPath || '').trim();
  const normalizedImagePath = String(imagePath || '').trim();
  if (!normalizedSongPath.toLowerCase().endsWith('.mp3')) {
    return {updated: false, reason: 'non-mp3-skipped'};
  }
  if (!normalizedSongPath || !normalizedImagePath) {
    return {
      updated: false,
      reason: 'missing-paths',
      songPath: normalizedSongPath || null,
      imagePath: normalizedImagePath || null,
    };
  }

  try {
    const [songBytes, imageBytes, preReadTags] = await Promise.all([
      readBinaryFile(normalizedSongPath),
      readBinaryFile(normalizedImagePath),
      readTagsSnapshot(normalizedSongPath),
    ]);
    if (!imageBytes || !imageBytes.length) {
      return {
        updated: false,
        reason: 'image-empty',
        songPath: normalizedSongPath,
        imagePath: normalizedImagePath,
      };
    }

    const parsedTag = parseExistingId3Tag(songBytes);
    let majorVersion = 3;
    let revision = 0;
    let flags = 0;
    let prefixBytes = Buffer.alloc(0);
    let preservedFrames = [];
    let audioBytes = songBytes;

    if (parsedTag) {
      majorVersion = parsedTag.majorVersion;
      revision = parsedTag.revision;
      flags = parsedTag.flags;
      const frameSnapshot = parseFramesPreservingBytes(
        parsedTag.tagBytes,
        parsedTag.majorVersion,
        parsedTag.flags,
      );
      prefixBytes = frameSnapshot.prefixBytes;
      preservedFrames = frameSnapshot.frames.filter(
        frame => frame?.id !== 'APIC' && frame?.id !== 'PIC',
      );
      audioBytes = songBytes.slice(parsedTag.totalTagSize);
    }

    const artworkFrame = buildArtworkFrame(
      imageBytes,
      normalizedImagePath,
      majorVersion,
    );
    const framesBytes = Buffer.concat([
      ...preservedFrames.map(frame => frame.bytes),
      artworkFrame,
    ]);
    const tagPayloadBytes = Buffer.concat([prefixBytes, framesBytes]);

    const headerFlags =
      hasFlag(flags, 0x40) && prefixBytes.length > 0 ? 0x40 : 0x00;
    const header = Buffer.concat([
      Buffer.from('ID3', 'ascii'),
      Buffer.from([majorVersion, revision, headerFlags]),
      writeSyncSafeInt(tagPayloadBytes.length),
    ]);

    const finalBytes = Buffer.concat([header, tagPayloadBytes, audioBytes]);
    await atomicReplaceFile(normalizedSongPath, finalBytes);

    const postReadTags = await readTagsSnapshot(normalizedSongPath);
    log('APIC artwork replaced for MP3.', {
      songPath: normalizedSongPath,
      imagePath: normalizedImagePath,
      majorVersion,
      preservedFrameCount: preservedFrames.length,
      hadJsMediaTagsBefore: preReadTags?.ok === true,
      hasJsMediaTagsAfter: postReadTags?.ok === true,
    });

    return {
      updated: true,
      reason: 'apic-replaced',
      songPath: normalizedSongPath,
      imagePath: normalizedImagePath,
      majorVersion,
      preservedFrameCount: preservedFrames.length,
      tagReadBefore: preReadTags,
      tagReadAfter: postReadTags,
    };
  } catch (error) {
    log('Failed to replace APIC artwork for MP3.', {
      songPath: normalizedSongPath || null,
      imagePath: normalizedImagePath || null,
      error: error?.message || String(error),
    });
    return {
      updated: false,
      reason: error?.message || 'apic-replace-failed',
      songPath: normalizedSongPath || null,
      imagePath: normalizedImagePath || null,
    };
  }
}

export default {
  replaceMp3ApicPreserveFrames,
};
