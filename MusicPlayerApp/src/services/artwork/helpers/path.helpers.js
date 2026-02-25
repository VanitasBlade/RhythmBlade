function safeDecodeUriComponent(value) {
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

function hasUriScheme(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value || '').trim());
}

function normalizePathToken(value) {
  const input = String(value || '').trim();
  const shouldStripQueryAndHash =
    hasUriScheme(input) && !input.toLowerCase().startsWith('file://');
  const cleaned = shouldStripQueryAndHash
    ? input.split('?')[0].split('#')[0]
    : input;
  return safeDecodeUriComponent(cleaned);
}

function normalizeFilePath(trackOrPath) {
  if (!trackOrPath) {
    return '';
  }

  if (typeof trackOrPath === 'string') {
    const normalizedValue = normalizePathToken(trackOrPath);
    if (normalizedValue.startsWith('file://')) {
      return normalizePathToken(normalizedValue.slice(7));
    }
    if (normalizedValue.startsWith('content://')) {
      return '';
    }
    return normalizedValue;
  }

  const localPath = normalizePathToken(trackOrPath.localPath || '');
  if (localPath) {
    if (localPath.startsWith('content://')) {
      return '';
    }
    return localPath.startsWith('file://')
      ? normalizePathToken(localPath.slice(7))
      : localPath;
  }

  const url = normalizePathToken(trackOrPath.url || '');
  if (url.startsWith('content://')) {
    return '';
  }
  if (url.startsWith('file://')) {
    return normalizePathToken(url.slice(7));
  }

  return '';
}

function getFileExtension(filePath) {
  const match = String(filePath || '')
    .trim()
    .toLowerCase()
    .match(/\.([a-z0-9]{2,5})$/i);
  return match?.[1] || '';
}

export {
  getFileExtension,
  normalizeFilePath,
  normalizePathToken,
  safeDecodeUriComponent,
};
