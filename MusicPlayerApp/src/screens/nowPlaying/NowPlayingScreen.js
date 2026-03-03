import Slider from '@react-native-community/slider';
import {useFocusEffect} from '@react-navigation/native';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
const LOOP_MODE = {
  OFF: 'off',
  ONE: 'one',
  ALL: 'all',
};

function toLoopMode(value) {
  const preferred = playbackService.getLoopBehavior?.();
  if (value === RepeatMode.Queue) {
    return preferred === LOOP_MODE.ONE ? LOOP_MODE.ONE : LOOP_MODE.ALL;
  }
  if (value === RepeatMode.Track) {
    if (preferred === LOOP_MODE.ONE || preferred === LOOP_MODE.ALL) {
      return preferred;
    }
    return LOOP_MODE.ALL;
  }
  return LOOP_MODE.OFF;
}

function currentTrackToken(track = null) {
  return String(track?.id || track?.url || '').trim();
}

const NowPlayingScreen = ({ navigation, route }) => {
  const playbackState = usePlaybackState();
  const progress = useProgress(250);
  const track = useActiveTrack();
  const optimisticTrack = route?.params?.optimisticTrack || null;
  const [loopMode, setLoopMode] = useState(LOOP_MODE.OFF);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueTracks, setQueueTracks] = useState([]);
  const [activeQueueIndex, setActiveQueueIndex] = useState(-1);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [shuffleActive, setShuffleActive] = useState(false);
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const [playlistOptions, setPlaylistOptions] = useState([]);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekWasPlaying, setSeekWasPlaying] = useState(false);
  const [shuffleTransitioning, setShuffleTransitioning] = useState(false);
  const [shuffleTransitionWasPlaying, setShuffleTransitionWasPlaying] = useState(false);
  const [frozenTrack, setFrozenTrack] = useState(null);
  const loopModeRef = useRef(LOOP_MODE.OFF);
  const loopOneTrackTokenRef = useRef('');
  const loopOneConsumedRef = useRef(false);
  const seekInteractionRef = useRef(false);
  const shuffleTransitionTimeoutRef = useRef(null);
  const progressRef = useRef({
    token: '',
    position: 0,
    duration: 0,
  });
  const displayTrack =
    (shuffleTransitioning && frozenTrack) ||
    track ||
    optimisticTrack ||
    frozenTrack;

  const isPlayingRaw = playbackState.state === State.Playing;
  const isTransitioningPlaybackState =
    playbackState.state === State.Buffering ||
    playbackState.state === State.Loading ||
    playbackState.state === State.Ready;
  const isPlayingVisual =
    (isPlayingRaw && (!isSeeking || seekWasPlaying)) ||
    (isTransitioningPlaybackState && seekWasPlaying) ||
    (isSeeking && seekWasPlaying) ||
    (shuffleTransitioning && shuffleTransitionWasPlaying);

  const togglePlayback = useCallback(async () => {
    if (
      playbackState.state === State.Playing ||
      playbackState.state === State.Buffering
    ) {
      await playbackService.pause();
    } else {
      await playbackService.play();
    }
  }, [playbackState.state]);

  const skipToNext = useCallback(
    async () => playbackService.skipToNext(),
    [],
  );

  const skipToPrevious = useCallback(
    async () => playbackService.skipToPrevious(),
    [],
  );

  const onSeekStart = useCallback(() => {
    setIsSeeking(true);
    setSeekWasPlaying(playbackState.state === State.Playing);
    seekInteractionRef.current = true;
  }, [playbackState.state]);

  const onSeek = useCallback(async value => {
    await playbackService.seekTo(value);
    setTimeout(() => {
      setIsSeeking(false);
      seekInteractionRef.current = false;
    }, 180);
  }, []);

  useEffect(() => {
    if (!seekWasPlaying) {
      return;
    }

    if (playbackState.state === State.Playing) {
      const timer = setTimeout(() => {
        setSeekWasPlaying(false);
      }, 350);
      return () => clearTimeout(timer);
    }

    if (
      playbackState.state === State.Paused ||
      playbackState.state === State.Stopped ||
      playbackState.state === State.None
    ) {
      setSeekWasPlaying(false);
      return;
    }

    if (playbackState.state === State.Ended) {
      const timer = setTimeout(() => {
        setSeekWasPlaying(false);
      }, 700);
      return () => clearTimeout(timer);
    }
  }, [playbackState.state, seekWasPlaying]);

  useEffect(
    () => () => {
      if (shuffleTransitionTimeoutRef.current) {
        clearTimeout(shuffleTransitionTimeoutRef.current);
        shuffleTransitionTimeoutRef.current = null;
      }
    },
    [],
  );

  const syncRepeatMode = useCallback(async () => {
    const mode = await playbackService.getRepeatMode();
    if (mode !== null && mode !== undefined) {
      const resolvedMode = toLoopMode(mode);
      setLoopMode(resolvedMode);
      loopModeRef.current = resolvedMode;
    }
  }, []);

  const syncShuffleState = useCallback(() => {
    setShuffleActive(playbackService.isShuffleEnabled());
  }, []);

  const toggleRepeat = useCallback(async () => {
    let nextMode = LOOP_MODE.OFF;
    switch (loopModeRef.current) {
      case LOOP_MODE.OFF:
        nextMode = LOOP_MODE.ONE;
        break;
      case LOOP_MODE.ONE:
        nextMode = LOOP_MODE.ALL;
        break;
      case LOOP_MODE.ALL:
      default:
        nextMode = LOOP_MODE.OFF;
    }

    setLoopMode(nextMode);
    loopModeRef.current = nextMode;

    if (nextMode === LOOP_MODE.ALL) {
      loopOneConsumedRef.current = false;
      loopOneTrackTokenRef.current = '';
      playbackService.setLoopBehavior?.(LOOP_MODE.ALL);
      await playbackService.setRepeatMode(RepeatMode.Track);
      return;
    }

    if (nextMode === LOOP_MODE.ONE) {
      loopOneConsumedRef.current = false;
      loopOneTrackTokenRef.current = currentTrackToken(displayTrack);
      playbackService.setLoopBehavior?.(LOOP_MODE.ONE);
      await playbackService.setRepeatMode(RepeatMode.Track);
      return;
    }

    loopOneConsumedRef.current = false;
    loopOneTrackTokenRef.current = '';
    playbackService.setLoopBehavior?.(LOOP_MODE.OFF);
    await playbackService.setRepeatMode(RepeatMode.Off);
  }, [displayTrack]);

  const repeatIcon = useMemo(
    () => (loopMode === LOOP_MODE.ONE ? 'repeat-once' : 'repeat'),
    [loopMode],
  );
  const repeatColor = useMemo(
    () => (loopMode !== LOOP_MODE.OFF ? C.accentFg : C.textDeep),
    [loopMode],
  );
  const shuffleColor = useMemo(
    () => (shuffleActive ? C.accentFg : C.textDeep),
    [shuffleActive],
  );

  useEffect(() => {
    loopModeRef.current = loopMode;
  }, [loopMode]);

  useEffect(() => {
    const token = currentTrackToken(displayTrack);
    const position = Number(progress.position) || 0;
    const duration = Math.max(
      0,
      Number(progress.duration || displayTrack?.duration) || 0,
    );
    const previous = progressRef.current;

    if (!token || previous.token !== token) {
      progressRef.current = {token, position, duration};
      return;
    }

    const droppedToStart =
      previous.position >= 3 &&
      position <= 1.2 &&
      previous.position - position >= 2;
    const nearEndFloor = duration > 0 ? Math.max(duration - 4, duration * 0.75) : 10;
    const wrapped = droppedToStart && previous.position >= nearEndFloor;
    if (
      wrapped &&
      loopModeRef.current === LOOP_MODE.ONE &&
      !loopOneConsumedRef.current &&
      loopOneTrackTokenRef.current === token &&
      !seekInteractionRef.current
    ) {
      loopOneConsumedRef.current = true;
      setLoopMode(LOOP_MODE.OFF);
      loopModeRef.current = LOOP_MODE.OFF;
      playbackService.setLoopBehavior?.(LOOP_MODE.OFF);
      playbackService.setRepeatMode(RepeatMode.Off).catch(() => {});
    }

    progressRef.current = {token, position, duration};
  }, [displayTrack, progress.duration, progress.position]);

  useEffect(() => {
    const unsubscribe = playbackService.subscribeShuffleState(enabled => {
      setShuffleActive(Boolean(enabled));
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (loopMode !== LOOP_MODE.ONE) {
      loopOneConsumedRef.current = false;
      if (loopMode === LOOP_MODE.OFF) {
        loopOneTrackTokenRef.current = '';
      }
      return;
    }
    const token = currentTrackToken(displayTrack);
    if (token && loopOneTrackTokenRef.current !== token) {
      loopOneTrackTokenRef.current = token;
      loopOneConsumedRef.current = false;
    }
  }, [displayTrack, loopMode]);

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

  useEffect(() => {
    const unsubscribe = playbackService.subscribeAutoContinueStop(() => {
      if (navigation?.canGoBack?.()) {
        navigation.goBack();
        return;
      }
      navigation?.navigate?.('MainTabs');
    });
    return () => {
      unsubscribe();
    };
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      syncRepeatMode();
      syncShuffleState();
    }, [syncRepeatMode, syncShuffleState]),
  );

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

  const openAddToPlaylistPicker = useCallback(async () => {
    if (!displayTrack) {
      return;
    }
    setMenuOpen(false);
    try {
      const playlists = await storageService.getPlaylists();
      const selectable = playlists.filter(
        item => !storageService.isFavoritesPlaylist(item),
      );
      if (!selectable.length) {
        Alert.alert(
          'No Playlists',
          'Create a playlist first, then add songs to it.',
        );
        return;
      }
      setPlaylistOptions(selectable);
      setPlaylistPickerOpen(true);
    } catch (error) {
      console.error('Error loading playlists for picker:', error);
      Alert.alert('Error', 'Could not load playlists.');
    }
  }, [displayTrack]);

  const addCurrentTrackToPlaylist = useCallback(
    async playlist => {
      if (!displayTrack || !playlist) {
        return;
      }
      try {
        await storageService.addSongToPlaylist(playlist.id, displayTrack);
        setPlaylistPickerOpen(false);
        Alert.alert(
          'Added to Playlist',
          `"${displayTrack.title || 'Track'}" was added to "${playlist.name}".`,
        );
      } catch (error) {
        console.error('Error adding track to playlist:', error);
        Alert.alert(
          'Add to Playlist Failed',
          error?.message || 'Could not add this track.',
        );
      }
    },
    [displayTrack],
  );

  const shuffleQueue = useCallback(async () => {
    let shouldSmoothVisualTransition = false;
    try {
      const currentShuffleState = playbackService.isShuffleEnabled();
      shouldSmoothVisualTransition = currentShuffleState;
      if (shouldSmoothVisualTransition) {
        if (shuffleTransitionTimeoutRef.current) {
          clearTimeout(shuffleTransitionTimeoutRef.current);
          shuffleTransitionTimeoutRef.current = null;
        }
        const preservedTrack = track || optimisticTrack || null;
        const wasPlaying = [
          State.Playing,
          State.Buffering,
          State.Loading,
          State.Ready,
        ].includes(playbackState.state);
        setFrozenTrack(preservedTrack);
        setShuffleTransitionWasPlaying(wasPlaying);
        setShuffleTransitioning(true);
      }
      const nextState = !currentShuffleState;
      const result = await playbackService.setShuffleEnabled(nextState);
      setShuffleActive(Boolean(result?.enabled));
      const [queue, index] = await Promise.all([
        playbackService.getQueue(),
        TrackPlayer.getActiveTrackIndex(),
      ]);
      setQueueTracks(queue);
      setActiveQueueIndex(
        index === null || index === undefined ? -1 : Number(index),
      );
    } catch (error) {
      console.error('Error shuffling queue:', error);
      Alert.alert('Shuffle Failed', 'Could not shuffle the current queue.');
    } finally {
      if (shouldSmoothVisualTransition) {
        shuffleTransitionTimeoutRef.current = setTimeout(() => {
          setShuffleTransitioning(false);
          setShuffleTransitionWasPlaying(false);
          setFrozenTrack(null);
          shuffleTransitionTimeoutRef.current = null;
        }, 700);
      }
    }
  }, [optimisticTrack, playbackState.state, track]);

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
              onPress={openAddToPlaylistPicker}>
              <Text style={styles.menuOptionText}>Add to Playlist</Text>
            </TouchableOpacity>
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
          onSlidingStart={onSeekStart}
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
            name={isPlayingVisual ? 'pause-circle' : 'play-circle'}
            size={80}
            color={C.accentFg}
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={skipToNext}>
          <Icon name="skip-next" size={48} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity onPress={shuffleQueue}>
          <Icon name="shuffle" size={28} color={shuffleColor} />
        </TouchableOpacity>
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
        visible={playlistPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPlaylistPickerOpen(false)}>
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setPlaylistPickerOpen(false)}>
          <Pressable style={styles.modalCard} onPress={noop}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add to Playlist</Text>
              <TouchableOpacity onPress={() => setPlaylistPickerOpen(false)}>
                <Icon name="close" size={20} color={C.textDim} />
              </TouchableOpacity>
            </View>

            <Text style={styles.playlistPickerSubtitle} numberOfLines={2}>
              {displayTrack?.title || 'Select a playlist'}
            </Text>

            <FlatList
              data={playlistOptions}
              keyExtractor={queueKeyExtractor}
              style={styles.playlistPickerList}
              contentContainerStyle={styles.playlistPickerContent}
              removeClippedSubviews={true}
              maxToRenderPerBatch={8}
              windowSize={6}
              initialNumToRender={8}
              renderItem={({item}) => (
                <TouchableOpacity
                  style={styles.playlistPickerItem}
                  onPress={() => addCurrentTrackToPlaylist(item)}>
                  <View style={styles.playlistPickerMeta}>
                    <Text style={styles.playlistPickerName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.playlistPickerCount} numberOfLines={1}>
                      {Array.isArray(item.songs) ? item.songs.length : 0} songs
                    </Text>
                  </View>
                  <Icon name="plus" size={20} color={C.accentFg} />
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>

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
                removeClippedSubviews={true}
                maxToRenderPerBatch={10}
                windowSize={8}
                initialNumToRender={10}
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
