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
    this.initializeDirectories();
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
