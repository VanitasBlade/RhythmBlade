import AsyncStorage from '@react-native-async-storage/async-storage';
import {Platform} from 'react-native';
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
const MIN_CROSSFADE_DURATION_SEC = 1;
const MAX_CROSSFADE_DURATION_SEC = 12;
const DEFAULT_CROSSFADE_DURATION_SEC = 5;
const LIBRARY_PROVIDER_VALUES = new Set([
  'legacy_fs',
  'media_store',
  'dual_shadow',
]);

function normalizeLibraryProvider(value) {
  const candidate = String(value || '')
    .trim()
    .toLowerCase();
  if (!LIBRARY_PROVIDER_VALUES.has(candidate)) {
    return 'legacy_fs';
  }
  return candidate;
}

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

function normalizeCrossfadeDurationSec(value) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) {
    return DEFAULT_CROSSFADE_DURATION_SEC;
  }
  return Math.max(
    MIN_CROSSFADE_DURATION_SEC,
    Math.min(MAX_CROSSFADE_DURATION_SEC, numeric),
  );
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
      autoEnableBridge: true,
      autoContinueEnabled: true,
      loopLibraryPlaylistEnabled: false,
      shuffleByDefaultEnabled: false,
      crossfadeEnabled: false,
      crossfadeDurationSec: DEFAULT_CROSSFADE_DURATION_SEC,
      downloadSetting: 'Hi-Res',
      autoConvertAacToMp3: false,
      convertAacToMp3: false,
      downloadSaveLocation: defaultDownloadSaveLocation,
      fileSources: this.buildDefaultFileSources(),
      libraryProvider: Platform.OS === 'android' ? 'media_store' : 'legacy_fs',
      mediaStoreObserverEnabled: true,
      mediaStoreSelectedFoldersOnly: true,
      mediaStoreConsecutiveFailures: 0,
      playlistMediaStoreMigrationDone: false,
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
      merged.autoContinueEnabled = merged.autoContinueEnabled !== false;
      merged.autoEnableBridge = merged.autoEnableBridge !== false;
      merged.loopLibraryPlaylistEnabled =
        merged.loopLibraryPlaylistEnabled === true;
      merged.shuffleByDefaultEnabled = merged.shuffleByDefaultEnabled === true;
      merged.crossfadeEnabled = merged.crossfadeEnabled === true;
      merged.crossfadeDurationSec = normalizeCrossfadeDurationSec(
        merged.crossfadeDurationSec,
      );
      merged.autoConvertAacToMp3 =
        typeof merged.autoConvertAacToMp3 === 'boolean'
          ? merged.autoConvertAacToMp3
          : merged.convertAacToMp3 === true;
      merged.convertAacToMp3 = merged.convertAacToMp3 === true;
      merged.libraryProvider = normalizeLibraryProvider(merged.libraryProvider);
      merged.mediaStoreObserverEnabled =
        merged.mediaStoreObserverEnabled !== false;
      merged.mediaStoreSelectedFoldersOnly =
        merged.mediaStoreSelectedFoldersOnly !== false;
      merged.mediaStoreConsecutiveFailures = Math.max(
        0,
        Number(merged.mediaStoreConsecutiveFailures) || 0,
      );
      merged.playlistMediaStoreMigrationDone =
        merged.playlistMediaStoreMigrationDone === true;
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
      normalized.autoEnableBridge = normalized.autoEnableBridge !== false;
      normalized.loopLibraryPlaylistEnabled =
        normalized.loopLibraryPlaylistEnabled === true;
      normalized.shuffleByDefaultEnabled =
        normalized.shuffleByDefaultEnabled === true;
      normalized.crossfadeEnabled = normalized.crossfadeEnabled === true;
      normalized.crossfadeDurationSec = normalizeCrossfadeDurationSec(
        normalized.crossfadeDurationSec,
      );
      normalized.autoConvertAacToMp3 = normalized.autoConvertAacToMp3 === true;
      normalized.convertAacToMp3 = normalized.convertAacToMp3 === true;
      normalized.libraryProvider = normalizeLibraryProvider(
        normalized.libraryProvider,
      );
      normalized.mediaStoreObserverEnabled =
        normalized.mediaStoreObserverEnabled !== false;
      normalized.mediaStoreSelectedFoldersOnly =
        normalized.mediaStoreSelectedFoldersOnly !== false;
      normalized.mediaStoreConsecutiveFailures = Math.max(
        0,
        Number(normalized.mediaStoreConsecutiveFailures) || 0,
      );
      normalized.playlistMediaStoreMigrationDone =
        normalized.playlistMediaStoreMigrationDone === true;
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
        STORAGE_KEYS.LAST_LIBRARY_SYNC_AT,
        STORAGE_KEYS.MEDIASTORE_SYNC_META,
        STORAGE_KEYS.HIDDEN_MEDIASTORE_IDS,
      ]);
      this.clearLibraryCache({clearStore: true});
      console.log('All data cleared');
    } catch (error) {
      console.error('Error clearing data:', error);
    }
  },
};
