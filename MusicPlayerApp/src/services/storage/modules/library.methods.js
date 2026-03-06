import RNFS from 'react-native-fs';
import {
  canExtractEmbeddedArtwork,
  extractEmbeddedArtworkDataUri,
} from '../../artwork/ArtworkService';
import {
  canExtractEmbeddedDuration,
  extractEmbeddedDurationSeconds,
} from '../../metadata/DurationService';
import {
  canExtractEmbeddedTextMetadata,
  extractEmbeddedTextMetadata,
} from '../../metadata/TextMetadataService';
import {DEFAULT_AUDIO_EXTENSION} from '../storage.constants';
import {
  getExtensionFromSong,
  getFileNameFromUriOrPath,
  isUnknownValue,
  parseMetadataFromFilename,
  sanitizeFileSegment,
  toFileUriFromPath,
  toPathFromUri,
} from '../storage.helpers';

const DEFAULT_DURATION_MIGRATION_BATCH_SIZE = 10;
const LIBRARY_CACHE_TTL_MS = 30000;

function resolveMetadataField(candidate, fallback) {
  const text = String(candidate || '').trim();
  if (!text || isUnknownValue(text)) {
    return String(fallback || '').trim();
  }
  return text;
}


function toTimestampMs(value) {
  if (!value) {
    return 0;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 100000000000 ? Math.round(numeric * 1000) : Math.round(numeric);
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export const libraryMethods = {
  async getLocalLibrary(options = {}) {
    const forceRefresh = Boolean(options?.forceRefresh);
    const canUseCache =
      !forceRefresh &&
      Array.isArray(this.libraryCache) &&
      this.getLibraryCacheAgeMs() <= LIBRARY_CACHE_TTL_MS;

    if (canUseCache) {
      return this.libraryCache;
    }

    if (!forceRefresh && this.libraryReadTask) {
      return this.libraryReadTask;
    }

    const readTask = (async () => {
      try {
        await this.hydrateLibraryStoreFromDisk({
          forceRefresh,
        });
        const parsedLibrary = this.getLibraryStoreSnapshot();
        let changed = false;

        const normalizedLibrary = [];
        for (const song of parsedLibrary) {
          let nextSong = song;

          const currentUrl = String(nextSong?.url || '').trim();
          const currentLocalPath = String(nextSong?.localPath || '').trim();
          const mediaStoreId = String(
            nextSong?.mediaStoreId ||
              (String(nextSong?.id || '').startsWith('ms_')
                ? String(nextSong?.id || '').slice(3)
                : ''),
          ).trim();
          const provider = String(nextSong?.provider || '')
            .trim()
            .toLowerCase();
          const normalizedContentUri = String(
            nextSong?.contentUri ||
              (currentUrl.startsWith('content://') ? currentUrl : '') ||
              (mediaStoreId
                ? `content://media/external/audio/media/${mediaStoreId}`
                : ''),
          ).trim();
          const isMediaStoreSong = Boolean(
            provider === 'media_store' ||
              mediaStoreId ||
              normalizedContentUri.startsWith('content://') ||
              currentUrl.startsWith('content://'),
          );
          const resolvedLocalPath = this.resolveSongLocalPath(nextSong);
          if (resolvedLocalPath) {
            if (isMediaStoreSong && normalizedContentUri.startsWith('content://')) {
              if (
                nextSong.localPath !== resolvedLocalPath ||
                currentUrl !== normalizedContentUri ||
                nextSong?.contentUri !== normalizedContentUri
              ) {
                changed = true;
                nextSong = {
                  ...nextSong,
                  localPath: resolvedLocalPath,
                  url: normalizedContentUri,
                  contentUri: normalizedContentUri,
                };
              }
            } else {
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
          } else if (!currentUrl && normalizedContentUri.startsWith('content://')) {
            changed = true;
            nextSong = {
              ...nextSong,
              url: normalizedContentUri,
              contentUri: normalizedContentUri,
            };
          } else if (
            !currentUrl &&
            currentLocalPath.startsWith('content://')
          ) {
            changed = true;
            nextSong = {
              ...nextSong,
              url: currentLocalPath,
            };
          }

          const normalizedSourcePath = this.inferSourcePathFromSong(
            nextSong,
            resolvedLocalPath,
          );
          const existingSourcePath = this.normalizeSourcePath(
            nextSong?.sourcePath,
          );
          if (
            normalizedSourcePath &&
            existingSourcePath !== normalizedSourcePath
          ) {
            changed = true;
            nextSong = {
              ...nextSong,
              sourcePath: normalizedSourcePath,
            };
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

          const nextProvider =
            provider ||
            (mediaStoreId ? 'media_store' : 'legacy_fs');
          if (provider !== nextProvider) {
            changed = true;
            nextSong = {
              ...nextSong,
              provider: nextProvider,
            };
          }

          if (mediaStoreId && nextSong?.mediaStoreId !== mediaStoreId) {
            changed = true;
            nextSong = {
              ...nextSong,
              mediaStoreId,
            };
          }

          const nextUrl = String(nextSong?.url || '').trim();
          const contentUri = String(
            nextSong?.contentUri ||
              (nextUrl.startsWith('content://') ? nextUrl : ''),
          ).trim();
          if (contentUri && nextSong?.contentUri !== contentUri) {
            changed = true;
            nextSong = {
              ...nextSong,
              contentUri,
            };
          }

          normalizedLibrary.push(nextSong);
        }

        if (changed) {
          return this.saveLibrarySnapshot(normalizedLibrary);
        }

        this.setLibraryCache(normalizedLibrary);
        return normalizedLibrary;
      } catch (error) {
        console.error('Error getting library:', error);
        return [];
      }
    })();

    if (!forceRefresh) {
      this.libraryReadTask = readTask;
    }

    try {
      return await readTask;
    } finally {
      if (this.libraryReadTask === readTask) {
        this.libraryReadTask = null;
      }
    }
  },

  async saveLibrarySnapshot(librarySongs = []) {
    const normalized = Array.isArray(librarySongs)
      ? librarySongs.filter(Boolean)
      : [];
    await this.hydrateLibraryStoreFromDisk();
    this.libraryStore.replaceAll(normalized, {
      markDirty: true,
      emit: true,
    });
    this.setLibraryCache(normalized, {syncStore: false});
    return normalized;
  },

  async upsertLibrarySongs(songs = [], options = {}) {
    const incomingSongs = Array.isArray(songs) ? songs.filter(Boolean) : [];
    const baseLibrary = Array.isArray(options.baseLibrary)
      ? [...options.baseLibrary]
      : await this.getLocalLibrary();

    if (incomingSongs.length === 0) {
      return {
        library: baseLibrary,
        changed: false,
        addedCount: 0,
        updatedCount: 0,
        affectedSongIds: [],
      };
    }

    const nextLibrary = [...baseLibrary];
    const affectedSongIds = [];
    let addedCount = 0;
    let updatedCount = 0;
    let changed = false;

    for (const song of incomingSongs) {
      const sourcePath = this.inferSourcePathFromSong(song);
      const incoming = {
        ...song,
        sourcePath,
        addedAt: song?.addedAt || Date.now(),
      };
      const existing = this.findMatchingLibrarySong(nextLibrary, incoming);

      if (existing) {
        const merged = this.mergeSongRecords(existing, incoming);
        const targetIndex = nextLibrary.findIndex(
          item => item === existing || item.id === existing.id,
        );
        if (targetIndex >= 0) {
          nextLibrary[targetIndex] = merged;
          updatedCount += 1;
          changed = true;
          if (merged?.id) {
            affectedSongIds.push(merged.id);
          }
        }
        continue;
      }

      nextLibrary.push(incoming);
      changed = true;
      addedCount += 1;
      if (incoming?.id) {
        affectedSongIds.push(incoming.id);
      }
    }

    if (changed) {
      await this.saveLibrarySnapshot(nextLibrary);
    }

    return {
      library: nextLibrary,
      changed,
      addedCount,
      updatedCount,
      affectedSongIds,
    };
  },

  async persistDurationForSong(song, durationSeconds) {
    const duration = Math.max(0, Math.round(Number(durationSeconds) || 0));
    if (!song || duration <= 0) {
      return false;
    }

    try {
      const library = await this.getLocalLibrary();
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
      await this.saveLibrarySnapshot(nextLibrary);
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
      const library = await this.getLocalLibrary({
        forceRefresh: true,
      });
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
        await this.saveLibrarySnapshot(nextLibrary);
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

  async addToLibrary(song, options = {}) {
    try {
      const summary = await this.upsertLibrarySongs([song], options);
      return summary.library;
    } catch (error) {
      console.error('Error adding to library:', error);
      return [];
    }
  },

  async removeFromLibrary(songId) {
    try {
      const normalizedId = String(songId || '').trim();
      if (!normalizedId) {
        return this.getLocalLibrary();
      }
      await this.hydrateLibraryStoreFromDisk();
      const summary = this.libraryStore.removeBatch([normalizedId], {
        markDirty: true,
        emit: true,
      });
      if (!summary.changed) {
        return this.getLibraryStoreSnapshot();
      }
      const snapshot = this.getLibraryStoreSnapshot();
      this.setLibraryCache(snapshot, {syncStore: false});
      console.log('Song removed from library');
      return snapshot;
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
        sourcePath: this.inferSourcePathFromSong({localPath: destPath}),
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
      sourcePath: this.inferSourcePathFromSong(song),
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
        sourcePath: this.inferSourcePathFromSong({
          ...incomingSong,
          localPath: incomingFilePath,
        }),
        duration: extractedDuration || Number(incomingSong.duration) || 0,
        filename:
          song.filename ||
          incomingFilePath.split('/').pop() ||
          `${resolvedTitle}${DEFAULT_AUDIO_EXTENSION}`,
      };
      const reconciledSong = await this.reconcileLocalSongWithMediaStore(
        reusedSong,
      ).catch(() => null);
      if (reconciledSong) {
        return reconciledSong;
      }
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
        sourcePath: this.inferSourcePathFromSong({localPath: preferredPath}),
        duration:
          (await extractEmbeddedDurationSeconds(preferredPath)) ||
          Number(incomingSong.duration) ||
          0,
        filename: preferredPath.split('/').pop(),
      };
      const reconciledSong = await this.reconcileLocalSongWithMediaStore(
        reusedSong,
      ).catch(() => null);
      if (reconciledSong) {
        return reconciledSong;
      }
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
      sourcePath: this.inferSourcePathFromSong({localPath: destPath}),
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

    const reconciledSong = await this.reconcileLocalSongWithMediaStore(
      localSong,
    ).catch(() => null);
    if (reconciledSong) {
      return reconciledSong;
    }
    await this.addToLibrary(localSong);
    this.hydrateArtworkForSong(localSong, {persist: true}).catch(() => {});
    return localSong;
  },

  async importLocalAudioFile(file, options = {}) {
    const {
      skipArtworkHydration = false,
      skipDurationHydration = false,
      persistToLibrary = true,
      readEmbeddedTextMetadata = true,
      sourcePath = '',
      existingSong = null,
      fileChanged = false,
    } = options;
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

      const fileStat = resolvedPath
        ? await RNFS.stat(resolvedPath).catch(() => null)
        : null;
      const fileSizeBytes = Number(fileStat?.size) || 0;
      const fileMtimeMs = toTimestampMs(fileStat?.mtime);

      const originalName =
        file.name ||
        getFileNameFromUriOrPath(sourceUri) ||
        `audio_${Date.now()}.flac`;

      const inferred = parseMetadataFromFilename(originalName);
      let extractedDuration = 0;
      const durationReadProbe = {};
      if (!skipDurationHydration && resolvedPath) {
        extractedDuration = await extractEmbeddedDurationSeconds(resolvedPath, {
          readProbe: durationReadProbe,
        });
      }
      const metadataReadProbe = {};
      const embeddedTextMetadata =
        readEmbeddedTextMetadata &&
        resolvedPath &&
        canExtractEmbeddedTextMetadata(resolvedPath)
          ? await extractEmbeddedTextMetadata(resolvedPath, {
              readProbe: metadataReadProbe,
            })
          : null;
      const detectedRequiredSeek =
        Boolean(metadataReadProbe?.requiredSeek) ||
        Boolean(durationReadProbe?.requiredSeek);
      const requiredSeek =
        Boolean(existingSong?.requiredSeek) || detectedRequiredSeek;
      if (detectedRequiredSeek && resolvedPath) {
        console.warn(
          '[LibrarySync] Tail seek required (non-faststart optimized media):',
          resolvedPath,
        );
      }

      const existingArtwork = String(existingSong?.artwork || '').trim();
      let artwork = '';
      if (
        !fileChanged &&
        existingArtwork &&
        (await this.hasReusableArtwork(existingSong))
      ) {
        artwork = existingArtwork;
      } else if (
        !skipArtworkHydration &&
        resolvedPath &&
        canExtractEmbeddedArtwork(resolvedPath)
      ) {
        artwork = (await extractEmbeddedArtworkDataUri({
          ...existingSong,
          localPath: resolvedPath,
          url: resolvedUrl,
        })) || '';
      }

      const resolvedSourcePath = this.inferSourcePathFromSong(
        {
          sourcePath,
          localPath: resolvedPath,
          url: resolvedUrl,
        },
        resolvedPath,
      );
      const track = {
        id:
          existingSong?.id ||
          `local_${Date.now()}_${Math.floor(Math.random() * 1000000)}`,
        title: resolveMetadataField(
          embeddedTextMetadata?.title,
          inferred.title ||
            originalName.replace(/\.[^/.]+$/, '') ||
            'Local Audio',
        ),
        artist: resolveMetadataField(
          embeddedTextMetadata?.artist,
          inferred.artist || 'Unknown Artist',
        ),
        album: resolveMetadataField(embeddedTextMetadata?.album, ''),
        url: resolvedUrl,
        localPath: resolvedPath,
        sourcePath: resolvedSourcePath,
        filename: originalName,
        sourceFilename: originalName,
        isLocal: true,
        duration: extractedDuration || 0,
        artwork,
        fileSizeBytes,
        fileMtimeMs,
        requiredSeek,
        addedAt: Number(existingSong?.addedAt) || Date.now(),
      };

      if (!persistToLibrary) {
        return track;
      }

      const baseLibrary = await this.getLocalLibrary();
      const existing = this.findMatchingLibrarySong(baseLibrary, track);
      const canReuseExisting =
        existing &&
        ((await this.songFileExists(existing)) ||
          String(existing?.url || '').startsWith('content://'));

      if (canReuseExisting) {
        const merged = this.mergeSongRecords(existing, track);
        await this.addToLibrary(merged, {baseLibrary});
        return merged;
      }

      await this.addToLibrary(track, {baseLibrary});
      return track;
    } catch (error) {
      console.error('Error importing local audio file:', error);
      throw error;
    }
  },

  async deleteSongFile(song) {
    try {
      if (
        this.isLikelyMediaStoreSong(song) &&
        !this.isSongAppOwned(song)
      ) {
        await this.hideMediaStoreSong(song);
        return;
      }

      const localPath = this.resolveSongLocalPath(song);
      if (localPath) {
        const exists = await RNFS.exists(localPath);
        if (exists) {
          await RNFS.unlink(localPath);
          console.log('Song file deleted');
        }
      }
      await this.removeFromLibrary(song.id);
      if (this.isLikelyMediaStoreSong(song)) {
        this.runLibrarySyncInBackground({
          launchSync: false,
          forceRefresh: true,
          promptForPermission: false,
        }).catch(() => {});
      }
    } catch (error) {
      console.error('Error deleting song file:', error);
    }
  },
};

