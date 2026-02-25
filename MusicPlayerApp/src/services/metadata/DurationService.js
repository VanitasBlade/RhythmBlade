import {
  getFileExtension,
  normalizeFilePath,
} from '../artwork/helpers/path.helpers';
import {extractAacDurationSeconds} from './parsers/aacDuration.parser';
import {extractFlacDurationSeconds} from './parsers/flacDuration.parser';
import {extractMp3DurationSeconds} from './parsers/mp3Duration.parser';
import {extractMp4DurationSeconds} from './parsers/mp4Duration.parser';

const NO_DURATION = Symbol('NO_DURATION');
const durationCache = new Map();
const durationInFlight = new Map();

const DURATION_EXTRACTORS_BY_EXTENSION = {
  mp3: extractMp3DurationSeconds,
  flac: extractFlacDurationSeconds,
  m4a: extractMp4DurationSeconds,
  mp4: extractMp4DurationSeconds,
  m4b: extractMp4DurationSeconds,
  aac: async filePath => {
    const adtsDuration = await extractAacDurationSeconds(filePath);
    if (adtsDuration > 0) {
      return adtsDuration;
    }
    return extractMp4DurationSeconds(filePath);
  },
};

function normalizeDuration(durationSeconds) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(duration));
}

function resolveExtractor(filePath) {
  const extension = getFileExtension(filePath);
  return DURATION_EXTRACTORS_BY_EXTENSION[extension] || null;
}

export function canExtractEmbeddedDuration(trackOrPath) {
  const filePath = normalizeFilePath(trackOrPath);
  return Boolean(filePath && resolveExtractor(filePath));
}

export async function extractEmbeddedDurationSeconds(trackOrPath) {
  const filePath = normalizeFilePath(trackOrPath);
  const extractor = resolveExtractor(filePath);
  if (!filePath || !extractor) {
    return 0;
  }

  if (durationCache.has(filePath)) {
    const cached = durationCache.get(filePath);
    return cached === NO_DURATION ? 0 : cached;
  }

  const inFlight = durationInFlight.get(filePath);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    const extracted = await extractor(filePath);
    const duration = normalizeDuration(extracted);
    if (!duration) {
      durationCache.set(filePath, NO_DURATION);
      return 0;
    }

    durationCache.set(filePath, duration);
    return duration;
  })()
    .catch(() => {
      durationCache.set(filePath, NO_DURATION);
      return 0;
    })
    .finally(() => {
      durationInFlight.delete(filePath);
    });

  durationInFlight.set(filePath, task);
  return task;
}
