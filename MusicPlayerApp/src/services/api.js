import axios from 'axios';
import {NativeModules, Platform} from 'react-native';
import {checkOnlineStatus} from './network';
import storageService from './storage';

const LEGACY_SERVER_URL = 'http://10.213.164.15:3001';

function getMetroHost() {
  try {
    const scriptURL = NativeModules?.SourceCode?.scriptURL || '';
    if (!scriptURL) {
      return null;
    }
    const match = scriptURL.match(/^https?:\/\/([^/:]+)(?::\d+)?\//);
    return match?.[1] || null;
  } catch (error) {
    return null;
  }
}

function getDefaultServerUrl() {
  const metroHost = getMetroHost();
  if (metroHost && metroHost !== 'localhost' && metroHost !== '127.0.0.1') {
    return `http://${metroHost}:3001`;
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3001';
  }

  return 'http://localhost:3001';
}

class ApiService {
  constructor() {
    this.baseUrl = getDefaultServerUrl();
    this.initializeBaseUrl();
  }

  mapDownloadedSong(downloadedSong) {
    return {
      id: downloadedSong.id,
      url: `${this.baseUrl}/api/stream/${downloadedSong.id}`,
      title: downloadedSong.title,
      artist: downloadedSong.artist,
      album: downloadedSong.album || 'Unknown Album',
      artwork: downloadedSong.artwork || null,
      duration: downloadedSong.duration || 0,
      filename: downloadedSong.filename,
      isLocal: false,
    };
  }

  mapDownloadJob(job) {
    if (!job) {
      return job;
    }

    const mappedSong = job.song?.id
      ? {
          ...job.song,
          ...this.mapDownloadedSong(job.song),
        }
      : job.song || null;

    return {
      ...job,
      progress: Number.isFinite(job.progress) ? job.progress : 0,
      downloadedBytes: Number.isFinite(job.downloadedBytes)
        ? job.downloadedBytes
        : 0,
      totalBytes: Number.isFinite(job.totalBytes) ? job.totalBytes : null,
      song: mappedSong,
    };
  }

  async initializeBaseUrl() {
    const settings = await storageService.getSettings();
    const configuredUrl = settings.serverUrl?.trim();
    const shouldMigrateLegacy =
      !configuredUrl || configuredUrl === LEGACY_SERVER_URL;
    const nextUrl = shouldMigrateLegacy ? getDefaultServerUrl() : configuredUrl;

    this.baseUrl = nextUrl;
    if (configuredUrl !== nextUrl) {
      await storageService.saveSettings({...settings, serverUrl: nextUrl});
    }
  }

  async setBaseUrl(url) {
    this.baseUrl = url;
    const settings = await storageService.getSettings();
    await storageService.saveSettings({...settings, serverUrl: url});
  }

  getFallbackBaseUrls() {
    const urls = [
      this.baseUrl,
      getDefaultServerUrl(),
      'http://10.0.2.2:3001',
      'http://127.0.0.1:3001',
      'http://localhost:3001',
    ];

    const metroHost = getMetroHost();
    if (metroHost) {
      urls.push(`http://${metroHost}:3001`);
    }

    return [...new Set(urls.filter(Boolean))];
  }

  async requestWithServerFallback(requestFn) {
    const candidates = this.getFallbackBaseUrls();
    let lastError = null;

    for (const baseUrl of candidates) {
      try {
        const response = await requestFn(baseUrl);
        if (baseUrl !== this.baseUrl) {
          await this.setBaseUrl(baseUrl);
        }
        return response;
      } catch (error) {
        lastError = error;
        const isNetworkError = !error.response;
        if (!isNetworkError) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Unable to reach crawler server');
  }

  async searchSongs(query, searchType = 'tracks') {
    const isOnline = await checkOnlineStatus();
    if (!isOnline) {
      throw new Error('No internet connection');
    }

    try {
      const response = await this.requestWithServerFallback(baseUrl =>
        axios.get(`${baseUrl}/api/search`, {
          params: {q: query, type: searchType},
          timeout: 30000,
        }),
      );

      if (response.data.success) {
        return response.data.songs;
      }

      return [];
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Search timeout - check your server connection');
      }
      if (!error.response) {
        throw new Error(
          `Cannot reach crawler server. Ensure backend is running on port 3001 (tried: ${this.getFallbackBaseUrls().join(
            ', ',
          )})`,
        );
      }
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  async downloadSong(song, index = null, downloadSetting = 'Hi-Res') {
    const isOnline = await checkOnlineStatus();
    if (!isOnline) {
      throw new Error('No internet connection');
    }

    try {
      const response = await this.requestWithServerFallback(baseUrl =>
        axios.post(
          `${baseUrl}/api/download`,
          {song, index, downloadSetting},
          {timeout: 60000},
        ),
      );

      if (response.data.success) {
        const downloadedSong = response.data.song;
        return this.mapDownloadedSong(downloadedSong);
      }

      throw new Error('Download failed');
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Download timeout - file might be too large');
      }
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  async startDownload(song, index = null, downloadSetting = 'Hi-Res') {
    const isOnline = await checkOnlineStatus();
    if (!isOnline) {
      throw new Error('No internet connection');
    }

    try {
      const response = await this.requestWithServerFallback(baseUrl =>
        axios.post(
          `${baseUrl}/api/downloads`,
          {song, index, downloadSetting},
          {timeout: 15000},
        ),
      );

      if (response.data.success) {
        return this.mapDownloadJob(response.data.job);
      }

      throw new Error('Failed to queue download');
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Queue request timed out');
      }
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  async getDownloadJobs(limit = 60) {
    try {
      const response = await this.requestWithServerFallback(baseUrl =>
        axios.get(`${baseUrl}/api/downloads`, {
          params: {limit},
          timeout: 10000,
        }),
      );

      if (response.data.success) {
        return (response.data.jobs || []).map(job => this.mapDownloadJob(job));
      }

      return [];
    } catch (error) {
      if (!error.response) {
        return [];
      }
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  async getDownloadJob(jobId) {
    try {
      const response = await this.requestWithServerFallback(baseUrl =>
        axios.get(`${baseUrl}/api/downloads/${jobId}`, {
          timeout: 10000,
        }),
      );
      if (response.data.success) {
        return this.mapDownloadJob(response.data.job);
      }
      return null;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  async retryDownload(jobId, fallbackSong = null, downloadSetting = 'Hi-Res') {
    try {
      const response = await this.requestWithServerFallback(baseUrl =>
        axios.post(`${baseUrl}/api/downloads/${jobId}/retry`, null, {
          timeout: 15000,
        }),
      );

      if (response.data.success) {
        return this.mapDownloadJob(response.data.job);
      }

      throw new Error('Retry failed');
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Retry request timed out');
      }
      const status = error.response?.status;
      if (status === 404 && fallbackSong) {
        return this.startDownload(fallbackSong, null, downloadSetting);
      }
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  getStreamUrl(songId) {
    return `${this.baseUrl}/api/stream/${songId}`;
  }

  async testConnection() {
    try {
      const response = await this.requestWithServerFallback(baseUrl =>
        axios.get(`${baseUrl}/api/search`, {
          params: {q: 'test'},
          timeout: 5000,
        }),
      );
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }
}

export default new ApiService();
