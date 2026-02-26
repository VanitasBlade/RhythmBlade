export const DOWNLOAD_OPTIONS = [
  {label: 'Hi-Res', description: '24-bit FLAC (DASH) up to 192 kHz'},
  {label: 'CD Lossless', description: '16-bit / 44.1 kHz FLAC'},
  {label: '320kbps AAC', description: 'High quality AAC streaming'},
  {label: '96kbps AAC', description: 'Data saver AAC streaming'},
];

export const DEFAULT_DOWNLOAD_SETTING = DOWNLOAD_OPTIONS[0].label;

const DOWNLOAD_SETTING_SHORT_LABELS = {
  'Hi-Res': 'FLAC',
  '320kbps AAC': '320K',
  '96kbps AAC': '96K',
  'CD Lossless': 'CD',
};

const DOWNLOAD_OPTION_LABELS = DOWNLOAD_OPTIONS.map(option => option.label);

export function normalizeDownloadSetting(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return DEFAULT_DOWNLOAD_SETTING;
  }

  const directMatch = DOWNLOAD_OPTION_LABELS.find(
    option => option.toLowerCase() === raw.toLowerCase(),
  );
  if (directMatch) {
    return directMatch;
  }

  const compact = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!compact) {
    return DEFAULT_DOWNLOAD_SETTING;
  }

  if (compact === 'flac' || compact.includes('hires')) {
    return 'Hi-Res';
  }

  if (
    compact === 'cd' ||
    compact.includes('cdlossless') ||
    (compact.includes('cd') && compact.includes('lossless'))
  ) {
    return 'CD Lossless';
  }

  if (
    compact === '320k' ||
    compact.includes('320kbpsaac') ||
    compact.includes('320aac') ||
    compact.includes('320')
  ) {
    return '320kbps AAC';
  }

  if (
    compact === '96k' ||
    compact.includes('96kbpsaac') ||
    compact.includes('96aac') ||
    compact.includes('96')
  ) {
    return '96kbps AAC';
  }

  return DEFAULT_DOWNLOAD_SETTING;
}

export function getDownloadSettingShortLabel(value) {
  const normalized = normalizeDownloadSetting(value);
  return DOWNLOAD_SETTING_SHORT_LABELS[normalized] || normalized;
}

export const SEARCH_TYPES = ['Tracks', 'Albums'];
export const DOWNLOADER_TABS = ['Search', 'Queue'];
export const ACTIVE_QUEUE_STATUSES = new Set([
  'queued',
  'preparing',
  'downloading',
]);
