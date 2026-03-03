import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LEGACY_PLACEHOLDER_FILE_SOURCE_PATHS,
  STORAGE_KEYS,
} from '../storage.constants';
import {
  cloneDefaultFileSources,
  normalizeFileSource,
  normalizeFileSourceFormats,
  normalizeFileSourcePath,
  normalizeText,
} from '../storage.helpers';

const CURSOR_WINDOW_OVERFLOW_PATTERN = /row too big|cursorwindow/i;
const MAX_PROFILE_AVATAR_VALUE_LENGTH = 8192;

function normalizeProfileAvatarValue(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length > MAX_PROFILE_AVATAR_VALUE_LENGTH) {
    return '';
  }
  return normalized;
}

export const settingsMethods = {
  buildDefaultFileSources() {
    return cloneDefaultFileSources(this.getPreferredMusicDir());
  },

  getDefaultSettings() {
    const defaultDownloadSaveLocation =
      normalizeFileSourcePath(this.getPreferredMusicDir()) ||
      this.getPreferredMusicDir();
    return {
      serverUrl: '',
      autoDownload: false,
      theme: 'dark',
      autoContinueEnabled: true,
      loopLibraryPlaylistEnabled: false,
      downloadSetting: 'Hi-Res',
      convertAacToMp3: false,
      downloadSaveLocation: defaultDownloadSaveLocation,
      fileSources: this.buildDefaultFileSources(),
    };
  },

  normalizeFileSources(fileSources = []) {
    const defaults = this.buildDefaultFileSources();
    const defaultPathKey = normalizeText(defaults[0]?.path || '');

    if (!Array.isArray(fileSources) || fileSources.length === 0) {
      return defaults;
    }

    const deduped = [];
    const seenPath = new Set();
    fileSources.forEach((source, index) => {
      const normalized = normalizeFileSource(source, index);
      const key = normalizeText(normalized.path);
      const isLegacyPlaceholder =
        LEGACY_PLACEHOLDER_FILE_SOURCE_PATHS.includes(key) &&
        key !== defaultPathKey;
      if (!key || seenPath.has(key) || isLegacyPlaceholder) {
        return;
      }
      seenPath.add(key);
      deduped.push(normalized);
    });

    if (deduped.length === 0) {
      return defaults;
    }

    const hasDefault = deduped.some(
      source => normalizeText(source.path) === defaultPathKey,
    );
    if (!hasDefault && defaults[0]) {
      deduped.unshift(defaults[0]);
    }

    return deduped;
  },

  async getProfileAvatar() {
    try {
      const avatarValue = await AsyncStorage.getItem(
        STORAGE_KEYS.PROFILE_AVATAR,
      );
      return normalizeProfileAvatarValue(avatarValue);
    } catch (error) {
      console.error('Error getting profile avatar:', error);
      return '';
    }
  },

  async saveProfileAvatar(value = '') {
    try {
      const normalizedAvatar = normalizeProfileAvatarValue(value);
      if (!normalizedAvatar) {
        await AsyncStorage.removeItem(STORAGE_KEYS.PROFILE_AVATAR);
        return '';
      }
      await AsyncStorage.setItem(STORAGE_KEYS.PROFILE_AVATAR, normalizedAvatar);
      return normalizedAvatar;
    } catch (error) {
      console.error('Error saving profile avatar:', error);
      return '';
    }
  },

  async getSettings() {
    try {
      const settings = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!settings) {
        return this.getDefaultSettings();
      }
      const parsed = JSON.parse(settings);
      const legacyAvatar = normalizeProfileAvatarValue(
        parsed?.profileAvatarDataUri || parsed?.profileAvatarUri,
      );
      if (legacyAvatar) {
        await this.saveProfileAvatar(legacyAvatar);
      }
      const merged = {
        ...this.getDefaultSettings(),
        ...(parsed || {}),
        fileSources: this.normalizeFileSources(parsed?.fileSources),
      };
      delete merged.profileAvatarDataUri;
      delete merged.profileAvatarUri;
      return merged;
    } catch (error) {
      console.error('Error getting settings:', error);
      const message = String(error?.message || error || '');
      if (CURSOR_WINDOW_OVERFLOW_PATTERN.test(message)) {
        try {
          await AsyncStorage.removeItem(STORAGE_KEYS.SETTINGS);
          console.warn('Settings payload was too large and has been reset.');
        } catch (removeError) {
          console.error(
            'Could not reset oversized settings payload:',
            removeError,
          );
        }
      }
      return this.getDefaultSettings();
    }
  },

  async saveSettings(settings) {
    try {
      const normalized = {
        ...this.getDefaultSettings(),
        ...(settings || {}),
      };
      const legacyAvatar = normalizeProfileAvatarValue(
        normalized.profileAvatarDataUri || normalized.profileAvatarUri,
      );
      if (legacyAvatar) {
        await this.saveProfileAvatar(legacyAvatar);
      }
      delete normalized.profileAvatarDataUri;
      delete normalized.profileAvatarUri;
      normalized.downloadSaveLocation =
        normalizeFileSourcePath(normalized.downloadSaveLocation) ||
        this.getPreferredMusicDir();
      normalized.autoContinueEnabled = normalized.autoContinueEnabled !== false;
      normalized.loopLibraryPlaylistEnabled =
        normalized.loopLibraryPlaylistEnabled === true;
      normalized.fileSources = this.normalizeFileSources(
        normalized.fileSources,
      );
      await AsyncStorage.setItem(
        STORAGE_KEYS.SETTINGS,
        JSON.stringify(normalized),
      );
      console.log('Settings saved');
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  },

  async getFileSources() {
    const settings = await this.getSettings();
    const normalized = this.normalizeFileSources(settings.fileSources);
    const currentSerialized = JSON.stringify(settings.fileSources || []);
    const normalizedSerialized = JSON.stringify(normalized);
    if (currentSerialized !== normalizedSerialized) {
      await this.saveSettings({
        ...settings,
        fileSources: normalized,
      });
    }
    return normalized;
  },

  async saveFileSources(fileSources = []) {
    const settings = await this.getSettings();
    const normalized = this.normalizeFileSources(fileSources);
    await this.saveSettings({
      ...settings,
      fileSources: normalized,
    });
    return normalized;
  },

  async toggleFileSource(sourceId) {
    const targetId = String(sourceId || '').trim();
    const sources = await this.getFileSources();
    if (!targetId) {
      return sources;
    }

    const nextSources = sources.map(source =>
      source.id === targetId ? {...source, on: !source.on} : source,
    );
    return this.saveFileSources(nextSources);
  },

  async addFileSource(path, options = {}) {
    const sourcePath = normalizeFileSourcePath(path);
    if (!sourcePath) {
      throw new Error('Source path is required');
    }

    const sources = await this.getFileSources();
    const existingIndex = sources.findIndex(
      source => normalizeText(source.path) === normalizeText(sourcePath),
    );
    if (existingIndex >= 0) {
      const existing = sources[existingIndex];
      const mergedFormats = Array.from(
        new Set([
          ...normalizeFileSourceFormats(existing.fmt),
          ...normalizeFileSourceFormats(options.fmt || options.formats),
        ]),
      );
      const nextCount =
        Number.isFinite(Number(options.count)) && Number(options.count) >= 0
          ? Number(options.count)
          : Number(existing.count) || 0;
      const nextSources = [...sources];
      nextSources[existingIndex] = {
        ...existing,
        on: options.on === undefined ? existing.on : options.on !== false,
        count: nextCount,
        fmt: mergedFormats.length > 0 ? mergedFormats : existing.fmt,
      };
      return this.saveFileSources(nextSources);
    }

    const source = normalizeFileSource(
      {
        id: `source_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        path: sourcePath,
        count: Number(options.count) || 0,
        on: options.on !== false,
        fmt: options.fmt || options.formats || ['MP3'],
      },
      sources.length,
    );
    return this.saveFileSources([...sources, source]);
  },

  async clearAll() {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.LIBRARY,
        STORAGE_KEYS.PLAYLISTS,
        STORAGE_KEYS.ALBUMS,
      ]);
      this.clearLibraryCache();
      console.log('All data cleared');
    } catch (error) {
      console.error('Error clearing data:', error);
    }
  },
};
