import TrackPlayer, {Capability, Event} from 'react-native-track-player';
import {extractEmbeddedArtworkDataUri} from '../artwork/ArtworkService';
import storageService from '../storage/StorageService';

const PLACEHOLDER_VALUES = new Set([
  'unknown',
  'unknown artist',
  'unknown album',
]);

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMetadataValue(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  if (PLACEHOLDER_VALUES.has(text.toLowerCase())) {
    return null;
  }

  return text;
}

function normalizeArtworkUri(value) {
  const uri = normalizeText(value);
  if (!uri) {
    return null;
  }

  if (/^(https?:\/\/|file:\/\/|content:\/\/|data:image\/)/i.test(uri)) {
    return uri;
  }
  if (uri.startsWith('/')) {
    return `file://${uri}`;
  }

  return uri;
}

function runDetached(task, label) {
  Promise.resolve()
    .then(task)
    .catch(error => {
      console.error(`Error ${label}:`, error);
    });
}

function coerceDuration(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

class PlaybackService {
  constructor() {
    this.initialized = false;
    this.metadataSubscriptions = [];
    this.artworkFallbackInFlight = new Set();
  }

  normalizeTrackForQueue(track = {}) {
    const normalized = {...track};
    const title = normalizeMetadataValue(normalized.title);
    const artist = normalizeMetadataValue(normalized.artist);
    const album = normalizeMetadataValue(normalized.album);
    const artwork = normalizeArtworkUri(normalized.artwork);

    if (title) {
      normalized.title = title;
    } else {
      delete normalized.title;
    }
    if (artist) {
      normalized.artist = artist;
    } else {
      delete normalized.artist;
    }
    if (album) {
      normalized.album = album;
    } else {
      delete normalized.album;
    }
    if (artwork) {
      normalized.artwork = artwork;
    } else {
      delete normalized.artwork;
    }

    return normalized;
  }

  toQueueTrack(song = {}) {
    const rawId = String(
      song.id || song.sourceSongId || song.url || song.localPath || '',
    ).trim();
    const localPath = normalizeText(song.localPath);
    const fallbackUrl = localPath
      ? localPath.startsWith('file://')
        ? localPath
        : `file://${localPath}`
      : '';
    const rawUrl = normalizeText(song.url || fallbackUrl);
    if (!rawUrl) {
      return null;
    }

    return this.normalizeTrackForQueue({
      id:
        rawId ||
        `track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      url: rawUrl,
      title: song.title,
      artist: song.artist,
      album: song.album || 'Unknown Album',
      artwork: song.artwork || null,
      duration: coerceDuration(song.duration),
    });
  }

  buildQueueTracks(songs = []) {
    if (!Array.isArray(songs) || songs.length === 0) {
      return [];
    }

    return songs.map(song => this.toQueueTrack(song)).filter(Boolean);
  }

  async playSongs(songs = [], options = {}) {
    const {startIndex = 0} = options;
    const queueTracks = this.buildQueueTracks(songs);
    if (queueTracks.length === 0) {
      return false;
    }

    const boundedIndex = Math.max(
      0,
      Math.min(Number(startIndex) || 0, queueTracks.length - 1),
    );

    await this.reset();
    await this.addTracks(queueTracks);
    if (boundedIndex > 0) {
      await this.skipTo(boundedIndex);
    } else {
      await this.play();
    }
    return true;
  }

  async playSong(song) {
    const track = this.toQueueTrack(song);
    if (!track) {
      return false;
    }

    await this.reset();
    await this.addTrack(track);
    await this.play();
    return true;
  }

  async applyEmbeddedMetadata(metadata = {}) {
    try {
      const trackIndex = await TrackPlayer.getActiveTrackIndex();
      if (trackIndex === null || trackIndex === undefined) {
        return;
      }

      const patch = {};
      const title = normalizeMetadataValue(metadata.title);
      const artist = normalizeMetadataValue(metadata.artist);
      const album = normalizeMetadataValue(
        metadata.albumTitle || metadata.albumName || metadata.album,
      );
      const artwork = normalizeArtworkUri(
        metadata.artworkUri || metadata.artwork,
      );

      if (title) {
        patch.title = title;
      }
      if (artist) {
        patch.artist = artist;
      }
      if (album) {
        patch.album = album;
      }
      if (artwork) {
        patch.artwork = artwork;
      }

      if (Object.keys(patch).length > 0) {
        await TrackPlayer.updateMetadataForTrack(trackIndex, patch);
      }

      if (!patch.artwork) {
        runDetached(
          () => this.applyArtworkFallbackForActiveTrack(),
          'applying artwork fallback',
        );
      }
    } catch (error) {
      console.error('Error applying embedded metadata:', error);
    }
  }

  async applyArtworkFallbackForActiveTrack() {
    let fallbackKey = '';
    try {
      const trackIndex = await TrackPlayer.getActiveTrackIndex();
      if (trackIndex === null || trackIndex === undefined) {
        return;
      }

      const queue = await TrackPlayer.getQueue();
      const activeTrack = queue[trackIndex];
      if (!activeTrack) {
        return;
      }

      const hasArtwork = Boolean(normalizeArtworkUri(activeTrack.artwork));
      if (hasArtwork) {
        return;
      }

      fallbackKey =
        String(activeTrack.id || '').trim() ||
        String(activeTrack.url || '').trim() ||
        `${trackIndex}`;
      if (this.artworkFallbackInFlight.has(fallbackKey)) {
        return;
      }
      this.artworkFallbackInFlight.add(fallbackKey);

      const embeddedArtwork = await extractEmbeddedArtworkDataUri(activeTrack);
      if (!embeddedArtwork) {
        return;
      }

      await TrackPlayer.updateMetadataForTrack(trackIndex, {
        artwork: embeddedArtwork,
      });
      await storageService.persistArtworkForSong(activeTrack, embeddedArtwork);
    } catch (error) {
      console.error('Error applying artwork fallback:', error);
    } finally {
      if (fallbackKey) {
        this.artworkFallbackInFlight.delete(fallbackKey);
      }
    }
  }

  bindMetadataListeners() {
    if (this.metadataSubscriptions.length > 0) {
      return;
    }

    const commonMetadataSubscription = TrackPlayer.addEventListener(
      Event.MetadataCommonReceived,
      event => {
        runDetached(
          () => this.applyEmbeddedMetadata(event?.metadata || {}),
          'applying common metadata',
        );
      },
    );

    const legacyMetadataSubscription = TrackPlayer.addEventListener(
      Event.PlaybackMetadataReceived,
      event => {
        runDetached(
          () => this.applyEmbeddedMetadata(event || {}),
          'applying playback metadata',
        );
      },
    );

    const activeTrackChangedSubscription = TrackPlayer.addEventListener(
      Event.PlaybackActiveTrackChanged,
      () => {
        runDetached(
          () => this.applyArtworkFallbackForActiveTrack(),
          'applying active-track artwork fallback',
        );
      },
    );

    this.metadataSubscriptions.push(
      commonMetadataSubscription,
      legacyMetadataSubscription,
      activeTrackChangedSubscription,
    );
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      await TrackPlayer.setupPlayer({
        maxCacheSize: 1024 * 10, // 10 MB
      });

      await TrackPlayer.updateOptions({
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
          Capability.Stop,
        ],
        compactCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
        ],
        progressUpdateEventInterval: 1,
      });

      this.bindMetadataListeners();
      this.initialized = true;
      console.log('TrackPlayer initialized');
    } catch (error) {
      console.error('Error initializing TrackPlayer:', error);
    }
  }

  async addTrack(track) {
    try {
      const normalizedTrack = this.toQueueTrack(track);
      if (!normalizedTrack) {
        return;
      }
      await TrackPlayer.add(normalizedTrack);
      runDetached(
        () => this.applyArtworkFallbackForActiveTrack(),
        'prefetching track artwork',
      );
      console.log('Track added:', normalizedTrack.title || normalizedTrack.id);
    } catch (error) {
      console.error('Error adding track:', error);
    }
  }

  async addTracks(tracks) {
    try {
      const normalizedTracks = this.buildQueueTracks(tracks);
      if (normalizedTracks.length === 0) {
        return;
      }

      await TrackPlayer.add(normalizedTracks);
      runDetached(
        () => this.applyArtworkFallbackForActiveTrack(),
        'prefetching queue artwork',
      );
      console.log(`${normalizedTracks.length} tracks added`);
    } catch (error) {
      console.error('Error adding tracks:', error);
    }
  }

  async play() {
    try {
      await TrackPlayer.play();
    } catch (error) {
      console.error('Error playing:', error);
    }
  }

  async pause() {
    try {
      await TrackPlayer.pause();
    } catch (error) {
      console.error('Error pausing:', error);
    }
  }

  async skipToNext() {
    try {
      await TrackPlayer.skipToNext();
    } catch (error) {
      console.error('Error skipping to next:', error);
    }
  }

  async skipToPrevious() {
    try {
      await TrackPlayer.skipToPrevious();
    } catch (error) {
      console.error('Error skipping to previous:', error);
    }
  }

  async seekTo(position) {
    try {
      await TrackPlayer.seekTo(position);
    } catch (error) {
      console.error('Error seeking:', error);
    }
  }

  async setRepeatMode(mode) {
    try {
      await TrackPlayer.setRepeatMode(mode);
    } catch (error) {
      console.error('Error setting repeat mode:', error);
    }
  }

  async getQueue() {
    try {
      return await TrackPlayer.getQueue();
    } catch (error) {
      console.error('Error getting queue:', error);
      return [];
    }
  }

  async removeTrack(index) {
    try {
      await TrackPlayer.remove(index);
      console.log('Track removed at index:', index);
    } catch (error) {
      console.error('Error removing track:', error);
    }
  }

  async reset() {
    try {
      await TrackPlayer.reset();
      console.log('Queue reset');
    } catch (error) {
      console.error('Error resetting queue:', error);
    }
  }

  async skipTo(index) {
    try {
      await TrackPlayer.skip(index);
      await TrackPlayer.play();
    } catch (error) {
      console.error('Error skipping to track:', error);
    }
  }

  async getCurrentTrack() {
    try {
      const index = await TrackPlayer.getActiveTrackIndex();
      if (index === null || index === undefined) {
        return null;
      }
      const queue = await TrackPlayer.getQueue();
      return queue[index];
    } catch (error) {
      console.error('Error getting current track:', error);
      return null;
    }
  }

  async getState() {
    try {
      return await TrackPlayer.getPlaybackState();
    } catch (error) {
      console.error('Error getting playback state:', error);
      return null;
    }
  }

  async getProgress() {
    try {
      return await TrackPlayer.getProgress();
    } catch (error) {
      console.error('Error getting progress:', error);
      return {position: 0, duration: 0};
    }
  }
}

// Service for TrackPlayer background playback
export const PlaybackServiceHandler = async () => {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () =>
    TrackPlayer.skipToNext(),
  );
  TrackPlayer.addEventListener(Event.RemotePrevious, () =>
    TrackPlayer.skipToPrevious(),
  );
  TrackPlayer.addEventListener(Event.RemoteSeek, event =>
    TrackPlayer.seekTo(event.position),
  );
};

export default new PlaybackService();
