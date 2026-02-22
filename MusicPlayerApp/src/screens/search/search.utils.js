import {
  MUSIC_HOME_ART_COLORS,
  MUSIC_HOME_THEME as C,
} from '../../theme/musicHomeTheme';

const ART_FALLBACK_COLORS = Object.values(MUSIC_HOME_ART_COLORS);

export const getFallbackArtColor = item => {
  const key = `${item?.title || ''}|${item?.artist || item?.subtitle || ''}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 2147483647;
  }
  return (
    ART_FALLBACK_COLORS[Math.abs(hash) % ART_FALLBACK_COLORS.length] || C.bgCard
  );
};

export const normalizeText = value =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export const toTrackKey = item =>
  `${normalizeText(item?.title)}|${normalizeText(
    item?.artist || item?.subtitle || '',
  )}`;

export const formatDuration = value => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  const totalSeconds = Math.floor(Number(value));
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '';
  }
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

export const formatBytes = bytes => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
};

export const getQueueStatusLabel = job => {
  if (job.status === 'done') {
    return 'Done';
  }
  if (job.status === 'failed') {
    return 'Failed';
  }
  if (job.status === 'queued') {
    return 'Queued';
  }
  const pct = Number.isFinite(job.progress) ? Math.round(job.progress) : 0;
  return `${Math.max(0, Math.min(100, pct))}%`;
};

export const getQueueSubtitle = job => {
  if (job.status === 'failed') {
    return job.error || 'Download failed.';
  }

  const downloaded = formatBytes(job.downloadedBytes);
  const total = formatBytes(job.totalBytes);
  if (job.status === 'done') {
    return total || downloaded || 'Completed';
  }
  if (downloaded && total) {
    return `${downloaded} / ${total}`;
  }
  if (job.status === 'queued') {
    return 'Waiting in queue...';
  }
  if (job.phase === 'resolving') {
    return 'Resolving track...';
  }
  if (job.phase === 'saving') {
    return 'Finalizing file...';
  }
  return 'Downloading...';
};
