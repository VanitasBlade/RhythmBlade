import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FAVORITES_PLAYLIST_DESCRIPTION,
  FAVORITES_PLAYLIST_ID,
  FAVORITES_PLAYLIST_NAME,
  STORAGE_KEYS,
} from '../storage.constants';
import {normalizePlaylistName, normalizeText} from '../storage.helpers';

export const playlistMethods = {
  normalizePlaylistEntry(playlist = {}) {
    const now = Date.now();
    return {
      ...playlist,
      id: String(playlist.id || `playlist_${now}`),
      name: normalizePlaylistName(playlist.name) || 'Untitled Playlist',
      description: String(playlist.description || '').trim(),
      songs: Array.isArray(playlist.songs) ? playlist.songs : [],
      createdAt: Number(playlist.createdAt) || now,
      updatedAt:
        Number(playlist.updatedAt) || Number(playlist.createdAt) || now,
    };
  },

  isFavoritesPlaylist(playlist) {
    if (!playlist || typeof playlist !== 'object') {
      return false;
    }
    const id = String(playlist.id || '')
      .trim()
      .toLowerCase();
    const name = normalizeText(playlist.name);
    return (
      id === FAVORITES_PLAYLIST_ID ||
      name === normalizeText(FAVORITES_PLAYLIST_NAME)
    );
  },

  buildFavoritesPlaylist(existing = null) {
    const now = Date.now();
    const normalizedExisting = existing
      ? this.normalizePlaylistEntry(existing)
      : null;
    return {
      id: normalizedExisting?.id || FAVORITES_PLAYLIST_ID,
      name: FAVORITES_PLAYLIST_NAME,
      description:
        normalizedExisting?.description || FAVORITES_PLAYLIST_DESCRIPTION,
      songs: Array.isArray(normalizedExisting?.songs)
        ? normalizedExisting.songs
        : [],
      createdAt: normalizedExisting?.createdAt || now,
      updatedAt: normalizedExisting?.updatedAt || now,
      isSystem: true,
    };
  },

  sortPlaylists(playlists = []) {
    return [...playlists].sort((a, b) => {
      const aFav = this.isFavoritesPlaylist(a);
      const bFav = this.isFavoritesPlaylist(b);
      if (aFav && !bFav) {
        return -1;
      }
      if (!aFav && bFav) {
        return 1;
      }
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
    });
  },

  ensureDefaultPlaylists(playlists = []) {
    const normalized = Array.isArray(playlists)
      ? playlists
          .filter(Boolean)
          .map(playlist => this.normalizePlaylistEntry(playlist))
      : [];
    let changed =
      normalized.length !== (Array.isArray(playlists) ? playlists.length : 0);

    const favoriteIndex = normalized.findIndex(playlist =>
      this.isFavoritesPlaylist(playlist),
    );
    if (favoriteIndex === -1) {
      normalized.unshift(this.buildFavoritesPlaylist());
      changed = true;
    } else {
      const existingFavorite = normalized[favoriteIndex];
      const normalizedFavorite = this.buildFavoritesPlaylist(existingFavorite);
      const sameFavorite =
        existingFavorite.id === normalizedFavorite.id &&
        existingFavorite.name === normalizedFavorite.name &&
        existingFavorite.description === normalizedFavorite.description &&
        Array.isArray(existingFavorite.songs) &&
        existingFavorite.songs.length === normalizedFavorite.songs.length &&
        existingFavorite.isSystem === normalizedFavorite.isSystem;
      if (!sameFavorite) {
        changed = true;
      }
      normalized[favoriteIndex] = normalizedFavorite;
    }

    return {
      playlists: this.sortPlaylists(normalized),
      changed,
    };
  },

  async savePlaylists(playlists = []) {
    await AsyncStorage.setItem(
      STORAGE_KEYS.PLAYLISTS,
      JSON.stringify(playlists),
    );
    return playlists;
  },

  async getPlaylists() {
    try {
      const rawPlaylists = await AsyncStorage.getItem(STORAGE_KEYS.PLAYLISTS);
      const parsedPlaylists = rawPlaylists ? JSON.parse(rawPlaylists) : [];
      const {playlists, changed} = this.ensureDefaultPlaylists(parsedPlaylists);

      if (changed || !rawPlaylists) {
        await this.savePlaylists(playlists);
      }

      return playlists;
    } catch (error) {
      console.error('Error getting playlists:', error);
      const fallback = [this.buildFavoritesPlaylist()];
      await this.savePlaylists(fallback);
      return fallback;
    }
  },

  async createPlaylist(name, description = '') {
    try {
      const cleanName = normalizePlaylistName(name);
      if (!cleanName) {
        throw new Error('Playlist name is required');
      }

      const playlists = await this.getPlaylists();
      const hasDuplicate = playlists.some(
        playlist => normalizeText(playlist.name) === normalizeText(cleanName),
      );
      if (hasDuplicate) {
        throw new Error('Playlist name already exists');
      }

      const now = Date.now();
      const newPlaylist = this.normalizePlaylistEntry({
        id: `${now}_${Math.random().toString(36).slice(2, 7)}`,
        name: cleanName,
        description,
        songs: [],
        createdAt: now,
        updatedAt: now,
      });

      const nextPlaylists = this.sortPlaylists([...playlists, newPlaylist]);
      await this.savePlaylists(nextPlaylists);
      console.log('Playlist created:', cleanName);
      return newPlaylist;
    } catch (error) {
      console.error('Error creating playlist:', error);
      throw error;
    }
  },

  async deletePlaylist(playlistId) {
    try {
      const playlists = await this.getPlaylists();
      const target = playlists.find(playlist => playlist.id === playlistId);
      if (!target) {
        return playlists;
      }
      if (this.isFavoritesPlaylist(target)) {
        throw new Error('favorites playlist cannot be deleted');
      }

      const filtered = playlists.filter(playlist => playlist.id !== playlistId);
      const {playlists: nextPlaylists} = this.ensureDefaultPlaylists(filtered);
      await this.savePlaylists(nextPlaylists);
      console.log('Playlist deleted');
      return nextPlaylists;
    } catch (error) {
      console.error('Error deleting playlist:', error);
      throw error;
    }
  },

  async getFavoritesPlaylist() {
    const playlists = await this.getPlaylists();
    return (
      playlists.find(playlist => this.isFavoritesPlaylist(playlist)) || null
    );
  },

  async isSongInFavorites(songId) {
    const favorites = await this.getFavoritesPlaylist();
    if (!favorites || !songId) {
      return false;
    }
    return favorites.songs.some(song => song.id === songId);
  },

  async toggleSongInFavorites(song) {
    if (!song?.id) {
      throw new Error('Invalid song');
    }

    const playlists = await this.getPlaylists();
    const favoriteIndex = playlists.findIndex(playlist =>
      this.isFavoritesPlaylist(playlist),
    );
    if (favoriteIndex === -1) {
      throw new Error('favorites playlist is unavailable');
    }

    const favorites = playlists[favoriteIndex];
    const songExists = favorites.songs.some(item => item.id === song.id);
    const nextSongs = songExists
      ? favorites.songs.filter(item => item.id !== song.id)
      : [...favorites.songs, song];
    const nextFavorites = {
      ...favorites,
      songs: nextSongs,
      updatedAt: Date.now(),
    };
    const nextPlaylists = [...playlists];
    nextPlaylists[favoriteIndex] = nextFavorites;
    const orderedPlaylists = this.sortPlaylists(nextPlaylists);
    await this.savePlaylists(orderedPlaylists);

    return {
      added: !songExists,
      playlist: nextFavorites,
      playlists: orderedPlaylists,
    };
  },

  async addSongToPlaylist(playlistId, song) {
    try {
      const playlists = await this.getPlaylists();
      const playlist = playlists.find(item => item.id === playlistId);

      if (!playlist) {
        throw new Error('Playlist not found');
      }

      const exists = playlist.songs.find(item => item.id === song.id);
      if (!exists) {
        playlist.songs.push(song);
        playlist.updatedAt = Date.now();
        const nextPlaylists = this.sortPlaylists(playlists);
        await this.savePlaylists(nextPlaylists);
        console.log('Song added to playlist:', playlist.name);
        return nextPlaylists;
      }

      return playlists;
    } catch (error) {
      console.error('Error adding song to playlist:', error);
      throw error;
    }
  },

  async removeSongFromPlaylist(playlistId, songId) {
    try {
      const playlists = await this.getPlaylists();
      const playlist = playlists.find(item => item.id === playlistId);

      if (!playlist) {
        throw new Error('Playlist not found');
      }

      playlist.songs = playlist.songs.filter(song => song.id !== songId);
      playlist.updatedAt = Date.now();
      const nextPlaylists = this.sortPlaylists(playlists);
      await this.savePlaylists(nextPlaylists);
      console.log('Song removed from playlist');
      return nextPlaylists;
    } catch (error) {
      console.error('Error removing song from playlist:', error);
      throw error;
    }
  },
};
