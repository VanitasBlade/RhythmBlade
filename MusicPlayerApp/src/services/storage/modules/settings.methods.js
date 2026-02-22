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

export const settingsMethods = {
  buildDefaultFileSources() {
    return cloneDefaultFileSources(this.getPreferredMusicDir());
  },

  getDefaultSettings() {
    return {
      serverUrl: '',
      autoDownload: false,
      theme: 'dark',
      downloadSetting: 'Hi-Res',
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

  async getSettings() {
    try {
      const settings = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!settings) {
        return this.getDefaultSettings();
      }
      const parsed = JSON.parse(settings);
      return {
        ...this.getDefaultSettings(),
        ...(parsed || {}),
        fileSources: this.normalizeFileSources(parsed?.fileSources),
      };
    } catch (error) {
      console.error('Error getting settings:', error);
      return this.getDefaultSettings();
    }
  },

  async saveSettings(settings) {
    try {
      const normalized = {
        ...this.getDefaultSettings(),
        ...(settings || {}),
      };
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
      console.log('All data cleared');
    } catch (error) {
      console.error('Error clearing data:', error);
    }
  },
};
