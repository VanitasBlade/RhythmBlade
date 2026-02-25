import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import {optimizeArtworkUriForTrack} from '../../artwork/ArtworkService';
import {DEFAULT_AUDIO_EXTENSION, STORAGE_KEYS} from '../storage.constants';
import {
  getExtensionFromSong,
  getFileNameFromUriOrPath,
  isUnknownValue,
  parseMetadataFromFilename,
  sanitizeFileSegment,
  toPathFromUri,
} from '../storage.helpers';

const MAX_ARTWORK_MIGRATIONS_PER_READ = 2;

export const libraryMethods = {
  async getLocalLibrary() {
    try {
      const library = await AsyncStorage.getItem(STORAGE_KEYS.LIBRARY);
      const parsedLibrary = library ? JSON.parse(library) : [];
      let changed = false;
      let artworkMigrations = 0;

      const normalizedLibrary = [];
      for (const song of parsedLibrary) {
        let nextSong = song;
        const sourceName =
          song?.filename ||
          String(song?.localPath || '')
            .split('/')
            .pop();
        const inferred = parseMetadataFromFilename(sourceName);

        const nextArtist = isUnknownValue(song?.artist)
          ? inferred.artist || song?.artist
          : song?.artist;
        const nextTitle = isUnknownValue(song?.title)
          ? inferred.title || song?.title
          : song?.title;

        if (nextArtist !== nextSong?.artist || nextTitle !== nextSong?.title) {
          changed = true;
          nextSong = {
            ...nextSong,
            artist: nextArtist,
            title: nextTitle,
          };
        }

        const currentArtwork = String(nextSong?.artwork || '').trim();
        if (
          currentArtwork.toLowerCase().startsWith('data:image/') &&
          artworkMigrations < MAX_ARTWORK_MIGRATIONS_PER_READ
        ) {
          const optimizedArtwork = await optimizeArtworkUriForTrack(
            nextSong,
            currentArtwork,
          );

          if (optimizedArtwork && optimizedArtwork !== currentArtwork) {
            artworkMigrations += 1;
            changed = true;
            nextSong = {
              ...nextSong,
              artwork: optimizedArtwork,
            };
          }
        }

        const currentUrl = String(nextSong?.url || '').trim();
        const currentLocalPath = String(nextSong?.localPath || '').trim();
        const needsPathResolve =
          currentUrl.startsWith('content://') ||
          currentLocalPath.startsWith('content://');

        if (needsPathResolve) {
          const contentUri = currentUrl.startsWith('content://')
            ? currentUrl
            : currentLocalPath;
          const originalPath = await this.resolveContentUriToFilePath(
            contentUri,
            sourceName,
            false,
          );

          if (originalPath) {
            const nextUrl = `file://${originalPath}`;
            if (nextSong.localPath !== originalPath || currentUrl !== nextUrl) {
              changed = true;
              nextSong = {
                ...nextSong,
                localPath: originalPath,
                url: nextUrl,
              };
            }
          }
        }

        normalizedLibrary.push(nextSong);
      }

      if (changed) {
        await AsyncStorage.setItem(
          STORAGE_KEYS.LIBRARY,
          JSON.stringify(normalizedLibrary),
        );
      }

      return normalizedLibrary;
    } catch (error) {
      console.error('Error getting library:', error);
      return [];
    }
  },

  async addToLibrary(song) {
    try {
      const library = await this.getLocalLibrary();
      const incoming = {
        ...song,
        addedAt: song?.addedAt || Date.now(),
      };
      const existing = this.findMatchingLibrarySong(library, incoming);

      if (existing) {
        const nextEntry = this.mergeSongRecords(existing, incoming);
        const nextLibrary = library.map(item =>
          item === existing || item.id === existing.id ? nextEntry : item,
        );
        await AsyncStorage.setItem(
          STORAGE_KEYS.LIBRARY,
          JSON.stringify(nextLibrary),
        );
        console.log('Song updated in library:', nextEntry.title);
        return nextLibrary;
      }

      library.push(incoming);
      await AsyncStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify(library));
      console.log('Song added to library:', incoming.title);
      return library;
    } catch (error) {
      console.error('Error adding to library:', error);
      return [];
    }
  },

  async removeFromLibrary(songId) {
    try {
      const library = await this.getLocalLibrary();
      const filtered = library.filter(song => song.id !== songId);
      await AsyncStorage.setItem(
        STORAGE_KEYS.LIBRARY,
        JSON.stringify(filtered),
      );
      console.log('Song removed from library');
      return filtered;
    } catch (error) {
      console.error('Error removing from library:', error);
      return [];
    }
  },

  async getAlbums() {
    try {
      const library = await this.getLocalLibrary();
      const albumMap = {};

      library.forEach(song => {
        if (song.album) {
          if (!albumMap[song.album]) {
            albumMap[song.album] = {
              name: song.album,
              artist: song.artist,
              songs: [],
              artwork: song.artwork,
            };
          }
          albumMap[song.album].songs.push(song);
        }
      });

      return Object.values(albumMap);
    } catch (error) {
      console.error('Error getting albums:', error);
      return [];
    }
  },

  async saveSongLocally(song, filepath) {
    try {
      const dir = await this.getWritableMusicDir();
      const filename = `${Date.now()}_${song.title.replace(
        /[^a-z0-9]/gi,
        '_',
      )}.flac`;
      const destPath = `${dir}/${filename}`;

      await RNFS.copyFile(filepath, destPath);

      const updatedSong = {
        ...song,
        id: Date.now().toString(),
        url: `file://${destPath}`,
        localPath: destPath,
        isLocal: true,
      };

      await this.addToLibrary(updatedSong);
      console.log('Song saved locally:', filename);
      return updatedSong;
    } catch (error) {
      console.error('Error saving song locally:', error);
      return null;
    }
  },

  async saveRemoteSongToDevice(song) {
    if (!song?.url) {
      throw new Error('Invalid song URL');
    }

    const sourceMeta = parseMetadataFromFilename(song.filename);
    const resolvedArtist = isUnknownValue(song.artist)
      ? sourceMeta.artist || 'Unknown Artist'
      : song.artist;
    const resolvedTitle = isUnknownValue(song.title)
      ? sourceMeta.title || 'Track'
      : song.title;

    const incomingSong = {
      ...song,
      id: song.id || `local_${Date.now()}`,
      sourceSongId: song.id || null,
      sourceFilename: song.filename || null,
      title: resolvedTitle,
      artist: resolvedArtist,
      isLocal: true,
    };

    const incomingFilePath = this.resolveSongLocalPath(incomingSong);
    const incomingIsFileUri = String(song.url).startsWith('file://');
    if (
      incomingIsFileUri &&
      incomingFilePath &&
      (await RNFS.exists(incomingFilePath))
    ) {
      const reusedSong = {
        ...incomingSong,
        localPath: incomingFilePath,
        url: `file://${incomingFilePath}`,
        filename:
          song.filename ||
          incomingFilePath.split('/').pop() ||
          `${resolvedTitle}${DEFAULT_AUDIO_EXTENSION}`,
      };
      await this.addToLibrary(reusedSong);
      this.hydrateArtworkForSong(reusedSong, {persist: true}).catch(() => {});
      return reusedSong;
    }

    const library = await this.getLocalLibrary();
    const existingMatch = this.findMatchingLibrarySong(library, incomingSong);
    if (existingMatch && (await this.songFileExists(existingMatch))) {
      const merged = this.mergeSongRecords(existingMatch, incomingSong);
      await this.addToLibrary(merged);
      this.hydrateArtworkForSong(merged, {persist: true}).catch(() => {});
      return merged;
    }

    const targetDir = await this.getWritableMusicDir();
    const baseName = sanitizeFileSegment(
      `${resolvedArtist} - ${resolvedTitle}`,
    );
    const safeName = baseName || `Track_${Date.now()}`;
    const extension = getExtensionFromSong(song);
    const preferredPath = `${targetDir}/${safeName}${extension}`;
    if (await RNFS.exists(preferredPath)) {
      const reusedSong = {
        ...incomingSong,
        localPath: preferredPath,
        url: `file://${preferredPath}`,
        filename: preferredPath.split('/').pop(),
      };
      await this.addToLibrary(reusedSong);
      this.hydrateArtworkForSong(reusedSong, {persist: true}).catch(() => {});
      return reusedSong;
    }

    const destPath = await this.ensureUniquePath(preferredPath);
    const filename = destPath.split('/').pop();

    const result = await RNFS.downloadFile({
      fromUrl: song.url,
      toFile: destPath,
      background: true,
      discretionary: true,
    }).promise;

    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`Download copy failed with status ${result.statusCode}`);
    }

    const localSong = {
      ...song,
      id: song.id || `local_${Date.now()}`,
      sourceSongId: song.id || null,
      sourceFilename: song.filename || filename,
      title: resolvedTitle,
      artist: resolvedArtist,
      url: `file://${destPath}`,
      localPath: destPath,
      filename,
      isLocal: true,
    };

    await this.addToLibrary(localSong);
    this.hydrateArtworkForSong(localSong, {persist: true}).catch(() => {});
    return localSong;
  },

  async importLocalAudioFile(file, options = {}) {
    const {skipArtworkHydration = false} = options;
    try {
      const sourceUri = file?.fileCopyUri || file?.uri;
      if (!sourceUri) {
        throw new Error('Invalid file selected');
      }

      const usesContentUri =
        sourceUri.startsWith('content://') && !file.fileCopyUri;
      const initialPath = usesContentUri ? '' : toPathFromUri(sourceUri);
      let resolvedPath = initialPath;
      let resolvedUrl = usesContentUri ? sourceUri : `file://${initialPath}`;

      if (usesContentUri) {
        const originalPath = await this.resolveContentUriToFilePath(
          sourceUri,
          file?.name || '',
          true,
        );
        if (originalPath) {
          resolvedPath = originalPath;
          resolvedUrl = `file://${originalPath}`;
        }
      }

      if (resolvedPath) {
        const sourceExists = await RNFS.exists(resolvedPath);
        if (!sourceExists) {
          throw new Error('Selected audio file is not accessible');
        }
      }

      const originalName =
        file.name ||
        getFileNameFromUriOrPath(sourceUri) ||
        `audio_${Date.now()}.flac`;

      const inferred = parseMetadataFromFilename(originalName);
      const track = {
        id: `local_${Date.now()}`,
        title:
          inferred.title ||
          originalName.replace(/\.[^/.]+$/, '') ||
          'Local Audio',
        artist: inferred.artist || 'Unknown Artist',
        album: '',
        url: resolvedUrl,
        localPath: resolvedPath,
        filename: originalName,
        sourceFilename: originalName,
        isLocal: true,
        addedAt: Date.now(),
      };

      const existing = this.findMatchingLibrarySong(
        await this.getLocalLibrary(),
        track,
      );
      const canReuseExisting =
        existing &&
        ((await this.songFileExists(existing)) ||
          String(existing?.url || '').startsWith('content://'));
      if (canReuseExisting) {
        const merged = this.mergeSongRecords(existing, track);
        await this.addToLibrary(merged);
        if (!skipArtworkHydration) {
          this.hydrateArtworkForSong(merged, {persist: true}).catch(() => {});
        }
        return merged;
      }

      await this.addToLibrary(track);
      if (!skipArtworkHydration) {
        this.hydrateArtworkForSong(track, {persist: true}).catch(() => {});
      }
      return track;
    } catch (error) {
      console.error('Error importing local audio file:', error);
      throw error;
    }
  },

  async deleteSongFile(song) {
    try {
      if (song.localPath) {
        const exists = await RNFS.exists(song.localPath);
        if (exists) {
          await RNFS.unlink(song.localPath);
          console.log('Song file deleted');
        }
      }
      await this.removeFromLibrary(song.id);
    } catch (error) {
      console.error('Error deleting song file:', error);
    }
  },
};
