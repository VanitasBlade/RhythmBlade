import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import {extractEmbeddedArtworkDataUri} from '../../artwork/ArtworkService';
import {STORAGE_KEYS} from '../storage.constants';
import {isUnknownValue, normalizeText, toPathFromUri} from '../storage.helpers';

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
    if (effectivePath) {
      merged.localPath = effectivePath;
      merged.url = `file://${effectivePath}`;
      merged.isLocal = true;
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
    const normalizedArtwork = String(artwork || '').trim();
    if (!song || !normalizedArtwork) {
      return false;
    }

    try {
      const rawLibrary = await AsyncStorage.getItem(STORAGE_KEYS.LIBRARY);
      const library = rawLibrary ? JSON.parse(rawLibrary) : [];
      const existing = this.findMatchingLibrarySong(library, song);
      if (!existing || existing.artwork === normalizedArtwork) {
        return false;
      }

      const nextLibrary = library.map(item =>
        item === existing || item.id === existing.id
          ? {...item, artwork: normalizedArtwork}
          : item,
      );
      await AsyncStorage.setItem(
        STORAGE_KEYS.LIBRARY,
        JSON.stringify(nextLibrary),
      );
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
    if (!filePath || !/\.flac$/i.test(filePath)) {
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
        url: `file://${filePath}`,
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

  async hydrateArtworkForLibrary(librarySongs = [], maxSongs = 6) {
    if (!Array.isArray(librarySongs) || librarySongs.length === 0) {
      return [];
    }

    const candidates = librarySongs
      .filter(song => {
        if (song?.artwork) {
          return false;
        }
        const localPath = this.resolveSongLocalPath(song);
        return Boolean(localPath && /\.flac$/i.test(localPath));
      })
      .slice(0, Math.max(0, maxSongs));

    if (candidates.length === 0) {
      return [];
    }

    const hydrationResults = await Promise.all(
      candidates.map(candidate =>
        this.hydrateArtworkForSong(candidate, {persist: true}),
      ),
    );
    const changed = hydrationResults.some(Boolean);

    if (!changed) {
      return [];
    }

    return this.getLocalLibrary();
  },
};
