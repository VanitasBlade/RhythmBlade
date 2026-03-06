import RNFS from 'react-native-fs';
import {
  canExtractEmbeddedArtwork,
  extractEmbeddedArtworkDataUri,
  optimizeArtworkUriForTrack,
} from '../../artwork/ArtworkService';
import {
  isUnknownValue,
  normalizeFileSourcePath,
  normalizeText,
  toFileUriFromPath,
  toPathFromUri,
} from '../storage.helpers';

export const artworkMethods = {
  resolveSongLocalPath(song) {
    if (!song || typeof song !== 'object') {
      return '';
    }
    const localPath = String(song.localPath || '').trim();
    if (localPath && !localPath.startsWith('content://')) {
      return toPathFromUri(localPath);
    }

    const url = String(song.url || '').trim();
    if (url.startsWith('file://')) {
      return toPathFromUri(url);
    }

    return '';
  },

  normalizeSourcePath(pathValue) {
    const rawPath = String(toPathFromUri(pathValue) || pathValue || '').trim();
    if (!rawPath || rawPath.startsWith('content://')) {
      return '';
    }

    const normalized = normalizeFileSourcePath(rawPath);
    if (!normalized) {
      return '';
    }

    return normalized.replace(/\/+$/g, '');
  },

  inferSourcePathFromSong(song, fallbackFilePath = '') {
    const explicitSourcePath = this.normalizeSourcePath(song?.sourcePath);
    if (explicitSourcePath) {
      return explicitSourcePath;
    }

    const localPath =
      this.resolveSongLocalPath(song) ||
      this.normalizeSourcePath(fallbackFilePath);
    if (!localPath) {
      return '';
    }

    const parentPath = localPath.replace(/\/[^/]+$/g, '');
    return parentPath || localPath;
  },

  async songFileExists(song) {
    const filePath = this.resolveSongLocalPath(song);
    if (!filePath) {
      return false;
    }
    try {
      return await RNFS.exists(filePath);
    } catch (error) {
      return false;
    }
  },

  canPromoteMetadata(currentValue, incomingValue) {
    const hasIncoming = normalizeText(incomingValue).length > 0;
    if (!hasIncoming) {
      return false;
    }
    return isUnknownValue(currentValue);
  },

  mergeSongRecords(existing, incoming) {
    const merged = {
      ...existing,
      ...incoming,
    };

    if (!this.canPromoteMetadata(existing?.title, incoming?.title)) {
      merged.title = existing?.title;
    }
    if (!this.canPromoteMetadata(existing?.artist, incoming?.artist)) {
      merged.artist = existing?.artist;
    }
    if (!this.canPromoteMetadata(existing?.album, incoming?.album)) {
      merged.album = existing?.album;
    }
    if (existing?.artwork && !incoming?.artwork) {
      merged.artwork = existing.artwork;
    }
    if (
      (Number(existing?.duration) || 0) > 0 &&
      (Number(incoming?.duration) || 0) <= 0
    ) {
      merged.duration = existing.duration;
    }

    const incomingPath = this.resolveSongLocalPath(incoming);
    const existingPath = this.resolveSongLocalPath(existing);
    const effectivePath = incomingPath || existingPath;
    const incomingContentUri = normalizeText(
      incoming?.contentUri ||
        (String(incoming?.url || '').startsWith('content://')
          ? incoming?.url
          : ''),
    );
    const existingContentUri = normalizeText(
      existing?.contentUri ||
        (String(existing?.url || '').startsWith('content://')
          ? existing?.url
          : ''),
    );
    const mergedMediaStoreId = String(
      incoming?.mediaStoreId || existing?.mediaStoreId || '',
    ).trim();
    const preferredContentUri =
      incomingContentUri ||
      existingContentUri ||
      (mergedMediaStoreId
        ? `content://media/external/audio/media/${mergedMediaStoreId}`
        : '');
    const mergedProvider = String(
      incoming?.provider || existing?.provider || '',
    )
      .trim()
      .toLowerCase();
    const isMediaStoreSong = Boolean(
      mergedProvider === 'media_store' ||
        mergedMediaStoreId ||
        preferredContentUri.startsWith('content://'),
    );

    if (effectivePath) {
      merged.localPath = effectivePath;
      merged.isLocal = true;
    }
    if (isMediaStoreSong && preferredContentUri.startsWith('content://')) {
      merged.url = preferredContentUri;
      merged.contentUri = preferredContentUri;
      if (mergedMediaStoreId) {
        merged.mediaStoreId = mergedMediaStoreId;
      }
      merged.provider = 'media_store';
    } else if (effectivePath) {
      merged.url = toFileUriFromPath(effectivePath);
    }
    const sourcePath =
      this.inferSourcePathFromSong(incoming, effectivePath) ||
      this.inferSourcePathFromSong(existing, existingPath);
    if (sourcePath) {
      merged.sourcePath = sourcePath;
    }

    merged.id = existing?.id || incoming?.id || `local_${Date.now()}`;
    merged.addedAt = existing?.addedAt || incoming?.addedAt || Date.now();
    return merged;
  },

  findMatchingLibrarySong(library = [], song = {}) {
    if (!Array.isArray(library) || !song) {
      return null;
    }

    const incomingPath = this.resolveSongLocalPath(song);
    const normalizedIncomingPath = normalizeText(incomingPath);
    const incomingId = String(song.id || '').trim();
    const incomingSourceId = String(song.sourceSongId || song.id || '').trim();
    const incomingFilename = normalizeText(
      song.sourceFilename || song.filename,
    );
    const incomingTitle = normalizeText(song.title);
    const incomingArtist = normalizeText(song.artist);

    const exact = library.find(item => {
      const existingPath = this.resolveSongLocalPath(item);
      const sameId = incomingId && String(item.id || '').trim() === incomingId;
      const sameSourceId =
        incomingSourceId &&
        String(item.sourceSongId || '').trim() === incomingSourceId;
      const samePath =
        normalizedIncomingPath &&
        existingPath &&
        normalizeText(existingPath) === normalizedIncomingPath;
      return sameId || sameSourceId || samePath;
    });
    if (exact) {
      return exact;
    }

    const fallback = library.find(item => {
      const titleMatch =
        incomingTitle && normalizeText(item.title) === incomingTitle;
      const artistMatch =
        incomingArtist && normalizeText(item.artist) === incomingArtist;
      const filenameMatch =
        incomingFilename &&
        normalizeText(item.sourceFilename || item.filename) ===
          incomingFilename;
      return (titleMatch && artistMatch) || filenameMatch;
    });

    return fallback || null;
  },

  getArtworkHydrationKey(song) {
    if (!song || typeof song !== 'object') {
      return '';
    }

    const id = String(song.id || '').trim();
    if (id) {
      return `id:${id}`;
    }

    const localPath = normalizeText(this.resolveSongLocalPath(song));
    if (localPath) {
      return `path:${localPath}`;
    }

    const url = normalizeText(song.url);
    if (url) {
      return `url:${url}`;
    }

    return '';
  },

  async persistArtworkForSong(song, artwork) {
    const optimizedArtwork = await optimizeArtworkUriForTrack(song, artwork);
    const normalizedArtwork = String(optimizedArtwork || '').trim();
    if (!song || !normalizedArtwork) {
      return false;
    }

    try {
      const library = await this.getLocalLibrary();
      const existing = this.findMatchingLibrarySong(library, song);
      if (!existing || existing.artwork === normalizedArtwork) {
        return false;
      }

      const nextLibrary = library.map(item =>
        item === existing || item.id === existing.id
          ? {...item, artwork: normalizedArtwork}
          : item,
      );
      await this.saveLibrarySnapshot(nextLibrary);
      return true;
    } catch (error) {
      console.error('Error persisting artwork for song:', error);
      return false;
    }
  },

  async hydrateArtworkForSong(song, options = {}) {
    const {persist = true} = options;
    const existingArtwork = String(song?.artwork || '').trim();
    if (existingArtwork) {
      return existingArtwork;
    }

    const filePath = this.resolveSongLocalPath(song);
    if (!filePath || !canExtractEmbeddedArtwork(filePath)) {
      return null;
    }

    const key =
      this.getArtworkHydrationKey(song) || `path:${normalizeText(filePath)}`;
    if (!key) {
      return null;
    }

    const inFlight = this.artworkHydrationTasks.get(key);
    if (inFlight) {
      return inFlight;
    }

    const task = (async () => {
      const artwork = await extractEmbeddedArtworkDataUri({
        ...song,
        localPath: filePath,
        url: toFileUriFromPath(filePath),
      });
      if (!artwork) {
        return null;
      }

      if (persist) {
        await this.persistArtworkForSong(song, artwork);
      }

      return artwork;
    })()
      .catch(error => {
        console.error('Error hydrating artwork for song:', error);
        return null;
      })
      .finally(() => {
        this.artworkHydrationTasks.delete(key);
      });

    this.artworkHydrationTasks.set(key, task);
    return task;
  },

};
