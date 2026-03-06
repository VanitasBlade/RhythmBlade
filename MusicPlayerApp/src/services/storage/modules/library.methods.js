import RNFS from 'react-native-fs';
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
  isUnknownValue,
  parseMetadataFromFilename,
  sanitizeFileSegment,
  toFileUriFromPath,
} from '../storage.helpers';

const LIBRARY_CACHE_TTL_MS = 30000;

function resolveMetadataField(candidate, fallback) {
  const text = String(candidate || '').trim();
  if (!text || isUnknownValue(text)) {
    return String(fallback || '').trim();
  }
  return text;
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
            provider || 'media_store';
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

