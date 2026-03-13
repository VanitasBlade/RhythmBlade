import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import RNFS from 'react-native-fs';
import LibraryStore from './LibraryStore';
import { artworkMethods } from './modules/artwork.methods';
import { filesystemMethods } from './modules/filesystem.methods';
import { libraryMethods } from './modules/library.methods';
import { mediaStoreMethods } from './modules/mediastore.methods';
import { playlistMethods } from './modules/playlist.methods';
import { settingsMethods } from './modules/settings.methods';
import { statsMethods } from './modules/stats.methods';
import { STORAGE_KEYS } from './storage.constants';

class StorageService {
  constructor() {
    this.musicDir = `${RNFS.DocumentDirectoryPath}/Music`;
    this.rhythmBladeDir = this.getPreferredMusicDir();
    this.libraryStore = new LibraryStore({
      flushDebounceMs: 3000,
      flushMaxWaitMs: 10000,
      getMediaStoreId: song => this.getSongMediaStoreId(song),
      getPathKey: song => this.getSongPathKeyForStore(song),
      getContentUri: song => this.getSongContentUri(song),
      onFlush: async snapshot => {
        await AsyncStorage.setItem(
          STORAGE_KEYS.LIBRARY,
          JSON.stringify(Array.isArray(snapshot) ? snapshot : []),
        );
        this.setLibraryCache(snapshot, { syncStore: false });
      },
      onError: error => {
        console.error('LibraryStore flush failed:', error);
      },
    });
    this.libraryStoreHydrated = false;
    this.libraryStoreHydrationTask = null;
    this.libraryCache = null;
    this.libraryCacheUpdatedAt = 0;
    this.libraryReadTask = null;
    this.artworkHydrationTasks = new Map();
    this.durationHydrationTasks = new Map();
    this.librarySyncListeners = new Set();
    this.librarySyncTask = null;
    this.librarySyncState = {
      isRunning: false,
      startedAt: 0,
      completedAt: 0,
      lastSyncedAt: 0,
      error: null,
      summary: null,
    };
    this.mediaStoreSupportCache = null;
    this.mediaStoreSessionFallback = false;
    this.mediaStoreSessionFallbackReason = '';
    this.mediaStoreObserverUnsubscribe = null;
    this.mediaStoreObserverDebounceTimer = null;
    this.appStateSubscription = AppState?.addEventListener
      ? AppState.addEventListener('change', nextState => {
        if (nextState !== 'active') {
          this.flushLibraryStoreNow('app-state').catch(() => { });
        }
      })
      : null;
    this.initializeDirectories();
  }

  setLibraryCache(librarySongs = [], options = {}) {
    const syncStore = options?.syncStore !== false;
    this.libraryCache = Array.isArray(librarySongs)
      ? librarySongs.filter(Boolean)
      : [];
    this.libraryCacheUpdatedAt = Date.now();
    if (syncStore && this.libraryStore) {
      this.libraryStore.hydrateFromSnapshot(this.libraryCache, { emit: false });
      this.libraryStoreHydrated = true;
    }
    return this.libraryCache;
  }

  getLibraryCacheAgeMs() {
    if (!this.libraryCacheUpdatedAt) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(0, Date.now() - this.libraryCacheUpdatedAt);
  }

  clearLibraryCache(options = {}) {
    this.libraryCache = null;
    this.libraryCacheUpdatedAt = 0;
    if (options?.clearStore === true && this.libraryStore) {
      this.libraryStore.replaceAll([], {
        markDirty: false,
        emit: false,
      });
      this.libraryStoreHydrated = false;
    }
  }

  async hydrateLibraryStoreFromDisk(options = {}) {
    const forceRefresh = options?.forceRefresh === true;
    if (!forceRefresh && this.libraryStoreHydrated) {
      return this.libraryStore.getAll();
    }

    if (!forceRefresh && this.libraryStoreHydrationTask) {
      return this.libraryStoreHydrationTask;
    }

    const task = (async () => {
      try {
        const rawLibrary = await AsyncStorage.getItem(STORAGE_KEYS.LIBRARY);
        const parsedLibrary = rawLibrary ? JSON.parse(rawLibrary) : [];
        const normalized = Array.isArray(parsedLibrary)
          ? parsedLibrary.filter(Boolean)
          : [];
        this.libraryStore.hydrateFromSnapshot(normalized, { emit: false });
        this.libraryStoreHydrated = true;
        this.setLibraryCache(normalized, { syncStore: false });
        return normalized;
      } catch (error) {
        console.error('Failed to hydrate library store:', error);
        this.libraryStore.hydrateFromSnapshot([], { emit: false });
        this.libraryStoreHydrated = true;
        this.setLibraryCache([], { syncStore: false });
        return [];
      }
    })();

    if (!forceRefresh) {
      this.libraryStoreHydrationTask = task;
    }

    try {
      return await task;
    } finally {
      if (this.libraryStoreHydrationTask === task) {
        this.libraryStoreHydrationTask = null;
      }
    }
  }

  getLibraryStoreSnapshot() {
    return this.libraryStore.getAll();
  }

  async flushLibraryStoreNow(reason = 'manual') {
    if (!this.libraryStore) {
      return false;
    }
    return this.libraryStore.flushNow(reason);
  }

  async cleanup() {
    try {
      await this.stopMediaStoreObservation();
    } catch (error) {
      // Ignore observer stop errors.
    }
    try {
      await this.flushLibraryStoreNow('cleanup');
    } catch (error) {
      // Ignore flush errors.
    }
    try {
      if (this.appStateSubscription?.remove) {
        this.appStateSubscription.remove();
      }
    } catch (error) {
      // Ignore subscription cleanup errors.
    }
  }

  getLibrarySyncState() {
    return { ...this.librarySyncState };
  }

  subscribeToLibrarySync(listener) {
    if (typeof listener !== 'function') {
      return () => { };
    }

    this.librarySyncListeners.add(listener);
    try {
      listener(this.getLibrarySyncState());
    } catch (error) {
      // Ignore listener errors.
    }

    return () => {
      this.librarySyncListeners.delete(listener);
    };
  }

  emitLibrarySyncState() {
    const snapshot = this.getLibrarySyncState();
    this.librarySyncListeners.forEach(listener => {
      try {
        listener(snapshot);
      } catch (error) {
        // Ignore listener errors.
      }
    });
  }

  setLibrarySyncState(patch = {}) {
    this.librarySyncState = {
      ...this.librarySyncState,
      ...patch,
    };
    this.emitLibrarySyncState();
  }

  async runLibrarySyncInBackground(options = {}) {
    if (this.librarySyncTask) {
      return this.librarySyncTask;
    }

    this.setLibrarySyncState({
      isRunning: true,
      startedAt: Date.now(),
      error: null,
    });

    const task = (async () => {
      try {
        const provider = await this.getLibraryProvider();
        const canUseMediaStore =
          this.isMediaStoreProvider(provider) &&
          (await this.shouldUseMediaStoreProvider({ provider }));
        let summary = null;

        if (!canUseMediaStore) {
          await this.hydrateLibraryStoreFromDisk();
          summary = {
            status: 'skipped',
            provider: 'media_store',
            reason: this.mediaStoreSessionFallback
              ? 'session-fallback'
              : 'provider-unavailable',
            totalFiles: this.getLibraryStoreSnapshot().length,
            importedCount: 0,
            removedCount: 0,
            skippedCount: 0,
            errorCount: 0,
            removedSongIds: [],
            removedPathKeys: [],
            lastSyncedAt: Date.now(),
          };
        } else {
          try {
            summary = await this.syncLibraryFromMediaStore(options);
          } catch (error) {
            await this.onMediaStoreSyncFailure(error, options);
            throw error;
          }

          if (
            summary?.status === 'unexpected-empty' &&
            options.launchSync === true
          ) {
            await this.onMediaStoreSyncFailure(
              new Error('MediaStore returned an unexpected empty library result'),
              options,
            );
          }
        }

        this.setLibrarySyncState({
          isRunning: false,
          completedAt: Date.now(),
          lastSyncedAt: Number(summary?.lastSyncedAt) || Date.now(),
          summary: summary || null,
          error: null,
        });
        return summary;
      } catch (error) {
        this.setLibrarySyncState({
          isRunning: false,
          completedAt: Date.now(),
          error: String(error?.message || error),
        });
        throw error;
      } finally {
        this.librarySyncTask = null;
      }
    })();

    this.librarySyncTask = task;
    return task;
  }
}

Object.assign(
  StorageService.prototype,
  artworkMethods,
  filesystemMethods,
  libraryMethods,
  mediaStoreMethods,
  playlistMethods,
  settingsMethods,
  statsMethods,
);

export default new StorageService();
