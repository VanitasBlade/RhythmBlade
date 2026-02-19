import TrackPlayer, {
    Capability,
    Event
} from 'react-native-track-player';

class PlaybackService {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

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

      this.initialized = true;
      console.log('✅ TrackPlayer initialized');
    } catch (error) {
      console.error('❌ Error initializing TrackPlayer:', error);
    }
  }

  async addTrack(track) {
    try {
      await TrackPlayer.add(track);
      console.log('✅ Track added:', track.title);
    } catch (error) {
      console.error('❌ Error adding track:', error);
    }
  }

  async addTracks(tracks) {
    try {
      await TrackPlayer.add(tracks);
      console.log(`✅ ${tracks.length} tracks added`);
    } catch (error) {
      console.error('❌ Error adding tracks:', error);
    }
  }

  async play() {
    try {
      await TrackPlayer.play();
    } catch (error) {
      console.error('❌ Error playing:', error);
    }
  }

  async pause() {
    try {
      await TrackPlayer.pause();
    } catch (error) {
      console.error('❌ Error pausing:', error);
    }
  }

  async skipToNext() {
    try {
      await TrackPlayer.skipToNext();
    } catch (error) {
      console.error('❌ Error skipping to next:', error);
    }
  }

  async skipToPrevious() {
    try {
      await TrackPlayer.skipToPrevious();
    } catch (error) {
      console.error('❌ Error skipping to previous:', error);
    }
  }

  async seekTo(position) {
    try {
      await TrackPlayer.seekTo(position);
    } catch (error) {
      console.error('❌ Error seeking:', error);
    }
  }

  async setRepeatMode(mode) {
    try {
      await TrackPlayer.setRepeatMode(mode);
    } catch (error) {
      console.error('❌ Error setting repeat mode:', error);
    }
  }

  async getQueue() {
    try {
      return await TrackPlayer.getQueue();
    } catch (error) {
      console.error('❌ Error getting queue:', error);
      return [];
    }
  }

  async removeTrack(index) {
    try {
      await TrackPlayer.remove(index);
      console.log('✅ Track removed at index:', index);
    } catch (error) {
      console.error('❌ Error removing track:', error);
    }
  }

  async reset() {
    try {
      await TrackPlayer.reset();
      console.log('✅ Queue reset');
    } catch (error) {
      console.error('❌ Error resetting queue:', error);
    }
  }

  async skipTo(index) {
    try {
      await TrackPlayer.skip(index);
      await TrackPlayer.play();
    } catch (error) {
      console.error('❌ Error skipping to track:', error);
    }
  }

  async getCurrentTrack() {
    try {
      const index = await TrackPlayer.getActiveTrackIndex();
      if (index === null || index === undefined) return null;
      const queue = await TrackPlayer.getQueue();
      return queue[index];
    } catch (error) {
      console.error('❌ Error getting current track:', error);
      return null;
    }
  }

  async getState() {
    try {
      return await TrackPlayer.getPlaybackState();
    } catch (error) {
      console.error('❌ Error getting playback state:', error);
      return null;
    }
  }

  async getProgress() {
    try {
      return await TrackPlayer.getProgress();
    } catch (error) {
      console.error('❌ Error getting progress:', error);
      return { position: 0, duration: 0 };
    }
  }
}

// Service for TrackPlayer background playback
export const PlaybackServiceHandler = async () => {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => TrackPlayer.seekTo(event.position));
};

export default new PlaybackService();