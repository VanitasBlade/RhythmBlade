import {Buffer} from 'buffer';

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

function readSyncSafeInt(bytes, offset) {
  return (
    (bytes[offset] || 0) * 2097152 +
    (bytes[offset + 1] || 0) * 16384 +
    (bytes[offset + 2] || 0) * 128 +
    (bytes[offset + 3] || 0)
  );
}

function readUint64BE(bytes, offset) {
  const high = readUint32BE(bytes, offset);
  const low = readUint32BE(bytes, offset + 4);
  return high * 4294967296 + low;
}

function toAsciiString(bytes, start, end) {
  if (!bytes || start >= end) {
    return '';
  }
  return Buffer.from(bytes.slice(start, end)).toString('ascii');
}

function findByte(bytes, value, start = 0, end = bytes.length) {
  for (let index = start; index < end; index += 1) {
    if (bytes[index] === value) {
      return index;
    }
  }
  return -1;
}

function findDoubleZero(bytes, start = 0, end = bytes.length) {
  for (let index = start; index + 1 < end; index += 1) {
    if (bytes[index] === 0 && bytes[index + 1] === 0) {
      return index;
    }
  }
  return -1;
}

function isAllZero(bytes, start, length) {
  const end = Math.min(bytes.length, start + length);
  for (let index = start; index < end; index += 1) {
    if (bytes[index] !== 0) {
      return false;
    }
  }
  return true;
}

export {
  findByte,
  findDoubleZero,
  isAllZero,
  readSyncSafeInt,
  readUint24BE,
  readUint32BE,
  readUint64BE,
  toAsciiString,
};
