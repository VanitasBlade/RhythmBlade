export const STORAGE_KEYS = {
  LIBRARY: '@music_library',
  PLAYLISTS: '@playlists',
  SETTINGS: '@settings',
  PROFILE_AVATAR: '@profile_avatar',
  LAST_LIBRARY_SYNC_AT: '@library_last_synced_at',
  MEDIASTORE_SYNC_META: '@mediastore_sync_meta',
  HIDDEN_MEDIASTORE_IDS: '@hidden_mediastore_ids',
  LISTENING_STATS: '@listening_stats',
};

export const DEFAULT_AUDIO_EXTENSION = '.flac';

export const FAVORITES_PLAYLIST_ID = 'favorites';
export const FAVORITES_PLAYLIST_NAME = 'favorites';
export const FAVORITES_PLAYLIST_DESCRIPTION = 'Your favorite tracks';

export const LEGACY_PLACEHOLDER_FILE_SOURCE_PATHS = [
  '/music/downloads',
  '/music/itunes',
  '/sd card/music',
  '/music/soundcloud',
];

export const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  'mp3',
  'flac',
  'aac',
  'm4a',
  'wav',
  'ogg',
  'opus',
  'aiff',
  'wma',
]);
