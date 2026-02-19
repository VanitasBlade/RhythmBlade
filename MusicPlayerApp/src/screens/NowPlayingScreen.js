import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Slider from '@react-native-community/slider';
import TrackPlayer, {
  usePlaybackState,
  useProgress,
  useActiveTrack,
  State,
  RepeatMode,
} from 'react-native-track-player';
import playbackService from '../services/playback';

const { width } = Dimensions.get('window');

const NowPlayingScreen = ({ navigation }) => {
  const playbackState = usePlaybackState();
  const progress = useProgress();
  const track = useActiveTrack();
  const [repeatMode, setRepeatMode] = useState(RepeatMode.Off);
  const [isShuffling, setIsShuffling] = useState(false);

  const isPlaying = playbackState.state === State.Playing;

  const togglePlayback = async () => {
    if (isPlaying) {
      await playbackService.pause();
    } else {
      await playbackService.play();
    }
  };

  const skipToNext = async () => {
    await playbackService.skipToNext();
  };

  const skipToPrevious = async () => {
    await playbackService.skipToPrevious();
  };

  const onSeek = async (value) => {
    await playbackService.seekTo(value);
  };

  const toggleRepeat = async () => {
    let newMode;
    switch (repeatMode) {
      case RepeatMode.Off:
        newMode = RepeatMode.Queue;
        break;
      case RepeatMode.Queue:
        newMode = RepeatMode.Track;
        break;
      case RepeatMode.Track:
        newMode = RepeatMode.Off;
        break;
      default:
        newMode = RepeatMode.Off;
    }
    setRepeatMode(newMode);
    await playbackService.setRepeatMode(newMode);
  };

  const getRepeatIcon = () => {
    switch (repeatMode) {
      case RepeatMode.Track:
        return 'repeat-once';
      case RepeatMode.Queue:
        return 'repeat';
      default:
        return 'repeat';
    }
  };

  const getRepeatColor = () => {
    return repeatMode !== RepeatMode.Off ? '#1DB954' : '#666';
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (!track) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Icon name="chevron-down" size={32} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyContainer}>
          <Icon name="music-off" size={80} color="#666" />
          <Text style={styles.emptyText}>No track playing</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="chevron-down" size={32} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerText}>Now Playing</Text>
        <TouchableOpacity>
          <Icon name="dots-vertical" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.artworkContainer}>
        {track.artwork ? (
          <Image source={{ uri: track.artwork }} style={styles.artwork} />
        ) : (
          <View style={styles.placeholderArtwork}>
            <Icon name="music-note" size={120} color="#666" />
          </View>
        )}
      </View>

      <View style={styles.trackInfo}>
        <Text style={styles.title} numberOfLines={2}>
          {track.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {track.artist}
        </Text>
        {track.album && (
          <Text style={styles.album} numberOfLines={1}>
            {track.album}
          </Text>
        )}
      </View>

      <View style={styles.progressContainer}>
        <Slider
          style={styles.slider}
          value={progress.position}
          minimumValue={0}
          maximumValue={progress.duration || 1}
          onSlidingComplete={onSeek}
          minimumTrackTintColor="#1DB954"
          maximumTrackTintColor="#666"
          thumbTintColor="#1DB954"
        />
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{formatTime(progress.position)}</Text>
          <Text style={styles.timeText}>{formatTime(progress.duration)}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity onPress={toggleRepeat}>
          <Icon name={getRepeatIcon()} size={28} color={getRepeatColor()} />
        </TouchableOpacity>

        <TouchableOpacity onPress={skipToPrevious}>
          <Icon name="skip-previous" size={48} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.playButton} onPress={togglePlayback}>
          <Icon
            name={isPlaying ? 'pause-circle' : 'play-circle'}
            size={80}
            color="#1DB954"
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={skipToNext}>
          <Icon name="skip-next" size={48} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setIsShuffling(!isShuffling)}>
          <Icon
            name="shuffle-variant"
            size={28}
            color={isShuffling ? '#1DB954' : '#666'}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.bottomActions}>
        <TouchableOpacity>
          <Icon name="share-variant" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity>
          <Icon name="playlist-music" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  headerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  artworkContainer: {
    alignItems: 'center',
    marginVertical: 40,
  },
  artwork: {
    width: width - 80,
    height: width - 80,
    borderRadius: 12,
  },
  placeholderArtwork: {
    width: width - 80,
    height: width - 80,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  trackInfo: {
    paddingHorizontal: 40,
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  artist: {
    fontSize: 18,
    color: '#999',
    textAlign: 'center',
    marginBottom: 4,
  },
  album: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  progressContainer: {
    paddingHorizontal: 30,
    marginBottom: 20,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  timeText: {
    fontSize: 12,
    color: '#999',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  playButton: {
    marginHorizontal: 20,
  },
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 60,
    marginBottom: 40,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 18,
    color: '#999',
    marginTop: 20,
  },
});

export default NowPlayingScreen;
