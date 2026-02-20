import AsyncStorage from '@react-native-async-storage/async-storage';
import {PermissionsAndroid, Platform} from 'react-native';
import RNFS from 'react-native-fs';
import {extractEmbeddedArtworkDataUri} from './artwork';

const STORAGE_KEYS = {
  LIBRARY: '@music_library',
  PLAYLISTS: '@playlists',
  ALBUMS: '@albums',
  SETTINGS: '@settings',
};

const DEFAULT_AUDIO_EXTENSION = '.flac';

function sanitizeFileSegment(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .replace(/[^a-z0-9._ -]/gi, '_')
    .slice(0, 120);
}

function getExtensionFromSong(song) {
  const fromFilename = String(song?.filename || '').match(/\.[a-z0-9]{2,5}$/i);
  if (fromFilename) {
    return fromFilename[0];
  }

  const cleanUrl = String(song?.url || '').split('?')[0];
  const fromUrl = cleanUrl.match(/\.[a-z0-9]{2,5}$/i);
  if (fromUrl) {
    return fromUrl[0];
  }

  return DEFAULT_AUDIO_EXTENSION;
}

function isUnknownValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    !normalized ||
    normalized === 'unknown' ||
    normalized === 'unknown artist'
  );
}

function parseMetadataFromFilename(filename) {
  const base = String(filename || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .trim();
  if (!base) {
    return {artist: '', title: ''};
  }

  const parts = base.split(' - ').map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      artist: parts[0],
      title: parts.slice(1).join(' - '),
    };
  }

  return {artist: '', title: base};
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function safeDecodeUriComponent(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }

  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function stripUriQueryAndHash(value) {
  return String(value || '')
    .split('?')[0]
    .split('#')[0];
}

function toPathFromUri(value) {
  const rawValue = stripUriQueryAndHash(String(value || '').trim());
  if (!rawValue) {
    return '';
  }

  const withoutFilePrefix = rawValue.replace(/^file:\/\//, '');
  return safeDecodeUriComponent(withoutFilePrefix);
}

function getFileNameFromUriOrPath(value) {
  const cleaned = stripUriQueryAndHash(value);
  if (!cleaned) {
    return '';
  }

  return (
    safeDecodeUriComponent(cleaned)
      .split('/')
      .filter(Boolean)
      .pop() || ''
  );
}

class StorageService {
  constructor() {
    this.musicDir = `${RNFS.DocumentDirectoryPath}/Music`;
    this.rhythmBladeDir = this.getPreferredMusicDir();
    this.artworkHydrationTasks = new Map();
    this.initializeDirectories();
  }

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
  }

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
  }

  canPromoteMetadata(currentValue, incomingValue) {
    const hasIncoming = normalizeText(incomingValue).length > 0;
    if (!hasIncoming) {
      return false;
    }
    return isUnknownValue(currentValue);
  }

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
    if ((Number(existing?.duration) || 0) > 0 && (Number(incoming?.duration) || 0) <= 0) {
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
  }

  findMatchingLibrarySong(library = [], song = {}) {
    if (!Array.isArray(library) || !song) {
      return null;
    }

    const incomingPath = this.resolveSongLocalPath(song);
    const incomingId = String(song.id || '').trim();
    const incomingSourceId = String(song.sourceSongId || song.id || '').trim();
    const incomingFilename = normalizeText(song.sourceFilename || song.filename);
    const incomingTitle = normalizeText(song.title);
    const incomingArtist = normalizeText(song.artist);

    const exact = library.find(item => {
      const sameId = incomingId && String(item.id || '').trim() === incomingId;
      const sameSourceId =
        incomingSourceId &&
        String(item.sourceSongId || '').trim() === incomingSourceId;
      const samePath =
        incomingPath &&
        this.resolveSongLocalPath(item) &&
        normalizeText(this.resolveSongLocalPath(item)) === normalizeText(incomingPath);
      return sameId || sameSourceId || samePath;
    });
    if (exact) {
      return exact;
    }

    const fallback = library.find(item => {
      const titleMatch =
        incomingTitle &&
        normalizeText(item.title) === incomingTitle;
      const artistMatch =
        incomingArtist &&
        normalizeText(item.artist) === incomingArtist;
      const filenameMatch =
        incomingFilename &&
        normalizeText(item.sourceFilename || item.filename) === incomingFilename;
      return (titleMatch && artistMatch) || filenameMatch;
    });

    return fallback || null;
  }

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
  }

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
      await AsyncStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify(nextLibrary));
      return true;
    } catch (error) {
      console.error('Error persisting artwork for song:', error);
      return false;
    }
  }

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

    const key = this.getArtworkHydrationKey(song) || `path:${normalizeText(filePath)}`;
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
  }

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

    let changed = false;
    for (const candidate of candidates) {
      const artwork = await this.hydrateArtworkForSong(candidate, {persist: true});
      if (artwork) {
        changed = true;
      }
    }

    if (!changed) {
      return [];
    }

    return this.getLocalLibrary();
  }

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
  }

  getPreferredMusicDir() {
    if (Platform.OS === 'android' && RNFS.ExternalStorageDirectoryPath) {
      return `${RNFS.ExternalStorageDirectoryPath}/Music/RhythmBlade`;
    }
    return `${this.musicDir}/RhythmBlade`;
  }

  async ensureDirectory(dirPath) {
    const exists = await RNFS.exists(dirPath);
    if (!exists) {
      await RNFS.mkdir(dirPath);
    }
  }

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
  }

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
  }

  addPathCandidate(list, rawPath) {
    const candidate = toPathFromUri(rawPath);
    if (!candidate || candidate.startsWith('content://')) {
      return;
    }

    if (!list.includes(candidate)) {
      list.push(candidate);
    }
  }

  async resolveContentUriToFilePath(contentUri, filenameHint = '', shouldPrompt = false) {
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

    const documentId =
      safeDecodeUriComponent(decodedUri.match(/\/document\/([^/]+)$/i)?.[1] || '');
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
  }

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
  }

  async initializeDirectories() {
    try {
      await this.ensureDirectory(this.musicDir);
      await this.getWritableMusicDir();
      console.log('Music directories ready');
    } catch (error) {
      console.error('Error creating music directory:', error);
    }
  }

  // Library Management
  async getLocalLibrary() {
    try {
      const library = await AsyncStorage.getItem(STORAGE_KEYS.LIBRARY);
      const parsedLibrary = library ? JSON.parse(library) : [];
      let changed = false;

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
  }

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
        console.log("Song updated in library:", nextEntry.title);
        return nextLibrary;
      }

      library.push(incoming);
      await AsyncStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify(library));
      console.log("Song added to library:", incoming.title);
      return library;
    } catch (error) {
      console.error("Error adding to library:", error);
      return [];
    }
  }

  async removeFromLibrary(songId) {
    try {
      const library = await this.getLocalLibrary();
      const filtered = library.filter(s => s.id !== songId);
      await AsyncStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify(filtered));
      console.log('âœ… Song removed from library');
      return filtered;
    } catch (error) {
      console.error('âŒ Error removing from library:', error);
      return [];
    }
  }

  // Playlist Management
  async getPlaylists() {
    try {
      const playlists = await AsyncStorage.getItem(STORAGE_KEYS.PLAYLISTS);
      return playlists ? JSON.parse(playlists) : [];
    } catch (error) {
      console.error('âŒ Error getting playlists:', error);
      return [];
    }
  }

  async createPlaylist(name, description = '') {
    try {
      const playlists = await this.getPlaylists();
      const newPlaylist = {
        id: Date.now().toString(),
        name,
        description,
        songs: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      playlists.push(newPlaylist);
      await AsyncStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
      console.log('âœ… Playlist created:', name);
      return newPlaylist;
    } catch (error) {
      console.error('âŒ Error creating playlist:', error);
      return null;
    }
  }

  async deletePlaylist(playlistId) {
    try {
      const playlists = await this.getPlaylists();
      const filtered = playlists.filter(p => p.id !== playlistId);
      await AsyncStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(filtered));
      console.log('âœ… Playlist deleted');
      return filtered;
    } catch (error) {
      console.error('âŒ Error deleting playlist:', error);
      return [];
    }
  }

  async addSongToPlaylist(playlistId, song) {
    try {
      const playlists = await this.getPlaylists();
      const playlist = playlists.find(p => p.id === playlistId);
      
      if (!playlist) {
        throw new Error('Playlist not found');
      }

      const exists = playlist.songs.find(s => s.id === song.id);
      if (!exists) {
        playlist.songs.push(song);
        playlist.updatedAt = Date.now();
        await AsyncStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
        console.log('âœ… Song added to playlist:', playlist.name);
      }
      
      return playlists;
    } catch (error) {
      console.error('âŒ Error adding song to playlist:', error);
      return [];
    }
  }

  async removeSongFromPlaylist(playlistId, songId) {
    try {
      const playlists = await this.getPlaylists();
      const playlist = playlists.find(p => p.id === playlistId);
      
      if (!playlist) {
        throw new Error('Playlist not found');
      }

      playlist.songs = playlist.songs.filter(s => s.id !== songId);
      playlist.updatedAt = Date.now();
      await AsyncStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
      console.log('âœ… Song removed from playlist');
      return playlists;
    } catch (error) {
      console.error('âŒ Error removing song from playlist:', error);
      return [];
    }
  }

  // Album Management
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
      console.error('âŒ Error getting albums:', error);
      return [];
    }
  }

  // File Management
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
      console.log('âœ… Song saved locally:', filename);
      return updatedSong;
    } catch (error) {
      console.error('âŒ Error saving song locally:', error);
      return null;
    }
  }

  async saveRemoteSongToDevice(song) {
    if (!song?.url) {
      throw new Error("Invalid song URL");
    }

    const sourceMeta = parseMetadataFromFilename(song.filename);
    const resolvedArtist = isUnknownValue(song.artist)
      ? sourceMeta.artist || "Unknown Artist"
      : song.artist;
    const resolvedTitle = isUnknownValue(song.title)
      ? sourceMeta.title || "Track"
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
    const incomingIsFileUri = String(song.url).startsWith("file://");
    if (incomingIsFileUri && incomingFilePath && (await RNFS.exists(incomingFilePath))) {
      const reusedSong = {
        ...incomingSong,
        localPath: incomingFilePath,
        url: `file://${incomingFilePath}`,
        filename:
          song.filename ||
          incomingFilePath.split("/").pop() ||
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
    const baseName = sanitizeFileSegment(`${resolvedArtist} - ${resolvedTitle}`);
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
  }

  async importLocalAudioFile(file) {
    try {
      const sourceUri = file?.fileCopyUri || file?.uri;
      if (!sourceUri) {
        throw new Error("Invalid file selected");
      }

      const usesContentUri =
        sourceUri.startsWith("content://") && !file.fileCopyUri;
      const initialPath = usesContentUri ? "" : toPathFromUri(sourceUri);
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
          throw new Error("Selected audio file is not accessible");
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
          originalName.replace(/\.[^/.]+$/, "") ||
          "Local Audio",
        artist: inferred.artist || "Unknown Artist",
        album: "",
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
        this.hydrateArtworkForSong(merged, {persist: true}).catch(() => {});
        return merged;
      }

      await this.addToLibrary(track);
      this.hydrateArtworkForSong(track, {persist: true}).catch(() => {});
      return track;
    } catch (error) {
      console.error("Error importing local audio file:", error);
      throw error;
    }
  }

  async deleteSongFile(song) {
    try {
      if (song.localPath) {
        const exists = await RNFS.exists(song.localPath);
        if (exists) {
          await RNFS.unlink(song.localPath);
          console.log('âœ… Song file deleted');
        }
      }
      await this.removeFromLibrary(song.id);
    } catch (error) {
      console.error('âŒ Error deleting song file:', error);
    }
  }

  // Settings
  async getSettings() {
    try {
      const settings = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      return settings ? JSON.parse(settings) : {
        serverUrl: '',
        autoDownload: false,
        theme: 'dark',
        downloadSetting: 'Hi-Res',
      };
    } catch (error) {
      console.error('âŒ Error getting settings:', error);
      return {
        serverUrl: '',
        autoDownload: false,
        theme: 'dark',
        downloadSetting: 'Hi-Res',
      };
    }
  }

  async saveSettings(settings) {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
      console.log('âœ… Settings saved');
    } catch (error) {
      console.error('âŒ Error saving settings:', error);
    }
  }

  // Clear all data
  async clearAll() {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.LIBRARY,
        STORAGE_KEYS.PLAYLISTS,
        STORAGE_KEYS.ALBUMS,
      ]);
      console.log('âœ… All data cleared');
    } catch (error) {
      console.error('âŒ Error clearing data:', error);
    }
  }
}

export default new StorageService();


