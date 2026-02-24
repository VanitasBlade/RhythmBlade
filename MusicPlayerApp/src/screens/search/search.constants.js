export const DOWNLOAD_OPTIONS = [
  {label: 'Hi-Res', description: '24-bit FLAC (DASH) up to 192 kHz'},
  {label: 'CD Lossless', description: '16-bit / 44.1 kHz FLAC'},
  {label: '320kbps AAC', description: 'High quality AAC streaming'},
  {label: '96kbps AAC', description: 'Data saver AAC streaming'},
];

export const SEARCH_TYPES = ['Tracks', 'Albums'];
export const DOWNLOADER_TABS = ['Search', 'Queue'];
export const ACTIVE_QUEUE_STATUSES = new Set([
  'queued',
  'preparing',
  'downloading',
]);
