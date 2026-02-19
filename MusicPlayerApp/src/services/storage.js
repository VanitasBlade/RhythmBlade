import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';

const STORAGE_KEYS = {
  LIBRARY: '@music_library',
  PLAYLISTS: '@playlists',
  ALBUMS: '@albums',
  SETTINGS: '@settings',
};

class StorageService {
  constructor() {
    this.musicDir = `${RNFS.DocumentDirectoryPath}/Music`;
    this.initializeDirectories();
  }

  async initializeDirectories() {
    try {
      const exists = await RNFS.exists(this.musicDir);
      if (!exists) {
        await RNFS.mkdir(this.musicDir);
        console.log('✅ Music directory created');
      }
    } catch (error) {
      console.error('❌ Error creating music directory:', error);
    }
  }

  // Library Management
  async getLocalLibrary() {
    try {
      const library = await AsyncStorage.getItem(STORAGE_KEYS.LIBRARY);
      return library ? JSON.parse(library) : [];
    } catch (error) {
      console.error('❌ Error getting library:', error);
      return [];
    }
  }

  async addToLibrary(song) {
    try {
      const library = await this.getLocalLibrary();
      const exists = library.find(s => s.id === song.id);
      
      if (!exists) {
        library.push({
          ...song,
          addedAt: Date.now(),
        });
        await AsyncStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify(library));
        console.log('✅ Song added to library:', song.title);
      }
      
      return library;
    } catch (error) {
      console.error('❌ Error adding to library:', error);
      return [];
    }
  }

  async removeFromLibrary(songId) {
    try {
      const library = await this.getLocalLibrary();
      const filtered = library.filter(s => s.id !== songId);
      await AsyncStorage.setItem(STORAGE_KEYS.LIBRARY, JSON.stringify(filtered));
      console.log('✅ Song removed from library');
      return filtered;
    } catch (error) {
      console.error('❌ Error removing from library:', error);
      return [];
    }
  }

  // Playlist Management
  async getPlaylists() {
    try {
      const playlists = await AsyncStorage.getItem(STORAGE_KEYS.PLAYLISTS);
      return playlists ? JSON.parse(playlists) : [];
    } catch (error) {
      console.error('❌ Error getting playlists:', error);
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
      console.log('✅ Playlist created:', name);
      return newPlaylist;
    } catch (error) {
      console.error('❌ Error creating playlist:', error);
      return null;
    }
  }

  async deletePlaylist(playlistId) {
    try {
      const playlists = await this.getPlaylists();
      const filtered = playlists.filter(p => p.id !== playlistId);
      await AsyncStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(filtered));
      console.log('✅ Playlist deleted');
      return filtered;
    } catch (error) {
      console.error('❌ Error deleting playlist:', error);
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
        console.log('✅ Song added to playlist:', playlist.name);
      }
      
      return playlists;
    } catch (error) {
      console.error('❌ Error adding song to playlist:', error);
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
      console.log('✅ Song removed from playlist');
      return playlists;
    } catch (error) {
      console.error('❌ Error removing song from playlist:', error);
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
      console.error('❌ Error getting albums:', error);
      return [];
    }
  }

  // File Management
  async saveSongLocally(song, filepath) {
    try {
      const filename = `${Date.now()}_${song.title.replace(/[^a-z0-9]/gi, '_')}.flac`;
      const destPath = `${this.musicDir}/${filename}`;
      
      await RNFS.copyFile(filepath, destPath);
      
      const updatedSong = {
        ...song,
        id: Date.now().toString(),
        url: `file://${destPath}`,
        localPath: destPath,
        isLocal: true,
      };

      await this.addToLibrary(updatedSong);
      console.log('✅ Song saved locally:', filename);
      return updatedSong;
    } catch (error) {
      console.error('❌ Error saving song locally:', error);
      return null;
    }
  }

  async importLocalAudioFile(file) {
    try {
      const sourceUri = file?.fileCopyUri || file?.uri;
      if (!sourceUri) {
        throw new Error('Invalid file selected');
      }

      if (sourceUri.startsWith('content://') && !file.fileCopyUri) {
        throw new Error('Unable to access file path. Please re-pick the file.');
      }

      const sourcePath = sourceUri.replace('file://', '');
      const originalName = file.name || sourcePath.split('/').pop() || `audio_${Date.now()}.flac`;
      const safeName = originalName.replace(/[^a-z0-9._-]/gi, '_');
      const destPath = `${this.musicDir}/${Date.now()}_${safeName}`;

      await RNFS.copyFile(sourcePath, destPath);

      const track = {
        id: `local_${Date.now()}`,
        title: originalName.replace(/\.[^/.]+$/, '') || 'Local Audio',
        artist: 'Local File',
        album: 'Imported',
        url: `file://${destPath}`,
        localPath: destPath,
        isLocal: true,
        addedAt: Date.now(),
      };

      await this.addToLibrary(track);
      return track;
    } catch (error) {
      console.error('❌ Error importing local audio file:', error);
      throw error;
    }
  }

  async deleteSongFile(song) {
    try {
      if (song.localPath) {
        const exists = await RNFS.exists(song.localPath);
        if (exists) {
          await RNFS.unlink(song.localPath);
          console.log('✅ Song file deleted');
        }
      }
      await this.removeFromLibrary(song.id);
    } catch (error) {
      console.error('❌ Error deleting song file:', error);
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
      console.error('❌ Error getting settings:', error);
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
      console.log('✅ Settings saved');
    } catch (error) {
      console.error('❌ Error saving settings:', error);
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
      console.log('✅ All data cleared');
    } catch (error) {
      console.error('❌ Error clearing data:', error);
    }
  }
}

export default new StorageService();
