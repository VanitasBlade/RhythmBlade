import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  State,
  useActiveTrack,
  usePlaybackState,
  useProgress,
} from 'react-native-track-player';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import playbackService from '../services/playback/PlaybackService';
import { MUSIC_HOME_THEME as C } from '../theme/musicHomeTheme';
import { formatTime } from '../utils/formatTime';

const TRACK_TRANSITION_HOLD_MS = 700;
const TAB_BAR_HEIGHT = 68;

const getTrackKey = track => String(track?.id || track?.url || '').trim();

const MiniPlayer = () => {
  const navigation = useNavigation();
  const playbackState = usePlaybackState();
  const track = useActiveTrack();
  const { position, duration } = useProgress(500);
  const [displayTrack, setDisplayTrack] = useState(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const artworkCacheRef = useRef({ trackKey: '', uri: '' });
  const displayTrackRef = useRef(null);
  const hideTimerRef = useRef(null);

  useEffect(() => {
    const nextKey = getTrackKey(track);

    if (nextKey) {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      displayTrackRef.current = track;
      setDisplayTrack(track);
      return;
    }

    const hasDisplayTrack = Boolean(getTrackKey(displayTrackRef.current));
    const currentState = playbackState?.state;
    const shouldHold =
      hasDisplayTrack &&
      currentState !== State.None &&
      currentState !== State.Stopped &&
      currentState !== State.Error;

    if (shouldHold) {
      if (!hideTimerRef.current) {
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null;
          displayTrackRef.current = null;
          setDisplayTrack(null);
        }, TRACK_TRANSITION_HOLD_MS);
      }
      return;
    }

    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    displayTrackRef.current = null;
    setDisplayTrack(null);
  }, [track, playbackState?.state]);

  useEffect(
    () => () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    const onShow = () => setKeyboardVisible(true);
    const onHide = () => setKeyboardVisible(false);
    const showSub = Keyboard.addListener('keyboardDidShow', onShow);
    const hideSub = Keyboard.addListener('keyboardDidHide', onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const displayArtworkUri = useMemo(() => {
    const key = getTrackKey(displayTrack);
    const uri = String(displayTrack?.artwork || '').trim();
    if (!key) {
      artworkCacheRef.current = { trackKey: '', uri: '' };
      return '';
    }
    if (key !== artworkCacheRef.current.trackKey) {
      artworkCacheRef.current = { trackKey: key, uri: uri || '' };
    } else if (uri) {
      artworkCacheRef.current.uri = uri;
    }
    return artworkCacheRef.current.uri;
  }, [displayTrack]);

  const isPlaying = playbackState.state === State.Playing;
  const progressPct =
    duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;

  const togglePlayback = useCallback(async () => {
    if (isPlaying) {
      await playbackService.pause();
    } else {
      await playbackService.play();
    }
  }, [isPlaying]);

  const skipToNext = useCallback(() => playbackService.skipToNext(), []);
  const skipToPrevious = useCallback(() => playbackService.skipToPrevious(), []);

  if (!displayTrack) {
    return null;
  }

  return (
    <View
      style={[
        styles.container,
        { bottom: keyboardVisible ? 0 : TAB_BAR_HEIGHT },
      ]}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
      </View>

      <TouchableOpacity
        style={styles.trackRow}
        activeOpacity={0.9}
        onPress={() =>
          navigation.navigate('NowPlaying', { optimisticTrack: displayTrack })
        }>
        {displayArtworkUri ? (
          <Image
            source={{ uri: displayArtworkUri }}
            style={styles.artwork}
            resizeMode="cover"
            fadeDuration={0}
          />
        ) : (
          <View style={styles.artworkFallback}>
            <Icon name="music-note" size={18} color={C.accentFg} />
          </View>
        )}

        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {displayTrack.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {displayTrack.artist}
          </Text>
        </View>

        <Text style={styles.time}>
          {formatTime(position)} / {formatTime(duration || displayTrack.duration)}
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
    bottom: TAB_BAR_HEIGHT,
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

export default React.memo(MiniPlayer);
