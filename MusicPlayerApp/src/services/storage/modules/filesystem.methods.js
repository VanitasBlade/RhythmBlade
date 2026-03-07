import {PermissionsAndroid, Platform} from 'react-native';
import RNFS from 'react-native-fs';
import {
  normalizeFileSourcePath,
  safeDecodeUriComponent,
  stripUriQueryAndHash,
  toPathFromUri,
} from '../storage.helpers';

export const filesystemMethods = {
  toNormalizedPathKey(pathValue) {
    return String(toPathFromUri(pathValue) || '')
      .replace(/\\/g, '/')
      .trim()
      .toLowerCase();
  },

  async ensureUniquePath(destPath) {
    const normalized = toPathFromUri(destPath);
    if (!normalized) {
      return normalized;
    }

    const extMatch = normalized.match(/(\.[^./\\]+)$/);
    const extension = extMatch ? extMatch[1] : '';
    const withoutExt = extension
      ? normalized.slice(0, -extension.length)
      : normalized;

    let candidate = normalized;
    let index = 2;
    while (await RNFS.exists(candidate)) {
      candidate = `${withoutExt}_${index}${extension}`;
      index += 1;
    }

    return candidate;
  },

  getPreferredMusicDir() {
    if (Platform.OS === 'android' && RNFS.ExternalStorageDirectoryPath) {
      return `${RNFS.ExternalStorageDirectoryPath}/Music/RhythmBlade`;
    }
    return `${this.musicDir}/RhythmBlade`;
  },

  async ensureDirectory(dirPath) {
    const exists = await RNFS.exists(dirPath);
    if (!exists) {
      await RNFS.mkdir(dirPath);
    }
  },

  async requestStoragePermission() {
    if (Platform.OS !== 'android') {
      return true;
    }
    if (Platform.Version >= 33) {
      return true;
    }

    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      return false;
    }
  },

  async ensureAudioReadPermission(shouldPrompt = false) {
    if (Platform.OS !== 'android') {
      return true;
    }

    const permission =
      Platform.Version >= 33
        ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO
        : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
    if (!permission) {
      return true;
    }

    try {
      const alreadyGranted = await PermissionsAndroid.check(permission);
      if (alreadyGranted) {
        return true;
      }
    } catch (error) {
      // Continue to optional request path.
    }

    if (!shouldPrompt) {
      return false;
    }

    try {
      const granted = await PermissionsAndroid.request(permission);
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      return false;
    }
  },

  async ensureImageReadPermission(shouldPrompt = false) {
    if (Platform.OS !== 'android') {
      return true;
    }

    const permission =
      Platform.Version >= 33
        ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
        : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
    if (!permission) {
      return true;
    }

    try {
      const alreadyGranted = await PermissionsAndroid.check(permission);
      if (alreadyGranted) {
        return true;
      }
    } catch (error) {
      // Continue to optional request path.
    }

    if (!shouldPrompt) {
      return false;
    }

    try {
      const granted = await PermissionsAndroid.request(permission);
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      return false;
    }
  },

  async ensureArtworkReadWritePermission(shouldPrompt = false) {
    if (Platform.OS !== 'android') {
      return true;
    }

    if (Platform.Version >= 33) {
      // On Android 13+, image collection access is split from audio.
      return this.ensureImageReadPermission(shouldPrompt);
    }

    const readPermission = PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
    const writePermission =
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
    const required = [readPermission, writePermission].filter(Boolean);
    if (required.length === 0) {
      return true;
    }

    let allGranted = true;
    for (const permission of required) {
      try {
        const granted = await PermissionsAndroid.check(permission);
        if (!granted) {
          allGranted = false;
          break;
        }
      } catch (error) {
        allGranted = false;
        break;
      }
    }
    if (allGranted) {
      return true;
    }
    if (!shouldPrompt) {
      return false;
    }

    try {
      const result = await PermissionsAndroid.requestMultiple(required);
      return required.every(
        permission =>
          result?.[permission] === PermissionsAndroid.RESULTS.GRANTED,
      );
    } catch (error) {
      return false;
    }
  },

  addPathCandidate(list, rawPath) {
    const candidate = toPathFromUri(rawPath);
    if (!candidate || candidate.startsWith('content://')) {
      return;
    }

    if (!list.includes(candidate)) {
      list.push(candidate);
    }
  },

  getExternalStorageBasePath() {
    return (
      RNFS.ExternalStorageDirectoryPath ||
      RNFS.ExternalDirectoryPath ||
      '/storage/emulated/0'
    );
  },

  addStorageSuffixCandidate(candidates, suffix) {
    const cleanSuffix = String(suffix || '')
      .replace(/^\/+/, '')
      .trim();
    if (!cleanSuffix) {
      return;
    }
    if (cleanSuffix.toLowerCase().startsWith('storage/')) {
      this.addPathCandidate(candidates, `/${cleanSuffix}`);
      return;
    }
    this.addPathCandidate(
      candidates,
      `${this.getExternalStorageBasePath()}/${cleanSuffix}`,
    );
  },

  extractStorageSuffixesFromUri(decodedUri = '') {
    const suffixes = [];
    const addSuffix = value => {
      const clean = String(value || '')
        .replace(/^\/+/, '')
        .trim();
      if (!clean || suffixes.includes(clean)) {
        return;
      }
      suffixes.push(clean);
    };

    const rawMatch = decodedUri.match(/\/(?:tree|document)\/raw:(.+)$/i);
    if (rawMatch?.[1]) {
      this.addPathCandidate(suffixes, rawMatch[1]);
    }

    const primaryMatch = decodedUri.match(
      /\/(?:tree|document)\/primary:(.+)$/i,
    );
    if (primaryMatch?.[1]) {
      addSuffix(primaryMatch[1]);
    }

    const treeId = safeDecodeUriComponent(
      decodedUri.match(/\/tree\/([^/]+)$/i)?.[1] || '',
    );
    if (treeId.includes(':')) {
      addSuffix(treeId.split(':').slice(1).join(':'));
    }

    const documentId = safeDecodeUriComponent(
      decodedUri.match(/\/document\/([^/]+)$/i)?.[1] || '',
    );
    if (documentId.includes(':')) {
      addSuffix(documentId.split(':').slice(1).join(':'));
    }

    return suffixes;
  },

  async resolveDirectoryUriToFilePath(directoryUri, shouldPrompt = false) {
    const sourceUri = String(directoryUri || '').trim();
    if (!sourceUri) {
      return '';
    }

    if (!sourceUri.startsWith('content://')) {
      return normalizeFileSourcePath(toPathFromUri(sourceUri) || sourceUri);
    }

    await this.ensureAudioReadPermission(shouldPrompt);

    const candidates = [];
    const stat = await RNFS.stat(sourceUri).catch(() => null);
    this.addPathCandidate(candidates, stat?.originalFilepath || '');
    this.addPathCandidate(candidates, stat?.path || '');

    const decodedUri = safeDecodeUriComponent(stripUriQueryAndHash(sourceUri));
    const suffixes = this.extractStorageSuffixesFromUri(decodedUri);
    suffixes.forEach(suffix =>
      this.addStorageSuffixCandidate(candidates, suffix),
    );

    for (const candidate of candidates) {
      const exists = await RNFS.exists(candidate).catch(() => false);
      if (!exists) {
        continue;
      }
      const stats = await RNFS.stat(candidate).catch(() => null);
      if (!stats) {
        continue;
      }
      const isDir = stats.isDirectory?.() || stats.type === 1;
      if (isDir) {
        return normalizeFileSourcePath(candidate);
      }
    }

    if (suffixes.length > 0) {
      const fallbackCandidates = [];
      suffixes.forEach(suffix =>
        this.addStorageSuffixCandidate(fallbackCandidates, suffix),
      );
      if (fallbackCandidates[0]) {
        return normalizeFileSourcePath(fallbackCandidates[0]);
      }
    }

    return '';
  },

  async getWritableMusicDir() {
    const fallbackDir = `${this.musicDir}/RhythmBlade`;
    const fallbackExternalDir = normalizeFileSourcePath(this.rhythmBladeDir);
    await this.ensureDirectory(this.musicDir);

    let configuredDir = '';
    try {
      const settings = await this.getSettings();
      configuredDir = normalizeFileSourcePath(
        settings?.downloadSaveLocation || '',
      );
    } catch (error) {
      configuredDir = '';
    }
    const preferredDir =
      configuredDir || fallbackExternalDir || this.rhythmBladeDir;

    const externalBase = normalizeFileSourcePath(
      this.getExternalStorageBasePath(),
    );
    const isAndroidExternalTarget =
      Platform.OS === 'android' &&
      externalBase &&
      normalizeFileSourcePath(preferredDir).startsWith(`${externalBase}/`);

    if (!isAndroidExternalTarget) {
      try {
        await this.ensureDirectory(preferredDir);
        return preferredDir;
      } catch (error) {
        // Fall through to fallback handling.
      }
    } else {
      const hasPermission = await this.requestStoragePermission();
      if (hasPermission) {
        try {
          await this.ensureDirectory(preferredDir);
          return preferredDir;
        } catch (error) {
          // Fall through to default external then internal fallback.
        }

        try {
          await this.ensureDirectory(this.rhythmBladeDir);
          return this.rhythmBladeDir;
        } catch (error) {
          // Fall through to app-internal directory.
        }
      }
    }

    await this.ensureDirectory(fallbackDir);
    return fallbackDir;
  },

  async initializeDirectories() {
    try {
      await this.ensureDirectory(this.musicDir);
      await this.getWritableMusicDir();
      console.log('Music directories ready');
    } catch (error) {
      console.error('Error creating music directory:', error);
    }
  },
};
