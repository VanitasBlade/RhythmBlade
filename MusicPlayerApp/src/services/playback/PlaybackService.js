import TrackPlayer, {Capability, Event, RepeatMode} from 'react-native-track-player';
import {
  canExtractEmbeddedArtwork,
  extractEmbeddedArtworkDataUri,
} from '../artwork/ArtworkService';
import storageService from '../storage/StorageService';

const PLACEHOLDER_VALUES = new Set([
  'unknown',
  'unknown artist',
  'unknown album',
]);
const INLINE_ARTWORK_URI_PREFIX = 'data:image/';
const ARTWORK_FALLBACK_COOLDOWN_MS = 3000;

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

function isInlineArtworkUri(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .startsWith(INLINE_ARTWORK_URI_PREFIX);
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

function shuffleInPlace(items = []) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
  }
  return items;
}

function getTrackOrderKey(track = {}) {
  const id = normalizeText(track.id);
  const url = normalizeText(track.url || track.localPath);
  const title = normalizeText(track.title);
  const artist = normalizeText(track.artist);
  const duration = coerceDuration(track.duration);

  if (id) {
    return `id:${id}`;
  }
  if (url) {
    return `url:${url}`;
  }
  return `meta:${title}|${artist}|${duration}`;
}

function isSameTrackOrder(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (getTrackOrderKey(left[index]) !== getTrackOrderKey(right[index])) {
      return false;
    }
  }
  return true;
}

function findTrackIndexByKey(reference = [], track = null) {
  const targetKey = getTrackOrderKey(track || {});
  if (!targetKey) {
    return -1;
  }
  for (let index = 0; index < reference.length; index += 1) {
    if (getTrackOrderKey(reference[index]) === targetKey) {
      return index;
    }
  }
  return -1;
}

function buildOrderLookup(reference = []) {
  const lookup = new Map();
  for (let index = 0; index < reference.length; index += 1) {
    const key = getTrackOrderKey(reference[index]);
    if (!lookup.has(key)) {
      lookup.set(key, []);
    }
    lookup.get(key).push(index);
  }
  return lookup;
}

function orderTracksByReference(tracks = [], reference = []) {
  if (!Array.isArray(tracks) || tracks.length <= 1) {
    return tracks;
  }

  const lookup = buildOrderLookup(reference);
  const seenCounts = new Map();
  const ranked = tracks.map((track, index) => {
    const key = getTrackOrderKey(track);
    const used = seenCounts.get(key) || 0;
    seenCounts.set(key, used + 1);
    const positions = lookup.get(key) || [];
    const rank = Number.isFinite(positions[used])
      ? positions[used]
      : Number.MAX_SAFE_INTEGER - 1000 + index;
    return {index, rank, track};
  });

  ranked.sort((left, right) => {
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }
    return left.index - right.index;
  });
  return ranked.map(item => item.track);
}

class PlaybackService {
  constructor() {
    this.initialized = false;
    this.metadataSubscriptions = [];
    this.artworkFallbackInFlight = new Set();
    this.artworkFallbackAttemptAt = new Map();
    this.repeatMode = null;
    this.loopBehavior = 'off';
    this.shuffleState = {
      enabled: false,
      originalQueue: [],
    };
  }

  setLoopBehavior(mode) {
    if (mode === 'one' || mode === 'all' || mode === 'off') {
      this.loopBehavior = mode;
      return;
    }
    this.loopBehavior = 'off';
  }

  getLoopBehavior() {
    return this.loopBehavior;
  }

  clearShuffleState() {
    this.shuffleState = {
      enabled: false,
      originalQueue: [],
    };
  }

  isShuffleEnabled() {
    return Boolean(this.shuffleState?.enabled);
  }

  setShuffleState(enabled, originalQueue = []) {
    this.shuffleState = {
      enabled: Boolean(enabled),
      originalQueue: Array.isArray(originalQueue)
        ? originalQueue.map(track => ({...track}))
        : [],
    };
  }

  normalizeTrackForQueue(track = {}, options = {}) {
    const {allowInlineArtwork = false} = options;
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
    if (artwork && (allowInlineArtwork || !isInlineArtworkUri(artwork))) {
      normalized.artwork = artwork;
    } else {
      delete normalized.artwork;
    }

    return normalized;
  }

  toQueueTrack(song = {}, options = {}) {
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

    return this.normalizeTrackForQueue(
      {
        id:
          rawId ||
          `track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        url: rawUrl,
        title: song.title,
        artist: song.artist,
        album: song.album || 'Unknown Album',
        artwork: song.artwork || null,
        duration: coerceDuration(song.duration),
      },
      options,
    );
  }

  buildQueueTracks(songs = [], options = {}) {
    const {inlineArtworkIndex = -1, allowInlineArtworkForAll = false} = options;
    if (!Array.isArray(songs) || songs.length === 0) {
      return [];
    }

    return songs
      .map((song, index) =>
        this.toQueueTrack(song, {
          allowInlineArtwork:
            allowInlineArtworkForAll || Number(inlineArtworkIndex) === index,
        }),
      )
      .filter(Boolean);
  }

  async playSongs(songs = [], options = {}) {
    const {
      startIndex = 0,
      shuffleEnabled = false,
      shuffleOriginalQueue = null,
    } = options;
    const boundedIndex = Math.max(
      0,
      Math.min(Number(startIndex) || 0, songs.length - 1),
    );
    const queueTracks = this.buildQueueTracks(songs, {
      inlineArtworkIndex: boundedIndex,
    });
    if (queueTracks.length === 0) {
      return false;
    }

    const repeatModeBeforeReset = await this.getRepeatMode();
    this.repeatMode = repeatModeBeforeReset;
    let reusedCurrentQueue = false;
    try {
      const [currentQueue, activeIndex] = await Promise.all([
        TrackPlayer.getQueue(),
        TrackPlayer.getActiveTrackIndex(),
      ]);
      if (
        Array.isArray(currentQueue) &&
        currentQueue.length > 0 &&
        isSameTrackOrder(currentQueue, queueTracks)
      ) {
        reusedCurrentQueue = true;
        const numericActiveIndex = Number.isInteger(activeIndex)
          ? Number(activeIndex)
          : 0;
        if (numericActiveIndex !== boundedIndex) {
          await TrackPlayer.skip(boundedIndex);
        }
      }
    } catch (error) {
      // Fallback to replacing queue below.
      reusedCurrentQueue = false;
    }

    if (!reusedCurrentQueue) {
      await TrackPlayer.setQueue(queueTracks);
      // Move to selected track as early as possible to avoid transient index 0 artwork.
      if (boundedIndex > 0) {
        try {
          await TrackPlayer.skip(boundedIndex);
        } catch (error) {
          console.error('Error selecting start track:', error);
        }
      }
    }

    if (shuffleEnabled) {
      const sourceQueue =
        Array.isArray(shuffleOriginalQueue) && shuffleOriginalQueue.length
          ? this.buildQueueTracks(shuffleOriginalQueue)
          : queueTracks;
      this.setShuffleState(true, sourceQueue);
    } else {
      this.clearShuffleState();
    }

    await this.applyStoredRepeatMode();
    await this.play();
    return true;
  }

  async playSong(song) {
    const track = this.toQueueTrack(song, {allowInlineArtwork: true});
    if (!track) {
      return false;
    }

    const repeatModeBeforeReset = await this.getRepeatMode();
    this.repeatMode = repeatModeBeforeReset;
    await TrackPlayer.setQueue([track]);
    await this.applyStoredRepeatMode();
    this.clearShuffleState();
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
      const activeTrack = await TrackPlayer.getActiveTrack().catch(() => null);
      const existingArtwork = normalizeArtworkUri(activeTrack?.artwork);

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
      } else if (existingArtwork) {
        // Preserve the current cover when metadata events omit artwork.
        patch.artwork = existingArtwork;
      }

      if (Object.keys(patch).length > 0) {
        await TrackPlayer.updateMetadataForTrack(trackIndex, patch);
      }

      if (!patch.artwork && !existingArtwork) {
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
      const [trackIndex, activeTrack] = await Promise.all([
        TrackPlayer.getActiveTrackIndex(),
        TrackPlayer.getActiveTrack().catch(() => null),
      ]);
      if (trackIndex === null || trackIndex === undefined) {
        return;
      }

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
      const now = Date.now();
      const lastAttemptAt = this.artworkFallbackAttemptAt.get(fallbackKey) || 0;
      if (now - lastAttemptAt < ARTWORK_FALLBACK_COOLDOWN_MS) {
        return;
      }
      this.artworkFallbackAttemptAt.set(fallbackKey, now);
      if (this.artworkFallbackAttemptAt.size > 500) {
        this.artworkFallbackAttemptAt.clear();
      }

      if (this.artworkFallbackInFlight.has(fallbackKey)) {
        return;
      }
      this.artworkFallbackInFlight.add(fallbackKey);

      if (!canExtractEmbeddedArtwork(activeTrack)) {
        return;
      }

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
      this.repeatMode = await TrackPlayer.getRepeatMode().catch(() => null);
      this.initialized = true;
      console.log('TrackPlayer initialized');
    } catch (error) {
      console.error('Error initializing TrackPlayer:', error);
    }
  }

  async addTrack(track) {
    try {
      const normalizedTrack = this.toQueueTrack(track, {
        allowInlineArtwork: true,
      });
      if (!normalizedTrack) {
        return;
      }
      await TrackPlayer.add(normalizedTrack);
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
      this.repeatMode = mode;
      if (mode === RepeatMode.Off) {
        this.loopBehavior = 'off';
      }
    } catch (error) {
      console.error('Error setting repeat mode:', error);
    }
  }

  async getRepeatMode() {
    try {
      const mode = await TrackPlayer.getRepeatMode();
      this.repeatMode = mode;
      return mode;
    } catch (error) {
      console.error('Error getting repeat mode:', error);
      return this.repeatMode;
    }
  }

  async applyStoredRepeatMode() {
    if (this.repeatMode === null || this.repeatMode === undefined) {
      return;
    }
    try {
      await TrackPlayer.setRepeatMode(this.repeatMode);
    } catch (error) {
      console.error('Error re-applying repeat mode:', error);
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
      this.clearShuffleState();
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

  async enableShufflePreservingCurrent() {
    try {
      const [queue, activeIndex, repeatMode] = await Promise.all([
        TrackPlayer.getQueue(),
        TrackPlayer.getActiveTrackIndex(),
        this.getRepeatMode(),
      ]);

      if (!Array.isArray(queue) || queue.length <= 1) {
        this.clearShuffleState();
        return {
          changed: false,
          enabled: false,
          queueLength: Array.isArray(queue) ? queue.length : 0,
        };
      }

      if (this.isShuffleEnabled()) {
        return {
          changed: false,
          enabled: true,
          queueLength: queue.length,
        };
      }

      const currentIndex = Number.isInteger(activeIndex)
        ? Number(activeIndex)
        : 0;
      const boundedIndex = Math.max(0, Math.min(currentIndex, queue.length - 1));
      const upcoming = queue.slice(boundedIndex + 1);
      this.setShuffleState(true, queue);
      if (upcoming.length <= 1) {
        return {
          changed: false,
          enabled: true,
          queueLength: queue.length,
        };
      }

      let shuffledUpcoming = [...upcoming];
      let attempts = 0;
      do {
        shuffledUpcoming = shuffleInPlace([...upcoming]);
        attempts += 1;
      } while (
        attempts < 5 &&
        isSameTrackOrder(shuffledUpcoming, upcoming)
      );

      if (isSameTrackOrder(shuffledUpcoming, upcoming)) {
        return {
          changed: false,
          enabled: true,
          queueLength: queue.length,
        };
      }

      const removeIndices = [];
      for (let idx = queue.length - 1; idx > boundedIndex; idx -= 1) {
        removeIndices.push(idx);
      }
      if (removeIndices.length > 0) {
        try {
          await TrackPlayer.remove(removeIndices);
        } catch (_) {
          for (let i = 0; i < removeIndices.length; i += 1) {
            await TrackPlayer.remove(removeIndices[i]);
          }
        }
      }
      await TrackPlayer.add(shuffledUpcoming);
      if (repeatMode !== null && repeatMode !== undefined) {
        await this.setRepeatMode(repeatMode);
      }

      return {
        changed: true,
        enabled: true,
        queueLength: queue.length,
      };
    } catch (error) {
      console.error('Error shuffling queue:', error);
      throw error;
    }
  }

  async disableShufflePreservingCurrent() {
    try {
      const sourceQueue = Array.isArray(this.shuffleState?.originalQueue)
        ? this.shuffleState.originalQueue
        : [];
      if (!this.isShuffleEnabled() || sourceQueue.length <= 1) {
        this.clearShuffleState();
        return {
          changed: false,
          enabled: false,
          queueLength: sourceQueue.length,
        };
      }

      const [queue, activeIndex, repeatMode] = await Promise.all([
        TrackPlayer.getQueue(),
        TrackPlayer.getActiveTrackIndex(),
        this.getRepeatMode(),
      ]);

      if (!Array.isArray(queue) || queue.length <= 1) {
        this.clearShuffleState();
        return {
          changed: false,
          enabled: false,
          queueLength: Array.isArray(queue) ? queue.length : 0,
        };
      }

      const currentIndex = Number.isInteger(activeIndex)
        ? Number(activeIndex)
        : 0;
      const boundedIndex = Math.max(0, Math.min(currentIndex, queue.length - 1));
      const currentTrack = queue[boundedIndex] || null;
      const targetIndex = findTrackIndexByKey(sourceQueue, currentTrack);
      if (targetIndex < 0) {
        this.clearShuffleState();
        return {
          changed: false,
          enabled: false,
          queueLength: queue.length,
        };
      }

      const upcoming = queue.slice(boundedIndex + 1);
      if (upcoming.length <= 1) {
        this.clearShuffleState();
        return {
          changed: false,
          enabled: false,
          queueLength: queue.length,
        };
      }

      const rotatedReference = [
        ...sourceQueue.slice(targetIndex + 1),
        ...sourceQueue.slice(0, targetIndex),
      ];
      const restoredUpcoming = orderTracksByReference(
        upcoming,
        rotatedReference,
      );
      const changed = !isSameTrackOrder(upcoming, restoredUpcoming);
      if (!changed) {
        this.clearShuffleState();
        return {
          changed: false,
          enabled: false,
          queueLength: queue.length,
        };
      }

      const removeIndices = [];
      for (let idx = queue.length - 1; idx > boundedIndex; idx -= 1) {
        removeIndices.push(idx);
      }
      if (removeIndices.length > 0) {
        try {
          await TrackPlayer.remove(removeIndices);
        } catch (_) {
          for (let index = 0; index < removeIndices.length; index += 1) {
            await TrackPlayer.remove(removeIndices[index]);
          }
        }
      }

      await TrackPlayer.add(restoredUpcoming);
      if (repeatMode !== null && repeatMode !== undefined) {
        await this.setRepeatMode(repeatMode);
      }

      this.clearShuffleState();
      return {
        changed,
        enabled: false,
        queueLength: queue.length,
      };
    } catch (error) {
      console.error('Error restoring queue order:', error);
      throw error;
    }
  }

  async setShuffleEnabled(enabled) {
    if (enabled) {
      return this.enableShufflePreservingCurrent();
    }
    return this.disableShufflePreservingCurrent();
  }

  async shuffleQueuePreservingCurrent() {
    return this.enableShufflePreservingCurrent();
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
