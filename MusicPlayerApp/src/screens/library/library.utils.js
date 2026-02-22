export const formatDuration = value => {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const sortSongs = (songs = [], sortBy = 'Name') => {
  const list = [...songs];
  if (sortBy === 'Artist') {
    return list.sort((a, b) =>
      String(a.artist || '').localeCompare(String(b.artist || '')),
    );
  }
  if (sortBy === 'Date Added') {
    return list.sort(
      (a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0),
    );
  }
  return list.sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || '')),
  );
};

export const normalizeFormats = source => {
  if (Array.isArray(source?.fmt)) {
    return source.fmt;
  }
  return String(source?.fmt || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

export const compactFolderPath = (value, levels = 2) => {
  const clean = String(value || '')
    .replace(/\\/g, '/')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) {
    return '';
  }

  const segments = clean.split('/').filter(Boolean);
  const depth = Math.max(1, Number(levels) || 2);

  if (segments.length <= depth) {
    return `/${segments.join('/')}`;
  }

  return `../${segments.slice(-depth).join('/')}`;
};
