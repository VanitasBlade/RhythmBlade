import {
  DEFAULT_AUDIO_EXTENSION,
  SUPPORTED_AUDIO_EXTENSIONS,
} from './storage.constants';

export function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizePlaylistName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeFileSourcePath(value) {
  const compact = String(value || '')
    .replace(/\\/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) {
    return '';
  }
  if (compact.startsWith('/')) {
    return compact;
  }
  if (/^[a-z]:\//i.test(compact)) {
    return `/${compact}`;
  }
  return `/${compact.replace(/^\/+/, '')}`;
}

export function normalizeFileSourceFormats(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
  const normalized = list
    .map(format =>
      String(format || '')
        .replace(/^\./, '')
        .toUpperCase(),
    )
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

export function normalizeFileSource(source = {}, fallbackIndex = 0) {
  const normalizedPath = normalizeFileSourcePath(source.path);
  const path = normalizedPath || `/Imported/Source_${fallbackIndex + 1}`;
  const formats = normalizeFileSourceFormats(source.fmt || source.formats);
  return {
    id:
      String(source.id || '').trim() ||
      `source_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    path,
    count: Math.max(0, Number(source.count) || 0),
    on: source.on !== false,
    fmt: formats.length > 0 ? formats : ['MP3'],
  };
}

export function cloneDefaultFileSources(defaultPath = '') {
  const normalizedPath =
    normalizeFileSourcePath(defaultPath) ||
    '/storage/emulated/0/Music/RhythmBlade';
  return [
    {
      id: 'source_default_music',
      path: normalizedPath,
      count: 0,
      on: true,
      fmt: ['MP3', 'FLAC'],
    },
  ];
}

export function sanitizeFileSegment(value) {
  const withoutIllegalChars = String(value || '').replace(/[<>:"/\\|?*]/g, '');
  const withoutControlChars = Array.from(withoutIllegalChars)
    .filter(char => char.charCodeAt(0) >= 32)
    .join('');

  return withoutControlChars
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .replace(/[^a-z0-9._ -]/gi, '_')
    .slice(0, 120);
}

export function getExtensionFromSong(song) {
  const fromFilename = String(song?.filename || '').match(/\.[a-z0-9]{2,5}$/i);
  if (fromFilename) {
    return fromFilename[0];
  }

  const cleanUrl = String(song?.url || '').split('?')[0];
  const fromUrl = cleanUrl.match(/\.[a-z0-9]{2,5}$/i);
  if (fromUrl) {
    return fromUrl[0];
  }

  return DEFAULT_AUDIO_EXTENSION;
}

export function isUnknownValue(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return (
    !normalized || normalized === 'unknown' || normalized === 'unknown artist'
  );
}

export function parseMetadataFromFilename(filename) {
  const base = String(filename || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .trim();
  if (!base) {
    return {artist: '', title: ''};
  }

  const parts = base
    .split(' - ')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return {
      artist: parts[0],
      title: parts.slice(1).join(' - '),
    };
  }

  return {artist: '', title: base};
}

export function getFileExtensionFromPath(pathValue) {
  const match = String(pathValue || '')
    .trim()
    .match(/\.([a-z0-9]{2,5})$/i);
  return match?.[1]?.toLowerCase() || '';
}

export function isSupportedAudioFilename(pathValue) {
  const ext = getFileExtensionFromPath(pathValue);
  return SUPPORTED_AUDIO_EXTENSIONS.has(ext);
}

export function safeDecodeUriComponent(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }

  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

export function stripUriQueryAndHash(value) {
  return String(value || '')
    .split('?')[0]
    .split('#')[0];
}

export function toPathFromUri(value) {
  const rawValue = stripUriQueryAndHash(String(value || '').trim());
  if (!rawValue) {
    return '';
  }

  const withoutFilePrefix = rawValue.replace(/^file:\/\//, '');
  return safeDecodeUriComponent(withoutFilePrefix);
}

export function getFileNameFromUriOrPath(value) {
  const cleaned = stripUriQueryAndHash(value);
  if (!cleaned) {
    return '';
  }

  return safeDecodeUriComponent(cleaned).split('/').filter(Boolean).pop() || '';
}
