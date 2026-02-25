import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useNavigation} from '@react-navigation/native';
import {
  State,
  useActiveTrack,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';
import playbackService from '../services/playback/PlaybackService';
import {MUSIC_HOME_THEME as C} from '../theme/musicHomeTheme';

const formatTime = value => {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

const MiniPlayer = () => {
  const navigation = useNavigation();
  const playbackState = usePlaybackState();
  const track = useActiveTrack();
  const {position, duration} = useProgress(1);
  const [stableTrackKey, setStableTrackKey] = useState('');
  const [stableArtworkUri, setStableArtworkUri] = useState('');
  const currentTrackKey = String(track?.id || track?.url || '').trim();
  const currentArtworkUri = String(track?.artwork || '').trim();
  const displayArtworkUri = currentArtworkUri || stableArtworkUri;

  const isPlaying = playbackState.state === State.Playing;
  const progressPct =
    duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;

  useEffect(() => {
    if (!currentTrackKey) {
      setStableTrackKey('');
      setStableArtworkUri('');
      return;
    }

    if (currentTrackKey !== stableTrackKey) {
      setStableTrackKey(currentTrackKey);
      setStableArtworkUri(currentArtworkUri || '');
      return;
    }

    if (currentArtworkUri) {
      setStableArtworkUri(currentArtworkUri);
    }
  }, [currentArtworkUri, currentTrackKey, stableTrackKey]);

  if (!track) {
    return null;
  }

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

  return (
    <View style={styles.container}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, {width: `${progressPct}%`}]} />
      </View>

      <TouchableOpacity
        style={styles.trackRow}
        activeOpacity={0.9}
        onPress={() =>
          navigation.navigate('NowPlaying', {optimisticTrack: track})
        }>
        {displayArtworkUri ? (
          <Image source={{uri: displayArtworkUri}} style={styles.artwork} />
        ) : (
          <View style={styles.artworkFallback}>
            <Icon name="music-note" size={18} color={C.accentFg} />
          </View>
        )}

        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {track.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {track.artist}
          </Text>
        </View>

        <Text style={styles.time}>
          {formatTime(position)} / {formatTime(duration || track.duration)}
        </Text>
      </TouchableOpacity>

      <View style={styles.controls}>
        <TouchableOpacity onPress={skipToPrevious} style={styles.iconBtn}>
          <Icon name="skip-previous" size={20} color={C.accentFg} />
        </TouchableOpacity>

        <TouchableOpacity onPress={togglePlayback} style={styles.playBtn}>
          <Icon name={isPlaying ? 'pause' : 'play'} size={20} color={C.bg} />
        </TouchableOpacity>

        <TouchableOpacity onPress={skipToNext} style={styles.iconBtn}>
          <Icon name="skip-next" size={20} color={C.accentFg} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 68,
    left: 0,
    right: 0,
    backgroundColor: C.bgPlayer,
    borderTopColor: C.border,
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: C.borderDim,
  },
  progressFill: {
    height: '100%',
    backgroundColor: C.accent,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 116,
  },
  artwork: {
    width: 38,
    height: 38,
    borderRadius: 4,
  },
  artworkFallback: {
    width: 38,
    height: 38,
    borderRadius: 4,
    backgroundColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    marginLeft: 10,
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
  },
  artist: {
    marginTop: 2,
    color: C.textMute,
    fontSize: 12,
  },
  time: {
    marginLeft: 8,
    color: C.textMute,
    fontSize: 12,
  },
  controls: {
    position: 'absolute',
    right: 10,
    top: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },
});

export default MiniPlayer;
