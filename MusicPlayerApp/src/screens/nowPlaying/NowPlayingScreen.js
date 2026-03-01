import Slider from '@react-native-community/slider';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import TrackPlayer, {
  RepeatMode,
  State,
  useActiveTrack,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import playbackService from '../../services/playback/PlaybackService';
import storageService from '../../services/storage/StorageService';
import {
  MUSIC_HOME_THEME as C,
  MUSIC_HOME_ART_COLORS,
} from '../../theme/musicHomeTheme';
import { formatTime } from '../../utils/formatTime';
import styles from './nowPlaying.styles';

const noop = () => { };
const queueKeyExtractor = (item, index) =>
  String(item.id || item.url || `queue-${index}`);

const NowPlayingScreen = ({ navigation, route }) => {
  const playbackState = usePlaybackState();
  const progress = useProgress(250);
  const track = useActiveTrack();
  const optimisticTrack = route?.params?.optimisticTrack || null;
  const displayTrack = track || optimisticTrack;
  const [repeatMode, setRepeatMode] = useState(RepeatMode.Off);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueTracks, setQueueTracks] = useState([]);
  const [activeQueueIndex, setActiveQueueIndex] = useState(-1);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isPlaying = playbackState.state === State.Playing;

  const togglePlayback = useCallback(async () => {
    if (isPlaying) {
      await playbackService.pause();
    } else {
      await playbackService.play();
    }
  }, [isPlaying]);

  const skipToNext = useCallback(
    async () => playbackService.skipToNext(),
    [],
  );

  const skipToPrevious = useCallback(
    async () => playbackService.skipToPrevious(),
    [],
  );

  const onSeek = useCallback(async value => {
    await playbackService.seekTo(value);
  }, []);

  const toggleRepeat = useCallback(async () => {
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
  }, [repeatMode]);

  const repeatIcon = useMemo(
    () => (repeatMode === RepeatMode.Track ? 'repeat-once' : 'repeat'),
    [repeatMode],
  );
  const repeatColor = useMemo(
    () => (repeatMode !== RepeatMode.Off ? C.accentFg : C.textDeep),
    [repeatMode],
  );

  const refreshFavoriteState = useCallback(async () => {
    if (!displayTrack?.id) {
      setIsFavorite(false);
      return;
    }
    try {
      const value = await storageService.isSongInFavorites(displayTrack.id);
      setIsFavorite(value);
    } catch (error) {
      console.error('Error checking favorite state:', error);
      setIsFavorite(false);
    }
  }, [displayTrack?.id]);

  useEffect(() => {
    refreshFavoriteState();
  }, [refreshFavoriteState]);

  const toggleFavorite = useCallback(async () => {
    if (!displayTrack?.id) {
      return;
    }
    try {
      const result = await storageService.toggleSongInFavorites(displayTrack);
      setIsFavorite(result.added);
    } catch (error) {
      console.error('Error toggling favorite:', error);
      Alert.alert('Error', 'Could not update favorites.');
    }
  }, [displayTrack]);

  const openQueueView = useCallback(async () => {
    setMenuOpen(false);
    try {
      const [queue, index] = await Promise.all([
        playbackService.getQueue(),
        TrackPlayer.getActiveTrackIndex(),
      ]);
      setQueueTracks(queue);
      setActiveQueueIndex(
        index === null || index === undefined ? -1 : Number(index),
      );
      setQueueOpen(true);
    } catch (error) {
      console.error('Error loading queue:', error);
      Alert.alert('Error', 'Could not open the queue.');
    }
  }, []);

  const playQueuedTrack = useCallback(async index => {
    try {
      await playbackService.skipTo(index);
      setActiveQueueIndex(index);
      setQueueOpen(false);
    } catch (error) {
      console.error('Error switching queue track:', error);
      Alert.alert('Error', 'Could not play this track.');
    }
  }, []);

  const openTrackDetails = useCallback(() => {
    setMenuOpen(false);
    setDetailsOpen(true);
  }, []);

  const deleteCurrentTrack = useCallback(() => {
    if (!displayTrack) {
      return;
    }

    setMenuOpen(false);
    Alert.alert(
      'Delete Track',
      `Delete "${displayTrack.title || 'this track'}" from your library?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const activeIndex = await TrackPlayer.getActiveTrackIndex();
              await storageService.deleteSongFile(displayTrack);
              if (activeIndex !== null && activeIndex !== undefined) {
                await playbackService.removeTrack(activeIndex);
              }

              const queue = await playbackService.getQueue();
              if (!queue.length) {
                navigation.goBack();
              } else {
                const index = await TrackPlayer.getActiveTrackIndex();
                setActiveQueueIndex(
                  index === null || index === undefined ? -1 : Number(index),
                );
              }
            } catch (error) {
              console.error('Error deleting current track:', error);
              Alert.alert('Error', 'Could not delete this track.');
            }
          },
        },
      ],
    );
  }, [displayTrack, navigation]);

  const detailRows = useMemo(
    () => [
      { label: 'Title', value: displayTrack?.title || 'Unknown' },
      { label: 'Artist', value: displayTrack?.artist || 'Unknown' },
      { label: 'Album', value: displayTrack?.album || 'Unknown' },
      {
        label: 'Duration',
        value: formatTime(
          displayTrack?.duration || progress.duration || 0,
        ),
      },
      {
        label: 'Source',
        value: displayTrack?.localPath || displayTrack?.url || 'Unknown',
      },
    ],
    [displayTrack, progress.duration],
  );

  const renderQueueItem = useCallback(
    ({ item, index }) => {
      const isActive = index === activeQueueIndex;
      const fallbackColor =
        MUSIC_HOME_ART_COLORS.purple ||
        MUSIC_HOME_ART_COLORS.indigo ||
        C.bgCard;

      return (
        <TouchableOpacity
          style={[styles.queueItem, isActive && styles.queueItemActive]}
          onPress={() => playQueuedTrack(index)}
          activeOpacity={0.8}>
          {item.artwork ? (
            <Image
              source={{ uri: item.artwork }}
              style={styles.queueArtwork}
              resizeMode="cover"
              fadeDuration={0}
            />
          ) : (
            <View
              style={[
                styles.queueArtworkFallback,
                { backgroundColor: fallbackColor },
              ]}>
              <Icon name="music-note" size={18} color={C.accentFg} />
            </View>
          )}

          <View style={styles.queueMeta}>
            <Text style={styles.queueTitle} numberOfLines={1}>
              {item.title || `Track ${index + 1}`}
            </Text>
            <Text style={styles.queueArtist} numberOfLines={1}>
              {item.artist || 'Unknown Artist'}
            </Text>
          </View>

          {isActive ? (
            <Icon name="volume-high" size={18} color={C.accentFg} />
          ) : null}
        </TouchableOpacity>
      );
    },
    [activeQueueIndex, playQueuedTrack],
  );

  if (!displayTrack) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => navigation.goBack()}>
            <Icon name="chevron-left" size={30} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerText}>Now Playing</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.emptyContainer}>
          <Icon name="music-off" size={80} color={C.textMute} />
          <Text style={styles.emptyText}>No track playing</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => navigation.goBack()}>
          <Icon name="chevron-left" size={30} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerText}>Now Playing</Text>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => setMenuOpen(open => !open)}>
          <Icon name="dots-vertical" size={28} color={C.text} />
        </TouchableOpacity>
      </View>

      {menuOpen ? (
        <>
          <Pressable
            style={styles.backdrop}
            onPress={() => setMenuOpen(false)}
          />
          <View style={styles.optionsMenu}>
            <TouchableOpacity
              style={styles.menuOption}
              onPress={openTrackDetails}>
              <Text style={styles.menuOptionText}>Track Details</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuOption, styles.menuOptionDanger]}
              onPress={deleteCurrentTrack}>
              <Text
                style={[styles.menuOptionText, styles.menuOptionTextDanger]}>
                Delete Track
              </Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      <View style={styles.artworkContainer}>
        {displayTrack.artwork ? (
          <Image
            source={{ uri: displayTrack.artwork }}
            style={styles.artwork}
            resizeMode="cover"
            fadeDuration={150}
          />
        ) : (
          <View style={styles.placeholderArtwork}>
            <Icon name="music-note" size={120} color={C.textMute} />
          </View>
        )}
      </View>

      <View style={styles.trackInfo}>
        <Text style={styles.title} numberOfLines={2}>
          {displayTrack.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {displayTrack.artist}
        </Text>
      </View>

      <View style={styles.progressContainer}>
        <Slider
          style={styles.slider}
          value={progress.position}
          minimumValue={0}
          maximumValue={Math.max(
            progress.duration || displayTrack.duration || 0,
            1,
          )}
          onSlidingComplete={onSeek}
          minimumTrackTintColor={C.accentFg}
          maximumTrackTintColor={C.textDeep}
          thumbTintColor={C.accentFg}
        />
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>{formatTime(progress.position)}</Text>
          <Text style={styles.timeText}>
            {formatTime(progress.duration || displayTrack.duration || 0)}
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity onPress={toggleRepeat}>
          <Icon name={repeatIcon} size={28} color={repeatColor} />
        </TouchableOpacity>

        <TouchableOpacity onPress={skipToPrevious}>
          <Icon name="skip-previous" size={48} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.playButton} onPress={togglePlayback}>
          <Icon
            name={isPlaying ? 'pause-circle' : 'play-circle'}
            size={80}
            color={C.accentFg}
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={skipToNext}>
          <Icon name="skip-next" size={48} color="#fff" />
        </TouchableOpacity>

        {/* Shuffle removed — PlaybackService has no setShuffleMode method */}
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.bottomActions}>
        <TouchableOpacity onPress={toggleFavorite}>
          <Icon
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={24}
            color={isFavorite ? C.accentFg : '#fff'}
          />
        </TouchableOpacity>
        <TouchableOpacity onPress={openQueueView}>
          <Icon name="playlist-music" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <Modal
        visible={detailsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailsOpen(false)}>
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setDetailsOpen(false)}>
          <Pressable style={styles.modalCard} onPress={noop}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Track Details</Text>
              <TouchableOpacity onPress={() => setDetailsOpen(false)}>
                <Icon name="close" size={20} color={C.textDim} />
              </TouchableOpacity>
            </View>

            {detailRows.map(row => (
              <View key={row.label} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{row.label}</Text>
                <Text style={styles.detailValue} numberOfLines={2}>
                  {row.value}
                </Text>
              </View>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={queueOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setQueueOpen(false)}>
        <Pressable
          style={styles.queueOverlay}
          onPress={() => setQueueOpen(false)}>
          <Pressable style={styles.queueCard} onPress={noop}>
            <View style={styles.queueHeader}>
              <View>
                <Text style={styles.queueHeaderTitle}>Current Queue</Text>
                <Text style={styles.queueHeaderMeta}>
                  {queueTracks.length} songs
                </Text>
              </View>
              <TouchableOpacity onPress={() => setQueueOpen(false)}>
                <Icon name="close" size={20} color={C.textDim} />
              </TouchableOpacity>
            </View>

            {queueTracks.length ? (
              <FlatList
                data={queueTracks}
                renderItem={renderQueueItem}
                keyExtractor={queueKeyExtractor}
                contentContainerStyle={styles.queueListContent}
              />
            ) : (
              <View style={styles.queueEmpty}>
                <Icon
                  name="playlist-music-outline"
                  size={36}
                  color={C.textMute}
                />
                <Text style={styles.queueEmptyText}>Queue is empty</Text>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

export default NowPlayingScreen;
