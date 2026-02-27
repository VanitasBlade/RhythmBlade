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
  emitSourceImportProgress(onProgress, payload = {}) {
    if (typeof onProgress !== 'function') {
      return;
    }

    try {
      onProgress(payload);
    } catch (error) {
      // Ignore UI progress callback errors.
    }
  },

  toNormalizedPathKey(pathValue) {
    return String(toPathFromUri(pathValue) || '')
      .replace(/\\/g, '/')
      .trim()
      .toLowerCase();
  },

  toUniqueAudioPathList(filePaths = []) {
    const seen = new Set();
    const output = [];

    filePaths.forEach(filePath => {
      const key = this.toNormalizedPathKey(filePath);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      output.push(toPathFromUri(filePath));
    });

    return output.filter(Boolean);
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
    const onProgress =
      typeof options.onProgress === 'function' ? options.onProgress : null;
    const sourcePath = await this.resolveDirectoryUriToFilePath(
      folderUriOrPath,
      true,
    );
    this.emitSourceImportProgress(onProgress, {
      phase: 'resolving',
      status: 'Resolving selected folder...',
      processed: 0,
      total: 0,
    });
    if (!sourcePath) {
      throw new Error('Unable to resolve selected folder');
    }

    this.emitSourceImportProgress(onProgress, {
      phase: 'scanning',
      status: 'Scanning folder for audio files...',
      processed: 0,
      total: 0,
      sourcePath,
    });
    const audioFiles = await this.readAudioFilesFromDirectory(
      sourcePath,
      options.recursive !== false,
    );
    const uniqueAudioFiles = this.toUniqueAudioPathList(audioFiles);
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
    let skippedCount = 0;
    let errorCount = 0;
    const importedSongIds = [];

    this.emitSourceImportProgress(onProgress, {
      phase: 'importing',
      status: `Extracting metadata... 0/${uniqueAudioFiles.length} files`,
      processed: 0,
      total: uniqueAudioFiles.length,
      importedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      sourcePath,
    });

    for (let index = 0; index < uniqueAudioFiles.length; index += 1) {
      const filePath = uniqueAudioFiles[index];
      const ext = getFileExtensionFromPath(filePath);
      if (ext) {
        formats.add(ext.toUpperCase());
      }
      try {
        const importedSong = await this.importLocalAudioPath(filePath, importOptions);
        if (importedSong?.id) {
          importedSongIds.push(importedSong.id);
        }
        importedCount += 1;
      } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        if (message.includes('already') || message.includes('existing')) {
          skippedCount += 1;
        } else {
          errorCount += 1;
        }
      }

      this.emitSourceImportProgress(onProgress, {
        phase: 'importing',
        status: `Extracting metadata... ${index + 1}/${
          uniqueAudioFiles.length
        } files`,
        processed: index + 1,
        total: uniqueAudioFiles.length,
        importedCount,
        skippedCount,
        errorCount,
        sourcePath,
      });
    }

    const nextSources = await this.addFileSource(sourcePath, {
      on: true,
      count: uniqueAudioFiles.length,
      fmt: Array.from(formats),
    });

    this.emitSourceImportProgress(onProgress, {
      phase: 'migrating-artwork',
      status: 'Finalizing artwork extraction...',
      processed: 0,
      total: 1,
      sourcePath,
    });
    const artworkMigration = shouldRunArtworkMigration
      ? await this.migrateAllArtworkNow({
          batchSize: 8,
          yieldMs: 0,
          onlySongIds: importedSongIds,
        })
      : null;
    this.emitSourceImportProgress(onProgress, {
      phase: 'migrating-duration',
      status: 'Finalizing duration metadata...',
      processed: 0,
      total: 1,
      sourcePath,
    });
    const durationMigration = shouldRunDurationMigration
      ? await this.migrateAllDurationsNow({
          batchSize: 10,
          yieldMs: 0,
          onlySongIds: importedSongIds,
        })
      : null;

    this.emitSourceImportProgress(onProgress, {
      phase: 'complete',
      status: 'Import complete.',
      processed: uniqueAudioFiles.length,
      total: uniqueAudioFiles.length,
      importedCount,
      skippedCount,
      errorCount,
      sourcePath,
    });

    return {
      sourcePath,
      fileCount: uniqueAudioFiles.length,
      importedCount,
      skippedCount,
      errorCount,
      formats: Array.from(formats),
      fileSources: nextSources,
      artworkMigration,
      durationMigration,
    };
  },

  async syncEnabledFileSourcesToLibrary(options = {}) {
    const onProgress =
      typeof options.onProgress === 'function' ? options.onProgress : null;
    const recursive = options.recursive !== false;
    const shouldRunArtworkMigration = options.migrateArtwork === true;
    const shouldRunDurationMigration = options.migrateDuration === true;
    const promptForPermission = options.promptForPermission === true;

    const fileSources = await this.getFileSources();
    const enabledSources = fileSources.filter(source => source.on !== false);
    if (enabledSources.length === 0) {
      return {
        scannedSources: 0,
        totalFiles: 0,
        processedCount: 0,
        importedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        fileSources,
      };
    }

    const hasPermission = await this.ensureAudioReadPermission(promptForPermission);
    if (!hasPermission) {
      return {
        scannedSources: 0,
        totalFiles: 0,
        processedCount: 0,
        importedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        permissionDenied: true,
        fileSources,
      };
    }

    const scanBySourceId = new Map();
    const allDiscoveredFiles = [];

    for (let index = 0; index < enabledSources.length; index += 1) {
      const source = enabledSources[index];
      this.emitSourceImportProgress(onProgress, {
        phase: 'scanning',
        status: `Scanning source ${index + 1}/${enabledSources.length}`,
        sourcePath: source.path,
        processed: index,
        total: enabledSources.length,
      });

      const files = this.toUniqueAudioPathList(
        await this.readAudioFilesFromDirectory(source.path, recursive),
      );
      const formats = new Set();
      files.forEach(filePath => {
        const ext = getFileExtensionFromPath(filePath);
        if (ext) {
          formats.add(ext.toUpperCase());
        }
      });

      scanBySourceId.set(source.id, {
        count: files.length,
        formats: Array.from(formats),
      });
      allDiscoveredFiles.push(...files);
    }

    const uniqueFiles = this.toUniqueAudioPathList(allDiscoveredFiles);
    const existingLibrary = await this.getLocalLibrary();
    const existingPathSet = new Set(
      existingLibrary
        .map(song => {
          const localPath = this.resolveSongLocalPath(song);
          return this.toNormalizedPathKey(localPath || song?.localPath || song?.url);
        })
        .filter(Boolean),
    );

    let processedCount = 0;
    let importedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const importedSongIds = [];

    this.emitSourceImportProgress(onProgress, {
      phase: 'importing',
      status: `Extracting metadata... 0/${uniqueFiles.length} files`,
      processed: 0,
      total: uniqueFiles.length,
      importedCount: 0,
      skippedCount: 0,
      errorCount: 0,
    });

    for (const filePath of uniqueFiles) {
      processedCount += 1;
      const pathKey = this.toNormalizedPathKey(filePath);
      if (!pathKey || existingPathSet.has(pathKey)) {
        skippedCount += 1;
        this.emitSourceImportProgress(onProgress, {
          phase: 'importing',
          status: `Extracting metadata... ${processedCount}/${uniqueFiles.length} files`,
          processed: processedCount,
          total: uniqueFiles.length,
          importedCount,
          skippedCount,
          errorCount,
        });
        continue;
      }

      try {
        const importedSong = await this.importLocalAudioPath(filePath, {
          skipArtworkHydration: true,
          skipDurationHydration: true,
        });
        importedCount += 1;
        if (importedSong?.id) {
          importedSongIds.push(importedSong.id);
        }
        existingPathSet.add(pathKey);
      } catch (error) {
        errorCount += 1;
      }

      this.emitSourceImportProgress(onProgress, {
        phase: 'importing',
        status: `Extracting metadata... ${processedCount}/${uniqueFiles.length} files`,
        processed: processedCount,
        total: uniqueFiles.length,
        importedCount,
        skippedCount,
        errorCount,
      });
    }

    const nextSources = fileSources.map(source => {
      const summary = scanBySourceId.get(source.id);
      if (!summary) {
        return source;
      }
      const nextFormats = Array.from(
        new Set([...(source.fmt || []), ...(summary.formats || [])]),
      );
      return {
        ...source,
        count: summary.count,
        fmt: nextFormats.length > 0 ? nextFormats : source.fmt,
      };
    });
    await this.saveFileSources(nextSources);

    let artworkMigration = null;
    let durationMigration = null;
    if (importedSongIds.length > 0 && shouldRunArtworkMigration) {
      this.emitSourceImportProgress(onProgress, {
        phase: 'migrating-artwork',
        status: 'Finalizing artwork extraction...',
        processed: 0,
        total: 1,
      });
      artworkMigration = await this.migrateAllArtworkNow({
        batchSize: 8,
        yieldMs: 0,
        onlySongIds: importedSongIds,
      });
    }

    if (importedSongIds.length > 0 && shouldRunDurationMigration) {
      this.emitSourceImportProgress(onProgress, {
        phase: 'migrating-duration',
        status: 'Finalizing duration metadata...',
        processed: 0,
        total: 1,
      });
      durationMigration = await this.migrateAllDurationsNow({
        batchSize: 10,
        yieldMs: 0,
        onlySongIds: importedSongIds,
      });
    }

    this.emitSourceImportProgress(onProgress, {
      phase: 'complete',
      status: 'Import complete.',
      processed: processedCount,
      total: uniqueFiles.length,
      importedCount,
      skippedCount,
      errorCount,
    });

    return {
      scannedSources: enabledSources.length,
      totalFiles: uniqueFiles.length,
      processedCount,
      importedCount,
      skippedCount,
      errorCount,
      artworkMigration,
      durationMigration,
      fileSources: nextSources,
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
