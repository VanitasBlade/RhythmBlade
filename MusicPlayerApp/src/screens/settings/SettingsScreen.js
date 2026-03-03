import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  Image,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import Slider from '@react-native-community/slider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {toPathFromUri} from '../../services/storage/storage.helpers';
import {MUSIC_HOME_THEME as C} from '../../theme/musicHomeTheme';
import styles from './settings.styles';

const CROSSFade_EXPANDED_MAX_HEIGHT = 56;

const ToggleSwitch = ({value, onValueChange, disabled = false}) => (
  <Switch
    value={Boolean(value)}
    onValueChange={onValueChange}
    disabled={disabled}
    thumbColor={value ? C.accentFg : '#a7a0be'}
    trackColor={{
      false: C.border,
      true: C.accent,
    }}
  />
);

const SettingsRow = ({
  icon,
  title,
  subtitle,
  rightElement = null,
  onPress = null,
  showChevron = false,
  disabled = false,
  isLast = false,
}) => {
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      activeOpacity={onPress && !disabled ? 0.75 : 1}
      onPress={onPress && !disabled ? onPress : undefined}
      style={[
        styles.settingsRow,
        !isLast && styles.settingsRowDivider,
        disabled && styles.settingsRowDisabled,
      ]}>
      <View style={styles.settingsRowLeft}>
        <View style={styles.settingsRowIconWrap}>
          <Icon name={icon} size={16} color={C.accentFg} />
        </View>
        <View style={styles.settingsRowTextWrap}>
          <Text style={styles.settingsRowTitle}>{title}</Text>
          {!!subtitle && (
            <Text style={styles.settingsRowSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.settingsRowRight}>
        {rightElement}
        {showChevron ? (
          <Icon name="chevron-right" size={18} color={C.textDeep} />
        ) : null}
      </View>
    </Wrapper>
  );
};

const SettingsSection = ({title, children}) => (
  <View style={styles.sectionWrap}>
    <Text style={styles.sectionLabel}>{title}</Text>
    <View style={styles.sectionCard}>{children}</View>
  </View>
);

const SettingsScreen = () => {
  const [avatarDataUri, setAvatarDataUri] = useState('');
  const [displayName, setDisplayName] = useState('Your Name');
  const [nameDraft, setNameDraft] = useState('Your Name');
  const [activeInput, setActiveInput] = useState(null);
  const [downloadLocation, setDownloadLocation] = useState('/Music/Downloads');
  const [locationDraft, setLocationDraft] = useState('/Music/Downloads');

  const [autoPlay, setAutoPlay] = useState(true);
  const [normalizeVolume, setNormalizeVolume] = useState(true);
  const [crossfadeEnabled, setCrossfadeEnabled] = useState(false);
  const [crossfadeDuration, setCrossfadeDuration] = useState(5);
  const [shuffleByDefault, setShuffleByDefault] = useState(false);

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [highQualityStreaming, setHighQualityStreaming] = useState(false);
  const [darkModeEnabled] = useState(true);
  const [showLyrics, setShowLyrics] = useState(true);

  const [cacheStatusSubtitle, setCacheStatusSubtitle] = useState(
    'Frees up temporary storage',
  );

  const clearCacheTimerRef = useRef(null);
  const nameInputRef = useRef(null);
  const locationInputRef = useRef(null);
  const crossfadeExpandAnim = useRef(new Animated.Value(0)).current;

  const editingName = activeInput === 'name';
  const editingLocation = activeInput === 'location';

  const onAvatarChange = useCallback(nextAvatarDataUri => {
    setAvatarDataUri(String(nextAvatarDataUri || '').trim());
  }, []);

  const handleAvatarUpload = useCallback(async () => {
    try {
      const file = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.images],
        copyTo: 'cachesDirectory',
      });
      const sourceUri = String(file?.fileCopyUri || file?.uri || '').trim();
      const sourcePath = toPathFromUri(sourceUri);
      if (!sourcePath) {
        throw new Error('Selected image is not accessible.');
      }
      const imageBase64 = await RNFS.readFile(sourcePath, 'base64');
      if (!imageBase64) {
        throw new Error('Image file is empty.');
      }
      const mimeType =
        String(file?.type || 'image/jpeg').trim() || 'image/jpeg';
      onAvatarChange(`data:${mimeType};base64,${imageBase64}`);
    } catch (error) {
      if (!DocumentPicker.isCancel(error)) {
        console.error('Avatar upload failed:', error);
      }
    }
  }, [onAvatarChange]);

  const saveNameEdit = useCallback(() => {
    const nextName = String(nameDraft || '').trim() || 'Your Name';
    setDisplayName(nextName);
    setNameDraft(nextName);
    setActiveInput(current => (current === 'name' ? null : current));
  }, [nameDraft]);

  const startNameEdit = useCallback(() => {
    setLocationDraft(downloadLocation);
    setActiveInput('name');
  }, [downloadLocation]);

  const saveLocationEdit = useCallback(() => {
    const nextLocation =
      String(locationDraft || '').trim() || '/Music/Downloads';
    setDownloadLocation(nextLocation);
    setLocationDraft(nextLocation);
    setActiveInput(current => (current === 'location' ? null : current));
  }, [locationDraft]);

  const toggleLocationEdit = useCallback(() => {
    setNameDraft(displayName);
    setLocationDraft(downloadLocation);
    setActiveInput(current => (current === 'location' ? null : 'location'));
  }, [displayName, downloadLocation]);

  const clearCacheFeedback = useCallback(() => {
    setCacheStatusSubtitle('Cache cleared ✓');
    if (clearCacheTimerRef.current) {
      clearTimeout(clearCacheTimerRef.current);
    }
    clearCacheTimerRef.current = setTimeout(() => {
      setCacheStatusSubtitle('Frees up temporary storage');
      clearCacheTimerRef.current = null;
    }, 2000);
  }, []);

  useEffect(() => {
    if (editingName && nameInputRef.current?.focus) {
      nameInputRef.current.focus();
    }
  }, [editingName]);

  useEffect(() => {
    if (editingLocation && locationInputRef.current?.focus) {
      locationInputRef.current.focus();
    }
  }, [editingLocation]);

  useEffect(() => {
    Animated.timing(crossfadeExpandAnim, {
      toValue: crossfadeEnabled ? CROSSFade_EXPANDED_MAX_HEIGHT : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [crossfadeEnabled, crossfadeExpandAnim]);

  useEffect(
    () => () => {
      if (clearCacheTimerRef.current) {
        clearTimeout(clearCacheTimerRef.current);
      }
    },
    [],
  );

  const crossfadeOpacity = useMemo(
    () =>
      crossfadeExpandAnim.interpolate({
        inputRange: [0, CROSSFade_EXPANDED_MAX_HEIGHT],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
    [crossfadeExpandAnim],
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
          <Text style={styles.headerSubtitle}>Tune your experience</Text>
        </View>

        <View style={styles.sectionWrap}>
          <Text style={styles.sectionLabel}>PROFILE</Text>
          <View style={styles.profileCard}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleAvatarUpload}
              style={styles.avatarButton}>
              {avatarDataUri ? (
                <Image
                  source={{uri: avatarDataUri}}
                  style={styles.avatarImage}
                />
              ) : (
                <View style={styles.avatarFallbackWrap}>
                  <Text style={styles.avatarFallbackEmoji}>👤</Text>
                </View>
              )}
              <View style={styles.avatarOverlay}>
                <View style={styles.avatarOverlayIconWrap}>
                  <Icon name="camera" size={14} color="#ffffff" />
                </View>
              </View>
            </TouchableOpacity>

            <View style={styles.profileMetaWrap}>
              {editingName ? (
                <TextInput
                  ref={nameInputRef}
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  onSubmitEditing={saveNameEdit}
                  onBlur={saveNameEdit}
                  returnKeyType="done"
                  maxLength={48}
                  placeholder="Your Name"
                  placeholderTextColor={C.textMute}
                  style={styles.profileNameInput}
                />
              ) : (
                <View style={styles.profileNameRow}>
                  <Text style={styles.profileNameText} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <TouchableOpacity
                    activeOpacity={0.75}
                    onPress={startNameEdit}
                    style={styles.profileEditButton}>
                    <Icon name="pencil-outline" size={16} color={C.accentFg} />
                  </TouchableOpacity>
                </View>
              )}
              <Text style={styles.profileHint}>Tap photo to change</Text>
            </View>
          </View>
        </View>

        <SettingsSection title="DOWNLOADS">
          <SettingsRow
            icon="folder-outline"
            title="Save Location"
            subtitle={downloadLocation}
            rightElement={
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={toggleLocationEdit}
                style={styles.changeButton}>
                <Text style={styles.changeButtonText}>
                  {editingLocation ? 'Close' : 'Change'}
                </Text>
              </TouchableOpacity>
            }
            isLast={!editingLocation}
          />
          {editingLocation ? (
            <View style={styles.inlineInputWrap}>
              <TextInput
                ref={locationInputRef}
                value={locationDraft}
                onChangeText={setLocationDraft}
                onSubmitEditing={saveLocationEdit}
                placeholder="/Music/Downloads"
                placeholderTextColor={C.textMute}
                returnKeyType="done"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.inlineInput}
              />
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={saveLocationEdit}
                style={styles.inlineSaveButton}>
                <Text style={styles.inlineSaveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </SettingsSection>

        <SettingsSection title="PLAYBACK">
          <SettingsRow
            icon="play-circle-outline"
            title="Auto-play"
            subtitle="Continue playing after queue ends"
            rightElement={
              <ToggleSwitch value={autoPlay} onValueChange={setAutoPlay} />
            }
          />
          <SettingsRow
            icon="volume-high"
            title="Normalize Volume"
            subtitle="Balance loudness across tracks"
            rightElement={
              <ToggleSwitch
                value={normalizeVolume}
                onValueChange={setNormalizeVolume}
              />
            }
          />
          <SettingsRow
            icon="transition"
            title="Crossfade"
            subtitle="Smooth transition between tracks"
            rightElement={
              <ToggleSwitch
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
              <Text style={styles.crossfadeDurationText}>
                {crossfadeDuration}s
              </Text>
            </View>
          </Animated.View>
          <SettingsRow
            icon="shuffle-variant"
            title="Shuffle by default"
            subtitle="Start every session in shuffle mode"
            rightElement={
              <ToggleSwitch
                value={shuffleByDefault}
                onValueChange={setShuffleByDefault}
              />
            }
            isLast
          />
        </SettingsSection>

        <SettingsSection title="APP">
          <SettingsRow
            icon="bell-outline"
            title="Notifications"
            subtitle="Download complete alerts"
            rightElement={
              <ToggleSwitch
                value={notificationsEnabled}
                onValueChange={setNotificationsEnabled}
              />
            }
          />
          <SettingsRow
            icon="music-note-eighth"
            title="High Quality Streaming"
            subtitle="Uses more data on mobile"
            rightElement={
              <ToggleSwitch
                value={highQualityStreaming}
                onValueChange={setHighQualityStreaming}
              />
            }
          />
          <SettingsRow
            icon="theme-light-dark"
            title="Dark Mode"
            subtitle="Always on"
            rightElement={
              <ToggleSwitch
                value={darkModeEnabled}
                onValueChange={() => {}}
                disabled
              />
            }
            disabled
          />
          <SettingsRow
            icon="script-text-outline"
            title="Show Lyrics"
            subtitle="Display lyrics when available"
            rightElement={
              <ToggleSwitch value={showLyrics} onValueChange={setShowLyrics} />
            }
            isLast
          />
        </SettingsSection>

        <SettingsSection title="ABOUT">
          <SettingsRow
            icon="information-outline"
            title="Version"
            subtitle="1.0.0 — Build 42"
          />
          <SettingsRow
            icon="file-music-outline"
            title="Supported Formats"
            subtitle="MP3 · FLAC · AAC · OGG · WAV"
          />
          <SettingsRow
            icon="database-outline"
            title="Storage Used"
            subtitle="2.4 GB of music cached locally"
          />
          <SettingsRow
            icon="delete-sweep-outline"
            title="Clear Cache"
            subtitle={cacheStatusSubtitle}
            onPress={clearCacheFeedback}
            showChevron
          />
          <SettingsRow
            icon="shield-lock-outline"
            title="Privacy Policy"
            subtitle="View our data & privacy terms"
            onPress={() => {
              console.log('Privacy Policy tapped');
            }}
            showChevron
            isLast
          />
        </SettingsSection>
      </ScrollView>
    </View>
  );
};

export default SettingsScreen;
