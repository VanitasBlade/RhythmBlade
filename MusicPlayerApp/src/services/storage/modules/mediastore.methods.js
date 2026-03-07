import AsyncStorage from '@react-native-async-storage/async-storage';
import {Platform} from 'react-native';
import MediaStoreBridge from './MediaStoreBridge';
import {STORAGE_KEYS} from '../storage.constants';
import {
  normalizeFileSourcePath,
  toPathFromUri,
} from '../storage.helpers';

const MEDIASTORE_PROVIDER_VALUES = new Set(['media_store']);
const MEDIASTORE_SYNC_SCHEMA_VERSION = 1;
const MEDIASTORE_SKIP_WINDOW_MS = 5 * 60 * 1000;
const MEDIASTORE_OBSERVER_DEBOUNCE_MS = 700;
const MEDIASTORE_QUERY_PATH_RETRY_MS = 250;
const MEDIASTORE_FAILURE_RESET_THRESHOLD = 3;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeProvider(value) {
  if (Platform.OS === 'android') {
    return 'media_store';
  }

  const provider = String(value || '')
    .trim()
    .toLowerCase();
  if (!provider) {
    return 'legacy_fs';
  }
  return provider;
}

function normalizeMediaStoreId(value) {
  return String(value || '').trim();
}

function normalizeAbsolutePath(pathValue) {
  const normalized = normalizeFileSourcePath(toPathFromUri(pathValue));
  if (!normalized) {
    return '';
  }
  return normalized.replace(/\/+$/g, '');
}

function normalizeContentUri(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.toLowerCase();
}

function toMsNumber(value) {
  const numeric = Number(value) || 0;
  return numeric > 0 ? Math.round(numeric) : 0;
}

function isMediaStoreAlbumArtUri(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  return text.startsWith('content://media/external/audio/albumart/');
}

export const mediaStoreMethods = {
  async getLibraryProvider() {
    const settings = await this.getSettings();
    return normalizeProvider(settings?.libraryProvider || 'media_store');
  },

  async ensureMediaStoreOnlyMigration() {
    if (Platform.OS !== 'android') {
      return {
        changed: false,
        reason: 'not-android',
      };
    }

    const settings = await this.getSettings();
    const alreadyMigrated =
      settings?.mediaStoreOnlyMigrationDone === true &&
      normalizeProvider(settings?.libraryProvider) === 'media_store';
    if (alreadyMigrated) {
      return {
        changed: false,
        reason: 'already-migrated',
      };
    }

    const supported = await MediaStoreBridge.isSupported();
    this.mediaStoreSupportCache = supported === true;
    if (!supported) {
      return {
        changed: false,
        reason: 'mediastore-unsupported',
      };
    }

    await this.saveSettings({
      ...settings,
      libraryProvider: 'media_store',
      mediaStoreOnlyMigrationDone: true,
    });
    return {
      changed: true,
      reason: 'forced-mediastore-provider',
    };
  },

  isMediaStoreProvider(provider) {
    return MEDIASTORE_PROVIDER_VALUES.has(normalizeProvider(provider));
  },

  async scanMediaStorePaths(paths = []) {
    const normalizedPaths = Array.isArray(paths)
      ? paths
          .map(path => normalizeAbsolutePath(path))
          .filter(Boolean)
      : [];
    if (normalizedPaths.length === 0) {
      return {
        requested: 0,
        accepted: 0,
        discoveredFiles: 0,
        scannedFiles: 0,
        failedFiles: 0,
        results: [],
      };
    }
    return MediaStoreBridge.scanPaths(normalizedPaths);
  },

  isLikelyMediaStoreSong(song) {
    return Boolean(
      String(song?.provider || '').trim() === 'media_store' ||
        normalizeMediaStoreId(song?.mediaStoreId) ||
        String(song?.url || '').startsWith('content://') ||
        String(song?.contentUri || '').startsWith('content://'),
    );
  },

  getSongPathKeyForStore(song = {}) {
    const localPath = String(song?.localPath || '').trim();
    if (localPath) {
      return this.toNormalizedPathKey(localPath);
    }
    const absolutePath = String(song?.absolutePath || '').trim();
    if (absolutePath) {
      return this.toNormalizedPathKey(absolutePath);
    }
    const contentUri = String(song?.contentUri || song?.url || '').trim();
    if (contentUri) {
      return this.toNormalizedPathKey(contentUri);
    }
    return '';
  },

  getSongMediaStoreId(song = {}) {
    const explicitId = normalizeMediaStoreId(song?.mediaStoreId);
    if (explicitId) {
      return explicitId;
    }
    const songId = String(song?.id || '').trim();
    if (songId.startsWith('ms_')) {
      return normalizeMediaStoreId(songId.slice(3));
    }
    return '';
  },

  getSongContentUri(song = {}) {
    const fromSong = String(song?.contentUri || '').trim();
    if (fromSong) {
      return fromSong;
    }
    const fromUrl = String(song?.url || '').trim();
    if (fromUrl.startsWith('content://')) {
      return fromUrl;
    }
    return '';
  },

  async getMediaStoreSyncMeta() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.MEDIASTORE_SYNC_META);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return parsed;
    } catch (error) {
      return null;
    }
  },

  async saveMediaStoreSyncMeta(meta = {}) {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.MEDIASTORE_SYNC_META,
        JSON.stringify(meta || {}),
      );
      return meta;
    } catch (error) {
      return null;
    }
  },

  async getHiddenMediaStoreIds() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.HIDDEN_MEDIASTORE_IDS);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        return new Set();
      }
      return new Set(
        parsed.map(id => normalizeMediaStoreId(id)).filter(Boolean),
      );
    } catch (error) {
      return new Set();
    }
  },

  async saveHiddenMediaStoreIds(hiddenIdSet = new Set()) {
    const values = Array.from(hiddenIdSet)
      .map(id => normalizeMediaStoreId(id))
      .filter(Boolean);
    await AsyncStorage.setItem(
      STORAGE_KEYS.HIDDEN_MEDIASTORE_IDS,
      JSON.stringify(values),
    );
    return values;
  },

  async hideMediaStoreSong(song = {}) {
    const mediaStoreId = normalizeMediaStoreId(song?.mediaStoreId);
    if (!mediaStoreId) {
      return false;
    }
    const hiddenIds = await this.getHiddenMediaStoreIds();
    if (!hiddenIds.has(mediaStoreId)) {
      hiddenIds.add(mediaStoreId);
      await this.saveHiddenMediaStoreIds(hiddenIds);
    }
    if (song?.id) {
      await this.removeFromLibrary(song.id);
    }
    return true;
  },

  buildMediaStoreFileSourceHash(fileSources = []) {
    const list = Array.isArray(fileSources) ? fileSources : [];
    const normalized = list
      .map(source => ({
        path: normalizeAbsolutePath(source?.path || ''),
        on: source?.on !== false,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return JSON.stringify(normalized);
  },

  resolveMediaStoreAbsolutePath(row = {}) {
    const explicitPath = normalizeAbsolutePath(row?.absolutePath || '');
    if (explicitPath) {
      return explicitPath;
    }
    const relativePath = String(row?.relativePath || '')
      .replace(/\\/g, '/')
      .trim();
    const displayName = String(row?.displayName || '').trim();
    if (!relativePath || !displayName) {
      return '';
    }
    const cleanRelative = relativePath
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    const composed = `/storage/emulated/0/${cleanRelative}/${displayName}`;
    return normalizeAbsolutePath(composed);
  },

  getAppOwnedRoots(settings = null) {
    const roots = new Set();
    const preferred = normalizeAbsolutePath(this.getPreferredMusicDir());
    if (preferred) {
      roots.add(preferred);
    }
    const configured = normalizeAbsolutePath(settings?.downloadSaveLocation || '');
    if (configured) {
      roots.add(configured);
    }
    return Array.from(roots);
  },

  isPathUnderRoots(pathKey, roots = []) {
    const normalizedPath = String(pathKey || '').trim();
    if (!normalizedPath) {
      return false;
    }
    return roots.some(root => {
      const normalizedRoot = String(root || '').trim();
      if (!normalizedRoot) {
        return false;
      }
      return (
        normalizedPath === normalizedRoot ||
        normalizedPath.startsWith(`${normalizedRoot}/`)
      );
    });
  },

  isSongAppOwned(song = {}, settings = null) {
    if (song?.isAppOwned === true) {
      return true;
    }
    const roots = this.getAppOwnedRoots(settings);
    const pathKey = this.getSongPathKeyForStore(song);
    return this.isPathUnderRoots(pathKey, roots);
  },

  filterMediaStoreRowsBySources(rows = [], fileSources = [], options = {}) {
    const selectedOnly = options.selectedOnly !== false;
    const sources = Array.isArray(fileSources) ? fileSources : [];
    const enabledSources = sources.filter(source => source?.on !== false);
    const roots = enabledSources
      .map(source => ({
        id: String(source?.id || '').trim(),
        path: String(source?.path || '').trim(),
        pathKey: this.toNormalizedPathKey(source?.path || ''),
      }))
      .filter(source => source.pathKey);

    if (!selectedOnly) {
      const sourceByMediaStoreId = new Map();
      (Array.isArray(rows) ? rows : []).forEach(row => {
        const mediaStoreId = normalizeMediaStoreId(
          row?.mediaStoreId || row?.id || '',
        );
        if (!mediaStoreId) {
          return;
        }
        const rowPath = this.toNormalizedPathKey(
          this.resolveMediaStoreAbsolutePath(row),
        );
        const matchedSource = roots.find(source =>
          this.isPathUnderRoots(rowPath, [source.pathKey]),
        );
        sourceByMediaStoreId.set(mediaStoreId, {
          sourceId: matchedSource?.id || '',
          sourcePath: matchedSource?.path || '',
          pathKey: rowPath,
        });
      });
      return {
        rows: Array.isArray(rows) ? rows : [],
        sourceByMediaStoreId,
      };
    }

    if (roots.length === 0) {
      return {
        rows: [],
        sourceByMediaStoreId: new Map(),
      };
    }

    const sourceByMediaStoreId = new Map();
    const filtered = [];
    const input = Array.isArray(rows) ? rows : [];
    input.forEach(row => {
      const mediaStoreId = normalizeMediaStoreId(
        row?.mediaStoreId || row?.id || '',
      );
      if (!mediaStoreId) {
        return;
      }
      const rowPath = this.toNormalizedPathKey(
        this.resolveMediaStoreAbsolutePath(row),
      );
      if (!rowPath) {
        return;
      }
      const matchedSource = roots.find(source =>
        this.isPathUnderRoots(rowPath, [source.pathKey]),
      );
      if (!matchedSource) {
        return;
      }
      filtered.push(row);
      sourceByMediaStoreId.set(mediaStoreId, {
        sourceId: matchedSource.id,
        sourcePath: matchedSource.path,
        pathKey: rowPath,
      });
    });

    return {
      rows: filtered,
      sourceByMediaStoreId,
    };
  },

  mapMediaStoreRowToSong(row = {}, context = {}) {
    const mediaStoreId = normalizeMediaStoreId(row?.mediaStoreId || row?.id);
    if (!mediaStoreId) {
      return null;
    }

    const contentUri =
      String(row?.contentUri || '').trim() ||
      `content://media/external/audio/media/${mediaStoreId}`;
    const absolutePath = this.resolveMediaStoreAbsolutePath(row);
    const sourcePath = this.normalizeSourcePath(context?.sourcePath || '');
    const title =
      String(row?.title || '').trim() ||
      String(row?.displayName || '').replace(/\.[^/.]+$/g, '') ||
      'Track';
    const artist = String(row?.artist || '').trim() || 'Unknown Artist';
    const album = String(row?.album || '').trim() || '';
    const artwork = String(row?.albumArtUri || '').trim();
    const dateAddedMs = toMsNumber(row?.dateAddedMs);
    const dateModifiedMs = toMsNumber(row?.dateModifiedMs);
    const fileSizeBytes = Math.max(0, Number(row?.size) || 0);
    const duration = Math.max(0, Number(row?.durationSec) || 0);
    const addedAt = dateAddedMs || Date.now();

    return {
      id: `ms_${mediaStoreId}`,
      mediaStoreId,
      provider: 'media_store',
      contentUri,
      url: contentUri,
      localPath: absolutePath,
      absolutePath,
      relativePath: String(row?.relativePath || '').trim(),
      title,
      artist,
      album,
      duration,
      artwork: artwork || '',
      mimeType: String(row?.mimeType || '').trim(),
      filename: String(row?.displayName || '').trim() || title,
      sourceFilename: String(row?.displayName || '').trim() || title,
      sourcePath,
      fileSizeBytes,
      fileMtimeMs: dateModifiedMs,
      dateModifiedMs,
      addedAt,
      isLocal: true,
      isAppOwned: context?.isAppOwned === true,
      isHidden: false,
    };
  },

  async shouldUseMediaStoreProvider(options = {}) {
    if (Platform.OS !== 'android') {
      return false;
    }
    if (options.ignoreSessionFallback !== true && this.mediaStoreSessionFallback) {
      return false;
    }
    const provider = options.provider || (await this.getLibraryProvider());
    if (!this.isMediaStoreProvider(provider)) {
      return false;
    }
    if (this.mediaStoreSupportCache === true) {
      return true;
    }
    const supported = await MediaStoreBridge.isSupported();
    this.mediaStoreSupportCache = supported === true;
    return supported === true;
  },

  async shouldSkipInitialMediaStoreQuery(options = {}) {
    if (options.forceRefresh === true || options.skipGuardChecks === true) {
      return false;
    }
    if (options.launchSync !== true) {
      return false;
    }
    const settings = await this.getSettings();
    if (Number(settings?.mediaStoreConsecutiveFailures) > 0) {
      return false;
    }
    if (this.libraryStore?.hasPendingFlush()) {
      return false;
    }
    const provider = normalizeProvider(settings?.libraryProvider);
    if (!this.isMediaStoreProvider(provider)) {
      return false;
    }
    const fileSources = await this.getFileSources();
    const folderHash = this.buildMediaStoreFileSourceHash(fileSources);
    const syncMeta = await this.getMediaStoreSyncMeta();
    if (!syncMeta || typeof syncMeta !== 'object') {
      return false;
    }
    const lastSyncedAt = toMsNumber(syncMeta?.lastSyncedAt);
    const lastSyncedRaw = await AsyncStorage.getItem(
      STORAGE_KEYS.LAST_LIBRARY_SYNC_AT,
    );
    const lastSyncedKeyMs = toMsNumber(lastSyncedRaw);
    const effectiveLastSyncedAt = Math.max(lastSyncedAt, lastSyncedKeyMs);
    if (!effectiveLastSyncedAt) {
      return false;
    }
    if (Date.now() - effectiveLastSyncedAt > MEDIASTORE_SKIP_WINDOW_MS) {
      return false;
    }
    if (
      Number(syncMeta?.schemaVersion) !== MEDIASTORE_SYNC_SCHEMA_VERSION ||
      normalizeProvider(syncMeta?.provider) !== provider ||
      String(syncMeta?.folderHash || '') !== folderHash ||
      String(syncMeta?.status || '') !== 'success'
    ) {
      return false;
    }
    return true;
  },

  async onMediaStoreSyncFailure(error, options = {}) {
    this.mediaStoreSessionFallback = true;
    this.mediaStoreSessionFallbackReason = String(error?.message || error || '');
    const settings = await this.getSettings();
    const fileSources = await this.getFileSources();
    const provider = normalizeProvider(settings?.libraryProvider);
    const folderHash = this.buildMediaStoreFileSourceHash(fileSources);
    await this.saveMediaStoreSyncMeta({
      provider,
      folderHash,
      schemaVersion: MEDIASTORE_SYNC_SCHEMA_VERSION,
      status: 'failed',
      failedAt: Date.now(),
      reason: this.mediaStoreSessionFallbackReason,
    });
    console.warn('[MediaStoreSync] sync-failed', {
      launchSync: options.launchSync === true,
      reason: this.mediaStoreSessionFallbackReason,
      provider,
    });

    if (options.launchSync !== true) {
      return;
    }

    const currentFailures = Math.max(
      0,
      Number(settings?.mediaStoreConsecutiveFailures) || 0,
    );
    const nextFailures = currentFailures + 1;
    const nextSettings = {
      ...settings,
      mediaStoreConsecutiveFailures: nextFailures,
    };

    if (nextFailures >= MEDIASTORE_FAILURE_RESET_THRESHOLD) {
      console.warn('[MediaStoreSync] launch-failure-threshold-reached', {
        threshold: MEDIASTORE_FAILURE_RESET_THRESHOLD,
        failureCount: nextFailures,
      });
    }

    await this.saveSettings(nextSettings);
  },

  async onMediaStoreSyncSuccess() {
    this.mediaStoreSessionFallback = false;
    this.mediaStoreSessionFallbackReason = '';
    const settings = await this.getSettings();
    if ((Number(settings?.mediaStoreConsecutiveFailures) || 0) <= 0) {
      return;
    }
    await this.saveSettings({
      ...settings,
      mediaStoreConsecutiveFailures: 0,
    });
  },

  async updateFileSourceCountsFromMediaStore(
    sourceByMediaStoreId = new Map(),
    fileSources = [],
  ) {
    const countsBySourceId = new Map();
    sourceByMediaStoreId.forEach(value => {
      const sourceId = String(value?.sourceId || '').trim();
      if (!sourceId) {
        return;
      }
      countsBySourceId.set(sourceId, (countsBySourceId.get(sourceId) || 0) + 1);
    });

    const nextSources = (Array.isArray(fileSources) ? fileSources : []).map(
      source => {
        const sourceId = String(source?.id || '').trim();
        const nextCount = countsBySourceId.get(sourceId);
        return {
          ...source,
          count: nextCount === undefined ? 0 : nextCount,
        };
      },
    );

    await this.saveFileSources(nextSources);
    return nextSources;
  },

  async migratePlaylistsToMediaStoreIdsOnce() {
    const settings = await this.getSettings();
    if (settings?.playlistMediaStoreMigrationDone === true) {
      return {
        migrated: false,
      };
    }

    const playlists = await this.getPlaylists();
    if (!Array.isArray(playlists) || playlists.length === 0) {
      await this.saveSettings({
        ...settings,
        playlistMediaStoreMigrationDone: true,
      });
      return {
        migrated: false,
      };
    }

    const library = await this.getLocalLibrary();
    const indexById = new Map();
    const indexBySourceSongId = new Map();
    const indexByPathKey = new Map();
    const indexByContentUri = new Map();
    library.forEach(song => {
      if (!song || typeof song !== 'object') {
        return;
      }
      const songId = String(song?.id || '').trim();
      if (songId) {
        indexById.set(songId, song);
      }
      const sourceSongId = String(song?.sourceSongId || '').trim();
      if (sourceSongId) {
        indexBySourceSongId.set(sourceSongId, song);
      }
      const pathKey = this.getSongPathKeyForStore(song);
      if (pathKey) {
        indexByPathKey.set(pathKey, song);
      }
      const contentUri = normalizeContentUri(song?.contentUri || song?.url);
      if (contentUri) {
        indexByContentUri.set(contentUri, song);
      }
    });

    let changed = false;
    let resolvedCount = 0;
    let unresolvedCount = 0;
    const nextPlaylists = playlists.map(playlist => {
      const songs = Array.isArray(playlist?.songs) ? playlist.songs : [];
      let playlistChanged = false;
      const nextSongs = songs.map(song => {
        const candidatePathKey = this.getSongPathKeyForStore(song);
        const candidateContentUri = normalizeContentUri(song?.url || '');
        const candidateSourceSongId = String(song?.sourceSongId || '').trim();
        const candidateId = String(song?.id || '').trim();
        const matched =
          (candidatePathKey && indexByPathKey.get(candidatePathKey)) ||
          (candidateContentUri && indexByContentUri.get(candidateContentUri)) ||
          (candidateSourceSongId && indexBySourceSongId.get(candidateSourceSongId)) ||
          (candidateId && indexById.get(candidateId)) ||
          null;
        if (matched?.id) {
          resolvedCount += 1;
          const nextId = String(matched.id || '').trim();
          const previousId = String(song?.id || '').trim();
          const nextSong = {
            ...song,
            ...matched,
            id: nextId,
            unresolved: false,
          };
          if (candidateId && candidateId !== nextId) {
            nextSong.sourceSongId =
              String(nextSong.sourceSongId || '').trim() || candidateId;
          }
          if (previousId !== nextId || song?.unresolved === true) {
            playlistChanged = true;
          }
          return nextSong;
        }

        unresolvedCount += 1;
        if (song?.unresolved !== true) {
          playlistChanged = true;
        }
        return {
          ...song,
          unresolved: true,
        };
      });

      if (!playlistChanged) {
        return playlist;
      }
      changed = true;
      return {
        ...playlist,
        songs: nextSongs,
        updatedAt: Date.now(),
      };
    });

    if (changed) {
      await this.savePlaylists(nextPlaylists);
    }

    await this.saveSettings({
      ...settings,
      playlistMediaStoreMigrationDone: true,
    });

    return {
      migrated: changed,
      resolvedCount,
      unresolvedCount,
    };
  },

  async retryUnresolvedPlaylistEntriesFromLibrary() {
    const playlists = await this.getPlaylists();
    if (!Array.isArray(playlists) || playlists.length === 0) {
      return {
        updated: false,
        resolvedCount: 0,
      };
    }

    const library = await this.getLocalLibrary();
    const indexById = new Map();
    const indexBySourceSongId = new Map();
    const indexByPathKey = new Map();
    const indexByContentUri = new Map();

    library.forEach(song => {
      if (!song || typeof song !== 'object') {
        return;
      }
      const songId = String(song?.id || '').trim();
      if (songId) {
        indexById.set(songId, song);
      }
      const sourceSongId = String(song?.sourceSongId || '').trim();
      if (sourceSongId) {
        indexBySourceSongId.set(sourceSongId, song);
      }
      const pathKey = this.getSongPathKeyForStore(song);
      if (pathKey) {
        indexByPathKey.set(pathKey, song);
      }
      const contentUri = normalizeContentUri(song?.contentUri || song?.url);
      if (contentUri) {
        indexByContentUri.set(contentUri, song);
      }
    });

    let resolvedCount = 0;
    let changed = false;
    const nextPlaylists = playlists.map(playlist => {
      const songs = Array.isArray(playlist?.songs) ? playlist.songs : [];
      let playlistChanged = false;
      const nextSongs = songs.map(song => {
        if (song?.unresolved !== true) {
          return song;
        }

        const candidatePathKey = this.getSongPathKeyForStore(song);
        const candidateContentUri = normalizeContentUri(
          song?.contentUri || song?.url,
        );
        const candidateSourceSongId = String(song?.sourceSongId || '').trim();
        const candidateId = String(song?.id || '').trim();
        const matched =
          (candidatePathKey && indexByPathKey.get(candidatePathKey)) ||
          (candidateContentUri && indexByContentUri.get(candidateContentUri)) ||
          (candidateSourceSongId && indexBySourceSongId.get(candidateSourceSongId)) ||
          (candidateId && indexById.get(candidateId)) ||
          null;
        if (!matched?.id) {
          return song;
        }

        resolvedCount += 1;
        playlistChanged = true;
        const nextSong = {
          ...song,
          ...matched,
          id: String(matched.id || '').trim(),
          unresolved: false,
        };
        if (candidateId && candidateId !== nextSong.id) {
          nextSong.sourceSongId =
            String(nextSong.sourceSongId || '').trim() || candidateId;
        }
        return nextSong;
      });

      if (!playlistChanged) {
        return playlist;
      }

      changed = true;
      return {
        ...playlist,
        songs: nextSongs,
        updatedAt: Date.now(),
      };
    });

    if (changed) {
      await this.savePlaylists(nextPlaylists);
    }

    return {
      updated: changed,
      resolvedCount,
    };
  },

  async syncLibraryFromMediaStore(options = {}) {
    const settings = await this.getSettings();
    const fileSources = await this.getFileSources();
    const provider = normalizeProvider(settings?.libraryProvider);
    const selectedOnly = settings?.mediaStoreSelectedFoldersOnly !== false;
    const existingLibrary = await this.getLocalLibrary();
    const existingByMediaStoreId = new Map();
    existingLibrary.forEach(song => {
      const mediaStoreId = normalizeMediaStoreId(song?.mediaStoreId);
      if (!mediaStoreId) {
        return;
      }
      existingByMediaStoreId.set(mediaStoreId, song);
    });

    if (
      !(
        await this.shouldUseMediaStoreProvider({
          provider,
          ignoreSessionFallback: options.forceRefresh === true,
        })
      )
    ) {
      throw new Error('MediaStore provider is not available');
    }

    const shouldSkip = await this.shouldSkipInitialMediaStoreQuery(options);
    if (shouldSkip) {
      await this.hydrateLibraryStoreFromDisk();
      const meta = await this.getMediaStoreSyncMeta();
      if (settings?.mediaStoreObserverEnabled !== false) {
        this.startMediaStoreObservation().catch(() => {});
      }
      return {
        status: 'skipped',
        skipped: true,
        provider: 'media_store',
        scannedSources: fileSources.filter(source => source?.on !== false).length,
        totalFiles: this.getLibraryStoreSnapshot().length,
        importedCount: 0,
        removedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        removedSongIds: [],
        removedPathKeys: [],
        lastSyncedAt: toMsNumber(meta?.lastSyncedAt) || Date.now(),
        fileSources,
      };
    }

    const snapshot = await MediaStoreBridge.queryAudioSnapshot({
      forceRefresh: options.forceRefresh === true,
    });
    if (snapshot?.permissionDenied) {
      await this.hydrateLibraryStoreFromDisk();
      return {
        status: 'permission-denied',
        provider: 'media_store',
        scannedSources: 0,
        totalFiles: this.getLibraryStoreSnapshot().length,
        processedCount: 0,
        importedCount: 0,
        removedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        removedSongIds: [],
        removedPathKeys: [],
        permissionDenied: true,
        fileSources,
      };
    }

    const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    const {rows: filteredRows, sourceByMediaStoreId} =
      this.filterMediaStoreRowsBySources(rows, fileSources, {
        selectedOnly,
      });
    const hiddenMediaIds = await this.getHiddenMediaStoreIds();
    const appOwnedRoots = this.getAppOwnedRoots(settings).map(path =>
      this.toNormalizedPathKey(path),
    );

    const mediaSongs = [];
    filteredRows.forEach(row => {
      const mediaStoreId = normalizeMediaStoreId(row?.mediaStoreId || row?.id);
      if (!mediaStoreId || hiddenMediaIds.has(mediaStoreId)) {
        return;
      }
      const sourceMatch = sourceByMediaStoreId.get(mediaStoreId) || {};
      const absolutePath = this.resolveMediaStoreAbsolutePath(row);
      const pathKey = this.toNormalizedPathKey(absolutePath);
      const isAppOwned = this.isPathUnderRoots(pathKey, appOwnedRoots);
      const mapped = this.mapMediaStoreRowToSong(row, {
        sourcePath: sourceMatch?.sourcePath || '',
        isAppOwned,
      });
      if (mapped) {
        // Preserve non-MediaStore artwork for app-owned tracks so an old
        // MediaStore albumArtUri does not override embedded/local artwork.
        const existingMatch = existingByMediaStoreId.get(mediaStoreId);
        const existingArtwork = String(existingMatch?.artwork || '').trim();
        if (
          isAppOwned &&
          existingArtwork &&
          !isMediaStoreAlbumArtUri(existingArtwork)
        ) {
          mapped.artwork = existingArtwork;
        }
        mediaSongs.push(mapped);
      }
    });
    await this.hydrateLibraryStoreFromDisk();
    const enabledSourceCount = fileSources.filter(
      source => source?.on !== false,
    ).length;
    const existingMediaCount = existingLibrary.filter(song =>
      this.isLikelyMediaStoreSong(song),
    ).length;
    if (
      filteredRows.length === 0 &&
      enabledSourceCount > 0 &&
      existingMediaCount > 0 &&
      options.allowEmpty !== true
    ) {
      const failedAt = Date.now();
      const folderHash = this.buildMediaStoreFileSourceHash(fileSources);
      await this.saveMediaStoreSyncMeta({
        provider,
        folderHash,
        schemaVersion: MEDIASTORE_SYNC_SCHEMA_VERSION,
        status: 'failed',
        failedAt,
        reason: 'unexpected-empty',
        totalRows: rows.length,
        totalFilteredRows: filteredRows.length,
      });
      if (settings?.mediaStoreObserverEnabled !== false) {
        this.startMediaStoreObservation().catch(() => {});
      }
      return {
        status: 'unexpected-empty',
        provider: 'media_store',
        scannedSources: enabledSourceCount,
        totalFiles: existingLibrary.length,
        processedCount: 0,
        importedCount: 0,
        removedCount: 0,
        skippedCount: 0,
        errorCount: 1,
        removedSongIds: [],
        removedPathKeys: [],
        fileSources,
        lastSyncedAt: failedAt,
        reason: 'unexpected-empty',
      };
    }
    const enabledSourceRoots = fileSources
      .filter(source => source?.on !== false)
      .map(source => this.toNormalizedPathKey(source?.path || ''))
      .filter(Boolean);

    const existingMediaIds = new Set(
      existingLibrary
        .map(song => normalizeMediaStoreId(song?.mediaStoreId))
        .filter(Boolean),
    );
    const nextMediaIds = new Set(
      mediaSongs.map(song => normalizeMediaStoreId(song?.mediaStoreId)),
    );

    const existingSongById = new Map();
    existingLibrary.forEach(song => {
      const songId = String(song?.id || '').trim();
      if (songId) {
        existingSongById.set(songId, song);
      }
    });

    const removeIds = [];
    existingLibrary.forEach(song => {
      const songId = String(song?.id || '').trim();
      if (!songId) {
        return;
      }

      const songMediaStoreId = normalizeMediaStoreId(song?.mediaStoreId);
      const likelyMediaStoreSong =
        this.isLikelyMediaStoreSong(song) || Boolean(songMediaStoreId);
      if (likelyMediaStoreSong) {
        if (!songMediaStoreId || !nextMediaIds.has(songMediaStoreId)) {
          removeIds.push(songId);
        }
        return;
      }

      const pathKey = this.getSongPathKeyForStore(song);
      if (pathKey && this.isPathUnderRoots(pathKey, enabledSourceRoots)) {
        removeIds.push(songId);
      }
    });
    const uniqueRemoveIds = Array.from(new Set(removeIds));
    const removedPathKeys = uniqueRemoveIds
      .map(songId => this.getSongPathKeyForStore(existingSongById.get(songId)))
      .filter(Boolean);

    const removedCount = uniqueRemoveIds.length;
    const addedCount = mediaSongs.filter(
      song => !existingMediaIds.has(normalizeMediaStoreId(song?.mediaStoreId)),
    ).length;
    const processedCount = mediaSongs.length;

    let changed = false;
    if (uniqueRemoveIds.length > 0) {
      const removeSummary = this.libraryStore.removeBatch(uniqueRemoveIds, {
        markDirty: mediaSongs.length === 0,
        emit: false,
      });
      changed = changed || removeSummary.changed;
    }
    if (mediaSongs.length > 0) {
      const upsertSummary = this.libraryStore.upsertBatch(mediaSongs, {
        markDirty: true,
        emit: false,
      });
      changed = changed || upsertSummary.changed;
    }
    if (changed) {
      this.libraryStore.emit();
      this.setLibraryCache(this.getLibraryStoreSnapshot(), {syncStore: false});
    }

    const nextSources = await this.updateFileSourceCountsFromMediaStore(
      sourceByMediaStoreId,
      fileSources,
    );

    const lastSyncedAt = Date.now();
    const folderHash = this.buildMediaStoreFileSourceHash(fileSources);
    await AsyncStorage.setItem(STORAGE_KEYS.LAST_LIBRARY_SYNC_AT, `${lastSyncedAt}`);
    await this.saveMediaStoreSyncMeta({
      provider,
      folderHash,
      schemaVersion: MEDIASTORE_SYNC_SCHEMA_VERSION,
      lastSyncedAt,
      status: 'success',
      totalRows: rows.length,
      totalFilteredRows: mediaSongs.length,
    });
    await this.onMediaStoreSyncSuccess();
    await this.migratePlaylistsToMediaStoreIdsOnce();
    await this.retryUnresolvedPlaylistEntriesFromLibrary();
    if (settings?.mediaStoreObserverEnabled !== false) {
      this.startMediaStoreObservation().catch(() => {});
    }

    return {
      status: 'success',
      provider: 'media_store',
      scannedSources: fileSources.filter(source => source?.on !== false).length,
      totalFiles: mediaSongs.length,
      processedCount,
      importedCount: addedCount,
      removedCount,
      skippedCount: Math.max(0, rows.length - mediaSongs.length),
      errorCount: 0,
      removedSongIds: uniqueRemoveIds,
      removedPathKeys,
      fileSources: nextSources,
      lastSyncedAt,
      affectedSongIds: Array.from(
        new Set([
          ...mediaSongs.map(song => song.id),
          ...uniqueRemoveIds,
        ]),
      ),
    };
  },

  async refreshLibraryFromMediaStore(options = {}) {
    return this.syncLibraryFromMediaStore({
      ...options,
      forceRefresh: true,
      launchSync: false,
      skipGuardChecks: true,
    });
  },

  async startMediaStoreObservation() {
    if (Platform.OS !== 'android') {
      return false;
    }
    if (this.mediaStoreObserverUnsubscribe) {
      return true;
    }
    if (!(await this.shouldUseMediaStoreProvider())) {
      return false;
    }
    const settings = await this.getSettings();
    if (settings?.mediaStoreObserverEnabled === false) {
      return false;
    }

    MediaStoreBridge.startObserver();
    this.mediaStoreObserverUnsubscribe = MediaStoreBridge.subscribeToChanges(
      () => {
        if (this.mediaStoreObserverDebounceTimer) {
          clearTimeout(this.mediaStoreObserverDebounceTimer);
        }
        this.mediaStoreObserverDebounceTimer = setTimeout(() => {
          this.mediaStoreObserverDebounceTimer = null;
          this.runLibrarySyncInBackground({
            promptForPermission: false,
            readEmbeddedTextMetadata: false,
            recursive: true,
            launchSync: false,
            forceRefresh: true,
            origin: 'mediastore-observer',
          }).catch(() => {});
        }, MEDIASTORE_OBSERVER_DEBOUNCE_MS);
      },
    );
    return true;
  },

  async stopMediaStoreObservation() {
    if (this.mediaStoreObserverDebounceTimer) {
      clearTimeout(this.mediaStoreObserverDebounceTimer);
      this.mediaStoreObserverDebounceTimer = null;
    }
    if (this.mediaStoreObserverUnsubscribe) {
      try {
        this.mediaStoreObserverUnsubscribe();
      } catch (error) {
        // Ignore.
      }
      this.mediaStoreObserverUnsubscribe = null;
    }
    MediaStoreBridge.stopObserver();
  },

  async reconcileLocalSongWithMediaStore(localSong, options = {}) {
    if (!(await this.shouldUseMediaStoreProvider())) {
      return null;
    }

    const localPath = this.resolveSongLocalPath(localSong);
    if (!localPath) {
      return null;
    }

    await this.scanMediaStorePaths([localPath]);
    let row = await MediaStoreBridge.queryByPath(localPath);
    if (!row) {
      await sleep(MEDIASTORE_QUERY_PATH_RETRY_MS);
      row = await MediaStoreBridge.queryByPath(localPath);
    }
    if (!row) {
      return null;
    }

    const settings = await this.getSettings();
    const fileSources = await this.getFileSources();
    const selectedOnly = settings?.mediaStoreSelectedFoldersOnly !== false;
    const filtered = this.filterMediaStoreRowsBySources([row], fileSources, {
      selectedOnly,
    });
    if (selectedOnly && filtered.rows.length === 0) {
      return null;
    }
    const sourceMatch = filtered.sourceByMediaStoreId.get(
      normalizeMediaStoreId(row?.mediaStoreId || row?.id),
    );
    const song = this.mapMediaStoreRowToSong(row, {
      sourcePath: sourceMatch?.sourcePath || this.inferSourcePathFromSong(localSong),
      isAppOwned: true,
    });
    if (!song) {
      return null;
    }
    const mergedSong = this.mergeSongRecords(song, {
      ...(localSong || {}),
      id: song.id,
      mediaStoreId: song.mediaStoreId,
      provider: 'media_store',
      contentUri: song.contentUri,
      url: song.contentUri,
      localPath: song.localPath || localPath,
      absolutePath: song.absolutePath || localPath,
      isAppOwned: true,
    });

    await this.addToLibrary(mergedSong);
    return mergedSong;
  },
};
