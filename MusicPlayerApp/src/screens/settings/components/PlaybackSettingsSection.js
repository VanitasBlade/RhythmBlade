import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Animated, Easing, Text, View} from 'react-native';
import Slider from '@react-native-community/slider';

import playbackService from '../../../services/playback/PlaybackService';
import storageService from '../../../services/storage/StorageService';
import {MUSIC_HOME_THEME as C} from '../../../theme/musicHomeTheme';
import styles from '../settings.styles';

const CROSSFADE_EXPANDED_MAX_HEIGHT = 56;

const PlaybackSettingsSection = ({
  SectionComponent,
  RowComponent,
  ToggleComponent,
}) => {
  const [autoContinueEnabled, setAutoContinueEnabled] = useState(true);
  const [loopLibraryPlaylist, setLoopLibraryPlaylist] = useState(false);
  const [normalizeVolume, setNormalizeVolume] = useState(true);
  const [crossfadeEnabled, setCrossfadeEnabled] = useState(false);
  const [crossfadeDuration, setCrossfadeDuration] = useState(5);
  const [shuffleByDefault, setShuffleByDefault] = useState(false);
  const crossfadeExpandAnim = useRef(new Animated.Value(0)).current;

  const persistAutoContinueSetting = useCallback(async enabled => {
    const normalizedEnabled = enabled !== false;
    const settings = await storageService.getSettings();
    await storageService.saveSettings({
      ...settings,
      autoContinueEnabled: normalizedEnabled,
    });
    return normalizedEnabled;
  }, []);

  const onAutoContinueToggle = useCallback(
    async nextValue => {
      const normalizedEnabled = nextValue !== false;
      setAutoContinueEnabled(normalizedEnabled);
      playbackService.setAutoContinueEnabled(normalizedEnabled);
      try {
        await persistAutoContinueSetting(normalizedEnabled);
      } catch (error) {
        console.error('Could not persist auto-continue setting:', error);
      }
    },
    [persistAutoContinueSetting],
  );

  const persistLoopLibraryPlaylistSetting = useCallback(async enabled => {
    const normalizedEnabled = enabled === true;
    const settings = await storageService.getSettings();
    await storageService.saveSettings({
      ...settings,
      loopLibraryPlaylistEnabled: normalizedEnabled,
    });
    return normalizedEnabled;
  }, []);

  const onLoopLibraryPlaylistToggle = useCallback(
    async nextValue => {
      const normalizedEnabled = nextValue === true;
      setLoopLibraryPlaylist(normalizedEnabled);
      playbackService.setLoopLibraryPlaylistEnabled(normalizedEnabled);
      try {
        await persistLoopLibraryPlaylistSetting(normalizedEnabled);
      } catch (error) {
        console.error(
          'Could not persist loop library/playlist setting:',
          error,
        );
      }
    },
    [persistLoopLibraryPlaylistSetting],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const settings = await storageService.getSettings();
        if (!active) {
          return;
        }
        const enabled = settings?.autoContinueEnabled !== false;
        const loopEnabled = settings?.loopLibraryPlaylistEnabled === true;
        setAutoContinueEnabled(enabled);
        setLoopLibraryPlaylist(loopEnabled);
        playbackService.setAutoContinueEnabled(enabled);
        playbackService.setLoopLibraryPlaylistEnabled(loopEnabled);
      } catch (error) {
        console.error('Could not load playback settings:', error);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    Animated.timing(crossfadeExpandAnim, {
      toValue: crossfadeEnabled ? CROSSFADE_EXPANDED_MAX_HEIGHT : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [crossfadeEnabled, crossfadeExpandAnim]);

  const crossfadeOpacity = useMemo(
    () =>
      crossfadeExpandAnim.interpolate({
        inputRange: [0, CROSSFADE_EXPANDED_MAX_HEIGHT],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
    [crossfadeExpandAnim],
  );

  if (
    typeof SectionComponent !== 'function' ||
    typeof RowComponent !== 'function' ||
    typeof ToggleComponent !== 'function'
  ) {
    return null;
  }

  return (
    <SectionComponent title="PLAYBACK">
      <RowComponent
        icon="play-circle-outline"
        title="Auto-continue"
        subtitle="Automatically plays the next song in queue"
        rightElement={
          <ToggleComponent
            value={autoContinueEnabled}
            onValueChange={onAutoContinueToggle}
          />
        }
      />
      <RowComponent
        icon="repeat"
        title="Loop Library/Playlist"
        subtitle="Restart when playlist/library ends"
        rightElement={
          <ToggleComponent
            value={loopLibraryPlaylist}
            onValueChange={onLoopLibraryPlaylistToggle}
          />
        }
      />
      <RowComponent
        icon="volume-high"
        title="Normalize Volume"
        subtitle="Balance loudness across tracks"
        rightElement={
          <ToggleComponent
            value={normalizeVolume}
            onValueChange={setNormalizeVolume}
          />
        }
      />
      <RowComponent
        icon="transition"
        title="Crossfade"
        subtitle="Smooth transition between tracks"
        rightElement={
          <ToggleComponent
            value={crossfadeEnabled}
            onValueChange={setCrossfadeEnabled}
          />
        }
        isLast={!crossfadeEnabled}
      />
      <Animated.View
        style={[
          styles.crossfadeExpandWrap,
          crossfadeEnabled
            ? styles.crossfadeExpandWrapOpen
            : styles.crossfadeExpandWrapClosed,
          {
            maxHeight: crossfadeExpandAnim,
            opacity: crossfadeOpacity,
          },
        ]}>
        <View style={styles.crossfadeExpandContent}>
          <Slider
            minimumValue={1}
            maximumValue={12}
            step={1}
            value={crossfadeDuration}
            onValueChange={setCrossfadeDuration}
            minimumTrackTintColor={C.accent}
            maximumTrackTintColor={C.border}
            thumbTintColor={C.accentFg}
            style={styles.crossfadeSlider}
          />
          <Text style={styles.crossfadeDurationText}>{crossfadeDuration}s</Text>
        </View>
      </Animated.View>
      <RowComponent
        icon="shuffle-variant"
        title="Shuffle by default"
        subtitle="Start every session in shuffle mode"
        rightElement={
          <ToggleComponent
            value={shuffleByDefault}
            onValueChange={setShuffleByDefault}
          />
        }
        isLast
      />
    </SectionComponent>
  );
};

export default PlaybackSettingsSection;
