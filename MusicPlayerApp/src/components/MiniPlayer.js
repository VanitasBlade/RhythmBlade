import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import {
  usePlaybackState,
  useActiveTrack,
  State,
} from 'react-native-track-player';
import playbackService from '../services/playback';

const MiniPlayer = () => {
  const navigation = useNavigation();
  const playbackState = usePlaybackState();
  const track = useActiveTrack();

  const isPlaying = playbackState.state === State.Playing;

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

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => navigation.navigate('NowPlaying')}
      activeOpacity={0.9}
    >
      <View style={styles.trackInfo}>
        {track.artwork ? (
          <Image source={{ uri: track.artwork }} style={styles.artwork} />
        ) : (
          <View style={styles.placeholderArtwork}>
            <Icon name="music-note" size={20} color="#666" />
          </View>
        )}

        <View style={styles.textContainer}>
          <Text style={styles.title} numberOfLines={1}>
            {track.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {track.artist}
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity onPress={togglePlayback} style={styles.controlButton}>
          <Icon
            name={isPlaying ? 'pause' : 'play'}
            size={28}
            color="#fff"
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={skipToNext} style={styles.controlButton}>
          <Icon name="skip-next" size={28} color="#fff" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  trackInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  artwork: {
    width: 45,
    height: 45,
    borderRadius: 4,
    marginRight: 12,
  },
  placeholderArtwork: {
    width: 45,
    height: 45,
    borderRadius: 4,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  artist: {
    fontSize: 12,
    color: '#999',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  controlButton: {
    padding: 5,
  },
});

export default MiniPlayer;
