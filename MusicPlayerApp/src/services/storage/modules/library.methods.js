import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import {optimizeArtworkUriForTrack} from '../../artwork/ArtworkService';
import {
  canExtractEmbeddedDuration,
  extractEmbeddedDurationSeconds,
} from '../../metadata/DurationService';
import {
  canExtractEmbeddedTextMetadata,
  extractEmbeddedTextMetadata,
} from '../../metadata/TextMetadataService';
import {DEFAULT_AUDIO_EXTENSION, STORAGE_KEYS} from '../storage.constants';
import {
  getExtensionFromSong,
  getFileNameFromUriOrPath,
  isUnknownValue,
  parseMetadataFromFilename,
  sanitizeFileSegment,
  toFileUriFromPath,
  toPathFromUri,
} from '../storage.helpers';

const MAX_ARTWORK_MIGRATIONS_PER_READ = 2;
const MAX_TEXT_METADATA_MIGRATIONS_PER_READ = 4;
const DEFAULT_DURATION_MIGRATION_BATCH_SIZE = 10;

function resolveMetadataField(candidate, fallback) {
  const text = String(candidate || '').trim();
  if (!text || isUnknownValue(text)) {
    return String(fallback || '').trim();
  }
  return text;
}

function isLikelyNoisyMetadata(value) {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }

  return (
    text.includes('•') ||
    /(?:hi-res|cd|aac|flac|khz|bit\/)/i.test(text) ||
    text.split(/\s+/).length > 16
  );
}

export const libraryMethods = {
  async getLocalLibrary() {
    try {
      const library = await AsyncStorage.getItem(STORAGE_KEYS.LIBRARY);
      const parsedLibrary = library ? JSON.parse(library) : [];
      let changed = false;
      let artworkMigrations = 0;
      let textMetadataMigrations = 0;

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

        const shouldAttemptTextMetadata =
          textMetadataMigrations < MAX_TEXT_METADATA_MIGRATIONS_PER_READ &&
          canExtractEmbeddedTextMetadata(nextSong) &&
          (isUnknownValue(nextSong?.title) ||
            isUnknownValue(nextSong?.artist) ||
            isUnknownValue(nextSong?.album) ||
            isLikelyNoisyMetadata(nextSong?.title) ||
            isLikelyNoisyMetadata(nextSong?.artist) ||
            isLikelyNoisyMetadata(nextSong?.album));

        if (shouldAttemptTextMetadata) {
          const embeddedTextMetadata = await extractEmbeddedTextMetadata(nextSong);
          const embeddedTitle = resolveMetadataField(
            embeddedTextMetadata?.title,
            nextSong?.title,
          );
          const embeddedArtist = resolveMetadataField(
            embeddedTextMetadata?.artist,
            nextSong?.artist,
          );
          const embeddedAlbum = resolveMetadataField(
            embeddedTextMetadata?.album,
            nextSong?.album,
          );

          if (
            embeddedTitle !== nextSong?.title ||
            embeddedArtist !== nextSong?.artist ||
            embeddedAlbum !== nextSong?.album
          ) {
            textMetadataMigrations += 1;
            changed = true;
            nextSong = {
              ...nextSong,
              title: embeddedTitle,
              artist: embeddedArtist,
              album: embeddedAlbum,
            };
          }
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
            const nextUrl = toFileUriFromPath(originalPath);
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

        const resolvedLocalPath = this.resolveSongLocalPath(nextSong);
        if (resolvedLocalPath) {
          const expectedUrl = toFileUriFromPath(resolvedLocalPath);
          if (
            expectedUrl &&
            (nextSong.localPath !== resolvedLocalPath ||
              String(nextSong.url || '').trim() !== expectedUrl)
          ) {
            changed = true;
            nextSong = {
              ...nextSong,
              localPath: resolvedLocalPath,
              url: expectedUrl,
            };
          }
        }

        const rawDuration = nextSong?.duration;
        const normalizedDuration = Number(rawDuration) || 0;
        if (rawDuration !== normalizedDuration) {
          changed = true;
          nextSong = {
            ...nextSong,
            duration: normalizedDuration,
          };
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

  async persistDurationForSong(song, durationSeconds) {
    const duration = Math.max(0, Math.round(Number(durationSeconds) || 0));
    if (!song || duration <= 0) {
      return false;
    }

    try {
      const rawLibrary = await AsyncStorage.getItem(STORAGE_KEYS.LIBRARY);
      const library = rawLibrary ? JSON.parse(rawLibrary) : [];
      const existing = this.findMatchingLibrarySong(library, song);
      if (!existing) {
        return false;
      }

      const currentDuration = Number(existing?.duration) || 0;
      if (currentDuration > 0 && Math.abs(currentDuration - duration) <= 1) {
        return false;
      }

      const nextLibrary = library.map(item =>
        item === existing || item.id === existing.id
          ? {...item, duration}
          : item,
      );
      await AsyncStorage.setItem(
        STORAGE_KEYS.LIBRARY,
        JSON.stringify(nextLibrary),
      );
      return true;
    } catch (error) {
      console.error('Error persisting duration for song:', error);
      return false;
    }
  },

  async hydrateDurationForSong(song, options = {}) {
    const {persist = true} = options;
    const existingDuration = Number(song?.duration) || 0;
    if (existingDuration > 0) {
      return existingDuration;
    }

    const filePath = this.resolveSongLocalPath(song);
    if (!filePath || !canExtractEmbeddedDuration(filePath)) {
      return 0;
    }

    const key =
      this.getArtworkHydrationKey(song) || `duration:path:${filePath}`;
    const inFlight = this.durationHydrationTasks.get(key);
    if (inFlight) {
      return inFlight;
    }

    const task = (async () => {
      const duration = await extractEmbeddedDurationSeconds(filePath);
      if (!duration) {
        return 0;
      }

      if (persist) {
        await this.persistDurationForSong(song, duration);
      }

      return duration;
    })()
      .catch(error => {
        console.error('Error hydrating duration for song:', error);
        return 0;
      })
      .finally(() => {
        this.durationHydrationTasks.delete(key);
      });

    this.durationHydrationTasks.set(key, task);
    return task;
  },

  async hydrateDurationForLibrary(librarySongs = [], maxSongs = 6) {
    if (!Array.isArray(librarySongs) || librarySongs.length === 0) {
      return [];
    }

    const candidates = librarySongs
      .filter(song => {
        const duration = Number(song?.duration) || 0;
        if (duration > 0) {
          return false;
        }
        const localPath = this.resolveSongLocalPath(song);
        return Boolean(localPath && canExtractEmbeddedDuration(localPath));
      })
      .slice(0, Math.max(0, maxSongs));

    if (candidates.length === 0) {
      return [];
    }

    let changed = false;
    for (const candidate of candidates) {
      const hydratedDuration = await this.hydrateDurationForSong(candidate, {
        persist: true,
      });
      if (hydratedDuration > 0) {
        changed = true;
      }

      // Yield between parsing tasks to keep UI responsive.
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (!changed) {
      return [];
    }

    return this.getLocalLibrary();
  },

  async migrateAllDurationsNow(options = {}) {
    if (this.durationMigrationTask) {
      return this.durationMigrationTask;
    }

    const {
      batchSize = DEFAULT_DURATION_MIGRATION_BATCH_SIZE,
      yieldMs = 0,
      onlySongIds = null,
    } = options;
    const effectiveBatchSize = Math.max(1, Number(batchSize) || 1);
    const effectiveYieldMs = Math.max(0, Number(yieldMs) || 0);
    const onlyIdsSet = Array.isArray(onlySongIds)
      ? new Set(onlySongIds.map(id => String(id || '').trim()).filter(Boolean))
      : null;

    const task = (async () => {
      const rawLibrary = await AsyncStorage.getItem(STORAGE_KEYS.LIBRARY);
      const library = rawLibrary ? JSON.parse(rawLibrary) : [];
      if (!Array.isArray(library) || library.length === 0) {
        return {
          totalSongs: 0,
          processedCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          errorCount: 0,
        };
      }

      const targets = library
        .map((song, index) => ({song, index}))
        .filter(({song}) => {
          const id = String(song?.id || '').trim();
          if (onlyIdsSet && !onlyIdsSet.has(id)) {
            return false;
          }

          const duration = Number(song?.duration) || 0;
          if (duration > 0) {
            return false;
          }

          const localPath = this.resolveSongLocalPath(song);
          return Boolean(localPath && canExtractEmbeddedDuration(localPath));
        });

      if (targets.length === 0) {
        return {
          totalSongs: library.length,
          processedCount: 0,
          updatedCount: 0,
          skippedCount: 0,
          errorCount: 0,
        };
      }

      let processedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      let changed = false;
      const nextLibrary = [...library];

      for (const {song, index} of targets) {
        processedCount += 1;
        try {
          const localPath = this.resolveSongLocalPath(song);
          const duration = await extractEmbeddedDurationSeconds(localPath);

          if (duration > 0) {
            nextLibrary[index] = {
              ...song,
              duration,
            };
            updatedCount += 1;
            changed = true;
          } else {
            skippedCount += 1;
          }
        } catch (error) {
          errorCount += 1;
        }

        if (processedCount % effectiveBatchSize === 0) {
          await new Promise(resolve => setTimeout(resolve, effectiveYieldMs));
        }
      }

      if (changed) {
        await AsyncStorage.setItem(
          STORAGE_KEYS.LIBRARY,
          JSON.stringify(nextLibrary),
        );
      }

      return {
        totalSongs: library.length,
        processedCount,
        updatedCount,
        skippedCount,
        errorCount,
      };
    })().finally(() => {
      this.durationMigrationTask = null;
    });

    this.durationMigrationTask = task;
    return task;
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
      const extractedDuration = await extractEmbeddedDurationSeconds(destPath);

      const updatedSong = {
        ...song,
        id: Date.now().toString(),
        url: toFileUriFromPath(destPath),
        localPath: destPath,
        duration: Number(song?.duration) || extractedDuration,
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
      const embeddedTextMetadata = canExtractEmbeddedTextMetadata(
        incomingFilePath,
      )
        ? await extractEmbeddedTextMetadata(incomingFilePath)
        : null;
      const resolvedFromFile = {
        title: resolveMetadataField(
          embeddedTextMetadata?.title,
          incomingSong.title,
        ),
        artist: resolveMetadataField(
          embeddedTextMetadata?.artist,
          incomingSong.artist,
        ),
        album: resolveMetadataField(
          embeddedTextMetadata?.album,
          incomingSong.album || '',
        ),
      };
      const extractedDuration = await this.hydrateDurationForSong(
        incomingSong,
        {
          persist: false,
        },
      );
      const reusedSong = {
        ...incomingSong,
        ...resolvedFromFile,
        localPath: incomingFilePath,
        url: toFileUriFromPath(incomingFilePath),
        duration: extractedDuration || Number(incomingSong.duration) || 0,
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
      const mergedDuration = await this.hydrateDurationForSong(merged, {
        persist: false,
      });
      if (mergedDuration > 0) {
        merged.duration = mergedDuration;
      }
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
        url: toFileUriFromPath(preferredPath),
        duration:
          (await extractEmbeddedDurationSeconds(preferredPath)) ||
          Number(incomingSong.duration) ||
          0,
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
      url: toFileUriFromPath(destPath),
      localPath: destPath,
      filename,
      isLocal: true,
    };
    const embeddedTextMetadata = canExtractEmbeddedTextMetadata(destPath)
      ? await extractEmbeddedTextMetadata(destPath)
      : null;
    localSong.title = resolveMetadataField(
      embeddedTextMetadata?.title,
      localSong.title,
    );
    localSong.artist = resolveMetadataField(
      embeddedTextMetadata?.artist,
      localSong.artist,
    );
    localSong.album = resolveMetadataField(
      embeddedTextMetadata?.album,
      localSong.album || '',
    );
    const extractedDuration = await this.hydrateDurationForSong(localSong, {
      persist: false,
    });
    if (extractedDuration > 0) {
      localSong.duration = extractedDuration;
    }

    await this.addToLibrary(localSong);
    this.hydrateArtworkForSong(localSong, {persist: true}).catch(() => {});
    return localSong;
  },

  async importLocalAudioFile(file, options = {}) {
    const {skipArtworkHydration = false, skipDurationHydration = false} =
      options;
    try {
      const sourceUri = file?.fileCopyUri || file?.uri;
      if (!sourceUri) {
        throw new Error('Invalid file selected');
      }

      const usesContentUri =
        sourceUri.startsWith('content://') && !file.fileCopyUri;
      const initialPath = usesContentUri ? '' : toPathFromUri(sourceUri);
      let resolvedPath = initialPath;
      let resolvedUrl = usesContentUri
        ? sourceUri
        : toFileUriFromPath(initialPath);

      if (usesContentUri) {
        const originalPath = await this.resolveContentUriToFilePath(
          sourceUri,
          file?.name || '',
          true,
        );
        if (originalPath) {
          resolvedPath = originalPath;
          resolvedUrl = toFileUriFromPath(originalPath);
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
      let extractedDuration = 0;
      if (!skipDurationHydration && resolvedPath) {
        extractedDuration = await extractEmbeddedDurationSeconds(resolvedPath);
      }
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
        duration: extractedDuration || 0,
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
