import RNFS from 'react-native-fs';
import {artworkMethods} from './modules/artwork.methods';
import {filesystemMethods} from './modules/filesystem.methods';
import {libraryMethods} from './modules/library.methods';
import {playlistMethods} from './modules/playlist.methods';
import {settingsMethods} from './modules/settings.methods';

class StorageService {
  constructor() {
    this.musicDir = `${RNFS.DocumentDirectoryPath}/Music`;
    this.rhythmBladeDir = this.getPreferredMusicDir();
    this.artworkHydrationTasks = new Map();
    this.artworkMigrationTask = null;
    this.durationHydrationTasks = new Map();
    this.durationMigrationTask = null;
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
    this.initializeDirectories();
  }

  getLibrarySyncState() {
    return {...this.librarySyncState};
  }

  subscribeToLibrarySync(listener) {
    if (typeof listener !== 'function') {
      return () => {};
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
        const summary = await this.syncEnabledFileSourcesToLibrary(options);
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
  playlistMethods,
  settingsMethods,
);

export default new StorageService();
