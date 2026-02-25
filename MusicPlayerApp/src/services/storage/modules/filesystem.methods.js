import {PermissionsAndroid, Platform} from 'react-native';
import RNFS from 'react-native-fs';
import {
  getFileExtensionFromPath,
  getFileNameFromUriOrPath,
  isSupportedAudioFilename,
  normalizeFileSourcePath,
  safeDecodeUriComponent,
  stripUriQueryAndHash,
  toFileUriFromPath,
  toPathFromUri,
} from '../storage.helpers';

export const filesystemMethods = {
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

  async readAudioFilesFromDirectory(directoryPath, recursive = true) {
    const rootPath = normalizeFileSourcePath(directoryPath);
    if (!rootPath) {
      return [];
    }

    const exists = await RNFS.exists(rootPath).catch(() => false);
    if (!exists) {
      return [];
    }

    const queue = [rootPath];
    const filePaths = [];
    const visited = new Set();

    while (queue.length > 0) {
      const currentPath = queue.pop();
      if (!currentPath || visited.has(currentPath)) {
        continue;
      }
      visited.add(currentPath);

      const items = await RNFS.readDir(currentPath).catch(() => []);
      for (const item of items) {
        if (!item) {
          continue;
        }
        if (item.isFile?.()) {
          if (isSupportedAudioFilename(item.name || item.path)) {
            filePaths.push(item.path);
          }
          continue;
        }
        if (recursive && item.isDirectory?.()) {
          queue.push(item.path);
        }
      }
    }

    return filePaths;
  },

  async importLocalAudioPath(filePath, options = {}) {
    const normalizedPath = toPathFromUri(filePath);
    if (!normalizedPath) {
      throw new Error('Invalid local audio path');
    }

    const filename = normalizedPath.split('/').filter(Boolean).pop() || '';
    return this.importLocalAudioFile(
      {
        uri: toFileUriFromPath(normalizedPath),
        name: filename,
      },
      options,
    );
  },

  async importFolderAsFileSource(folderUriOrPath, options = {}) {
    const sourcePath = await this.resolveDirectoryUriToFilePath(
      folderUriOrPath,
      true,
    );
    if (!sourcePath) {
      throw new Error('Unable to resolve selected folder');
    }

    const audioFiles = await this.readAudioFilesFromDirectory(
      sourcePath,
      options.recursive !== false,
    );
    const shouldRunArtworkMigration = options.migrateArtwork !== false;
    const shouldRunDurationMigration = options.migrateDuration !== false;
    const importOptions = shouldRunArtworkMigration
      ? {
          skipArtworkHydration: true,
          skipDurationHydration: shouldRunDurationMigration,
        }
      : {
          skipDurationHydration: shouldRunDurationMigration,
        };
    const formats = new Set();
    let importedCount = 0;

    for (const filePath of audioFiles) {
      const ext = getFileExtensionFromPath(filePath);
      if (ext) {
        formats.add(ext.toUpperCase());
      }
      try {
        await this.importLocalAudioPath(filePath, importOptions);
        importedCount += 1;
      } catch (error) {
        // Continue importing other files.
      }
    }

    const nextSources = await this.addFileSource(sourcePath, {
      on: true,
      count: audioFiles.length,
      fmt: Array.from(formats),
    });

    const artworkMigration = shouldRunArtworkMigration
      ? await this.migrateAllArtworkNow({
          batchSize: 8,
          yieldMs: 0,
        })
      : null;
    const durationMigration = shouldRunDurationMigration
      ? await this.migrateAllDurationsNow({
          batchSize: 10,
          yieldMs: 0,
        })
      : null;

    return {
      sourcePath,
      fileCount: audioFiles.length,
      importedCount,
      formats: Array.from(formats),
      fileSources: nextSources,
      artworkMigration,
      durationMigration,
    };
  },

  async resolveContentUriToFilePath(
    contentUri,
    filenameHint = '',
    shouldPrompt = false,
  ) {
    const sourceUri = String(contentUri || '').trim();
    if (!sourceUri.startsWith('content://')) {
      return '';
    }

    await this.ensureAudioReadPermission(shouldPrompt);

    const candidates = [];
    const stat = await RNFS.stat(sourceUri).catch(() => null);
    this.addPathCandidate(candidates, stat?.originalFilepath || '');
    this.addPathCandidate(candidates, stat?.path || '');

    const externalBase =
      RNFS.ExternalStorageDirectoryPath ||
      RNFS.ExternalDirectoryPath ||
      '/storage/emulated/0';

    const decodedUri = safeDecodeUriComponent(stripUriQueryAndHash(sourceUri));
    const rawMatch = decodedUri.match(/\/document\/raw:(.+)$/i);
    if (rawMatch?.[1]) {
      this.addPathCandidate(candidates, rawMatch[1]);
    }

    const primaryMatch = decodedUri.match(/\/document\/primary:(.+)$/i);
    if (primaryMatch?.[1]) {
      this.addPathCandidate(candidates, `${externalBase}/${primaryMatch[1]}`);
    }

    const documentId = safeDecodeUriComponent(
      decodedUri.match(/\/document\/([^/]+)$/i)?.[1] || '',
    );
    if (documentId.includes(':')) {
      const suffix = documentId.split(':').slice(1).join(':');
      if (suffix && !suffix.startsWith('/')) {
        this.addPathCandidate(candidates, `${externalBase}/${suffix}`);
      }
    }

    const resolvedFileName =
      String(filenameHint || '').trim() ||
      String(stat?.name || '').trim() ||
      getFileNameFromUriOrPath(decodedUri);

    if (resolvedFileName && !resolvedFileName.includes(':')) {
      const sharedDirs = [
        `${externalBase}/Download`,
        `${externalBase}/Downloads`,
        `${externalBase}/Music`,
        `${externalBase}/Music/RhythmBlade`,
      ];
      sharedDirs.forEach(dirPath =>
        this.addPathCandidate(candidates, `${dirPath}/${resolvedFileName}`),
      );
    }

    for (const candidate of candidates) {
      const exists = await RNFS.exists(candidate).catch(() => false);
      if (exists) {
        return candidate;
      }
    }

    return '';
  },

  async getWritableMusicDir() {
    const fallbackDir = `${this.musicDir}/RhythmBlade`;
    await this.ensureDirectory(this.musicDir);

    const hasPermission = await this.requestStoragePermission();
    if (hasPermission) {
      try {
        await this.ensureDirectory(this.rhythmBladeDir);
        return this.rhythmBladeDir;
      } catch (error) {
        // Fall through to app-internal directory.
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
