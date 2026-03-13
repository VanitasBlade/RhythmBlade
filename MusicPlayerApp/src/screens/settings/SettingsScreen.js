import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import storageService from '../../services/storage/StorageService';
import {
  getExtensionFromSong,
  normalizeFileSourcePath,
  normalizeFormatLabel,
  toFileUriFromPath,
  toPathFromUri,
} from '../../services/storage/storage.helpers';
import { MUSIC_HOME_THEME as C } from '../../theme/musicHomeTheme';
import PlaybackSettingsSection from './components/PlaybackSettingsSection';
import styles from './settings.styles';

const PROFILE_AVATAR_DIR = `${RNFS.DocumentDirectoryPath}/profile`;
const STORAGE_USAGE_STALE_MS = 30000;
const STORAGE_USAGE_BAR_COLORS = [
  '#7c3aed',
  '#06b6d4',
  '#22c55e',
  '#f59e0b',
  '#ec4899',
  '#ef4444',
];
const PRIVACY_POLICY_ITEMS = [
  {
    heading: 'File Access',
    details:
      'Read access is used only for folders and files you choose to scan or import.',
  },
  {
    heading: 'Media & Audio Access',
    details:
      'Audio output access is required to play tracks through your device speakers, headphones, or connected audio devices.',
  },
  {
    heading: 'Write Access',
    details:
      'Downloaded songs and app-generated media files are written only to your selected save location.',
  },
  {
    heading: 'Notification Access',
    details:
      'Notifications are used for playback and download status updates when enabled by you.',
  },
  {
    heading: 'Background Activity',
    details:
      'Active downloads may continue while the app is in the background, subject to device battery and OS limits.',
  },
  {
    heading: 'Internet Usage',
    details:
      'An internet connection is required for search, bridge communication, and downloading tracks.',
  },
  {
    heading: 'Downloader Bridge',
    details:
      'When enabled, the downloader bridge loads and automates requests through tidal.squid.wtf.',
  },
  {
    heading: 'Third-Party Services',
    details:
      'Downloader features may rely on third-party services. Their own privacy policies and terms apply to their platforms.',
  },
  {
    heading: 'Local Data',
    details:
      'Settings, library metadata, and cached artwork are stored locally on your device.',
  },
  {
    heading: 'Data Collection',
    details:
      'The app does not upload your library or downloaded files to our servers. Online requests are only made to the services you use.',
  },
  {
    heading: 'Analytics & Crash Logs',
    details:
      'No built-in analytics or crash reporting service is enabled by default unless explicitly added in a future update.',
  },
  {
    heading: 'Copyright & DMCA',
    details:
      'You are responsible for ensuring your downloads and usage comply with copyright law, DMCA rules, and local regulations.',
  },
  {
    heading: 'Terms of Use',
    details:
      'By using downloader features, you agree to use them only for lawful, authorized, and personal purposes.',
  },
  {
    heading: 'Age Requirement',
    details:
      'This app is intended for users aged 13 and above. If local law requires a higher age, that rule applies.',
  },
  {
    heading: 'User Control',
    details:
      'You can disable bridge features, change save paths, and revoke storage permissions anytime.',
  },
  {
    heading: 'Your Privacy Rights',
    details:
      'You may request access, deletion, or export of app-stored data where applicable under laws such as GDPR or CCPA.',
  },
  {
    heading: 'Contact & Requests',
    details:
      'For privacy or data-rights requests, contact support@rhythmblade.app and include your request details.',
  },
];



function formatStorageBytes(bytes) {
  const size = Number(bytes) || 0;
  if (!Number.isFinite(size) || size <= 0) {
    return '0 MB';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[index]}`;
}

function formatFileCount(count) {
  const total = Math.max(0, Number(count) || 0);
  return `${total} file${total === 1 ? '' : 's'}`;
}

function toBarWidthPercent(percent) {
  const value = Number(percent) || 0;
  if (value <= 0) {
    return 0;
  }
  return Math.max(6, Math.min(100, Math.round(value * 100)));
}

function toAvatarExtension(file = {}) {
  const fromName = String(file?.name || '').match(/\.([a-z0-9]{2,5})$/i);
  if (fromName?.[1]) {
    return fromName[1].toLowerCase();
  }
  const fromMime = String(file?.type || '').split('/')[1] || '';
  const sanitized = fromMime.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (sanitized) {
    if (sanitized === 'jpeg') {
      return 'jpg';
    }
    return sanitized.slice(0, 5);
  }
  return 'jpg';
}

function isManagedAvatarPath(pathValue = '') {
  const normalizedPath = String(pathValue || '').trim();
  if (!normalizedPath) {
    return false;
  }
  const normalizedDir = String(PROFILE_AVATAR_DIR || '').replace(/\\/g, '/');
  const normalizedCandidate = normalizedPath.replace(/\\/g, '/');
  return normalizedCandidate.indexOf(normalizedDir + '/') === 0;
}

const ToggleSwitch = ({ value, onValueChange, disabled = false }) => (
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

const SettingsSection = ({ title, children }) => (
  <View style={styles.sectionWrap}>
    <Text style={styles.sectionLabel}>{title}</Text>
    <View style={styles.sectionCard}>{children}</View>
  </View>
);

const SettingsScreen = () => {
  const defaultDownloadLocation = useMemo(
    () => storageService.getPreferredMusicDir(),
    [],
  );
  const [avatarDataUri, setAvatarDataUri] = useState('');
  const [displayName, setDisplayName] = useState('Your Name');
  const [nameDraft, setNameDraft] = useState('Your Name');
  const [activeInput, setActiveInput] = useState(null);
  const [downloadLocation, setDownloadLocation] = useState(
    defaultDownloadLocation,
  );
  const [locationDraft, setLocationDraft] = useState(defaultDownloadLocation);
  const [autoEnableBridge, setAutoEnableBridge] = useState(true);
  const [autoDisableBridgeAfterInactivity, setAutoDisableBridgeAfterInactivity] =
    useState(false);
  const [autoConvertAacToMp3, setAutoConvertAacToMp3] = useState(false);

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled] = useState(true);
  const [storageUsageExpanded, setStorageUsageExpanded] = useState(false);
  const [storageUsageLoading, setStorageUsageLoading] = useState(false);
  const [storageUsageError, setStorageUsageError] = useState('');
  const [storageUsageTotalBytes, setStorageUsageTotalBytes] = useState(0);
  const [storageUsageTotalFiles, setStorageUsageTotalFiles] = useState(0);
  const [storageUsageUpdatedAt, setStorageUsageUpdatedAt] = useState(0);
  const [storageUsageBreakdown, setStorageUsageBreakdown] = useState([]);
  const [privacyPolicyExpanded, setPrivacyPolicyExpanded] = useState(false);

  const nameInputRef = useRef(null);
  const locationInputRef = useRef(null);
  const storageUsageRequestRef = useRef(0);

  const editingName = activeInput === 'name';
  const editingLocation = activeInput === 'location';
  const storageUsageSubtitle = useMemo(() => {
    if (storageUsageLoading) {
      return 'Calculating file usage...';
    }
    if (storageUsageError) {
      return 'Could not read storage usage';
    }
    if (storageUsageTotalFiles <= 0) {
      return 'No local music files indexed yet';
    }
    const totalBytesLabel = formatStorageBytes(storageUsageTotalBytes);
    const totalFilesLabel = formatFileCount(storageUsageTotalFiles);
    return `${totalBytesLabel} across ${totalFilesLabel}`;
  }, [
    storageUsageError,
    storageUsageLoading,
    storageUsageTotalBytes,
    storageUsageTotalFiles,
  ]);

  const onAvatarChange = useCallback(nextAvatarDataUri => {
    const normalizedAvatar = String(nextAvatarDataUri || '').trim();
    setAvatarDataUri(normalizedAvatar);
    (async () => {
      try {
        const previousAvatar = await storageService.getProfileAvatar();
        await storageService.saveProfileAvatar(normalizedAvatar);
        if (previousAvatar && previousAvatar !== normalizedAvatar) {
          const previousPath = toPathFromUri(previousAvatar);
          if (isManagedAvatarPath(previousPath)) {
            await RNFS.unlink(previousPath).catch(() => null);
          }
        }
      } catch (error) {
        console.error('Could not persist profile avatar:', error);
      }
    })();
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
      await RNFS.mkdir(PROFILE_AVATAR_DIR).catch(() => null);
      const extension = toAvatarExtension(file);
      const destinationPath = `${PROFILE_AVATAR_DIR}/avatar_${Date.now()}.${extension}`;
      await RNFS.copyFile(sourcePath, destinationPath);
      onAvatarChange(toFileUriFromPath(destinationPath));
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

  const persistDownloadLocation = useCallback(
    async nextLocationInput => {
      const nextLocation =
        normalizeFileSourcePath(nextLocationInput) || defaultDownloadLocation;
      const settings = await storageService.getSettings();
      await storageService.saveSettings({
        ...settings,
        downloadSaveLocation: nextLocation,
      });
      setDownloadLocation(nextLocation);
      setLocationDraft(nextLocation);
      return nextLocation;
    },
    [defaultDownloadLocation],
  );

  const persistDownloadPreferences = useCallback(async updates => {
    const settings = await storageService.getSettings();
    await storageService.saveSettings({
      ...settings,
      ...(updates || {}),
    });
  }, []);

  const onAutoEnableBridgeToggle = useCallback(
    async nextValue => {
      const enabled = nextValue !== false;
      setAutoEnableBridge(enabled);
      try {
        await persistDownloadPreferences({
          autoEnableBridge: enabled,
        });
      } catch (error) {
        console.error('Could not persist auto bridge setting:', error);
      }
    },
    [persistDownloadPreferences],
  );

  const onAutoConvertAacToMp3Toggle = useCallback(
    async nextValue => {
      const enabled = nextValue === true;
      setAutoConvertAacToMp3(enabled);
      try {
        await persistDownloadPreferences({
          autoConvertAacToMp3: enabled,
        });
      } catch (error) {
        console.error('Could not persist auto AAC conversion setting:', error);
      }
    },
    [persistDownloadPreferences],
  );

  const onAutoDisableBridgeAfterInactivityToggle = useCallback(
    async nextValue => {
      const enabled = nextValue === true;
      setAutoDisableBridgeAfterInactivity(enabled);
      try {
        await persistDownloadPreferences({
          autoDisableBridgeAfterInactivity: enabled,
        });
      } catch (error) {
        console.error('Could not persist bridge inactivity setting:', error);
      }
    },
    [persistDownloadPreferences],
  );

  const saveLocationEdit = useCallback(async () => {
    try {
      await persistDownloadLocation(locationDraft);
    } catch (error) {
      console.error('Could not save download location:', error);
    } finally {
      setActiveInput(current => (current === 'location' ? null : current));
    }
  }, [locationDraft, persistDownloadLocation]);

  const pickDownloadLocation = useCallback(async () => {
    if (editingLocation) {
      setActiveInput(current => (current === 'location' ? null : current));
      return;
    }

    if (typeof DocumentPicker.pickDirectory !== 'function') {
      setNameDraft(displayName);
      setLocationDraft(downloadLocation);
      setActiveInput('location');
      return;
    }

    try {
      const pickedDirectory = await DocumentPicker.pickDirectory();
      const sourceUri =
        typeof pickedDirectory === 'string'
          ? pickedDirectory
          : pickedDirectory?.uri;
      const resolvedPath = await storageService.resolveDirectoryUriToFilePath(
        sourceUri,
        true,
      );
      if (!resolvedPath) {
        throw new Error('Unable to resolve selected folder.');
      }
      await persistDownloadLocation(resolvedPath);
    } catch (error) {
      if (!DocumentPicker.isCancel(error)) {
        console.error('Could not pick download location:', error);
        setNameDraft(displayName);
        setLocationDraft(downloadLocation);
        setActiveInput('location');
      }
    }
  }, [displayName, downloadLocation, editingLocation, persistDownloadLocation]);

  const loadStorageUsage = useCallback(async () => {
    const requestId = storageUsageRequestRef.current + 1;
    storageUsageRequestRef.current = requestId;
    setStorageUsageLoading(true);
    setStorageUsageError('');
    try {
      const library = await storageService.getLocalLibrary();
      const songs = Array.isArray(library) ? library : [];
      const usageByFormat = new Map();
      const unresolvedSongs = [];

      songs.forEach(song => {
        const format = normalizeFormatLabel(getExtensionFromSong(song));
        const current = usageByFormat.get(format) || {
          format,
          bytes: 0,
          count: 0,
        };
        current.count += 1;
        const knownSize = Math.max(0, Number(song?.fileSizeBytes) || 0);
        if (knownSize > 0) {
          current.bytes += knownSize;
        } else {
          const path = storageService.resolveSongLocalPath(song);
          if (path) {
            unresolvedSongs.push({ format, path });
          }
        }
        usageByFormat.set(format, current);
      });

      const STAT_BATCH_SIZE = 8;
      for (
        let index = 0;
        index < unresolvedSongs.length;
        index += STAT_BATCH_SIZE
      ) {
        const batch = unresolvedSongs.slice(index, index + STAT_BATCH_SIZE);
        const stats = await Promise.all(
          batch.map(async entry => {
            const stat = await RNFS.stat(entry.path).catch(() => null);
            return {
              format: entry.format,
              bytes: Math.max(0, Number(stat?.size) || 0),
            };
          }),
        );

        stats.forEach(statEntry => {
          if (!statEntry.bytes) {
            return;
          }
          const target = usageByFormat.get(statEntry.format);
          if (target) {
            target.bytes += statEntry.bytes;
          }
        });
      }

      const usageItems = Array.from(usageByFormat.values()).filter(
        item => item.count > 0,
      );
      usageItems.sort(
        (left, right) =>
          right.bytes - left.bytes ||
          right.count - left.count ||
          left.format.localeCompare(right.format),
      );

      const totalBytes = usageItems.reduce(
        (sum, item) => sum + (Number(item.bytes) || 0),
        0,
      );
      const totalFiles = usageItems.reduce(
        (sum, item) => sum + (Number(item.count) || 0),
        0,
      );

      const breakdown = usageItems.map((item, index) => ({
        ...item,
        percent:
          totalBytes > 0 ? Math.max(0, Number(item.bytes) / totalBytes) : 0,
        color:
          STORAGE_USAGE_BAR_COLORS[index % STORAGE_USAGE_BAR_COLORS.length],
      }));

      if (storageUsageRequestRef.current !== requestId) {
        return;
      }
      setStorageUsageBreakdown(breakdown);
      setStorageUsageTotalBytes(totalBytes);
      setStorageUsageTotalFiles(totalFiles);
      setStorageUsageUpdatedAt(Date.now());
    } catch (error) {
      if (storageUsageRequestRef.current !== requestId) {
        return;
      }
      setStorageUsageError('Could not calculate usage from local library.');
    } finally {
      if (storageUsageRequestRef.current === requestId) {
        setStorageUsageLoading(false);
      }
    }
  }, []);

  const toggleStorageUsageExpanded = useCallback(() => {
    const nextExpanded = !storageUsageExpanded;
    setStorageUsageExpanded(nextExpanded);
    if (nextExpanded) {
      setPrivacyPolicyExpanded(false);
    }
    if (!nextExpanded) {
      return;
    }
    const staleByTime =
      Date.now() - storageUsageUpdatedAt > STORAGE_USAGE_STALE_MS;
    const hasNoData = storageUsageTotalFiles <= 0 && !storageUsageError;
    if (
      !storageUsageLoading &&
      (staleByTime || hasNoData || storageUsageError)
    ) {
      loadStorageUsage();
    }
  }, [
    loadStorageUsage,
    storageUsageError,
    storageUsageExpanded,
    storageUsageLoading,
    storageUsageTotalFiles,
    storageUsageUpdatedAt,
  ]);

  const togglePrivacyPolicyExpanded = useCallback(() => {
    setPrivacyPolicyExpanded(current => {
      const nextExpanded = !current;
      if (nextExpanded) {
        setStorageUsageExpanded(false);
      }
      return nextExpanded;
    });
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

  useEffect(
    () => () => {
      storageUsageRequestRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [savedAvatar, settings] = await Promise.all([
          storageService.getProfileAvatar(),
          storageService.getSettings(),
        ]);
        if (!active) {
          return;
        }
        setAvatarDataUri(savedAvatar);
        const savedDownloadLocation =
          normalizeFileSourcePath(settings?.downloadSaveLocation) ||
          defaultDownloadLocation;
        const savedAutoEnableBridge = settings?.autoEnableBridge !== false;
        const savedAutoDisableBridgeAfterInactivity =
          settings?.autoDisableBridgeAfterInactivity === true;
        const savedAutoConvertAacToMp3 =
          typeof settings?.autoConvertAacToMp3 === 'boolean'
            ? settings.autoConvertAacToMp3
            : settings?.convertAacToMp3 === true;
        setDownloadLocation(savedDownloadLocation);
        setLocationDraft(savedDownloadLocation);
        setAutoEnableBridge(savedAutoEnableBridge);
        setAutoDisableBridgeAfterInactivity(
          savedAutoDisableBridgeAfterInactivity,
        );
        setAutoConvertAacToMp3(savedAutoConvertAacToMp3);
      } catch (error) {
        console.error('Could not load profile avatar:', error);
      }
    })();
    return () => {
      active = false;
    };
  }, [defaultDownloadLocation]);

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
                  source={{ uri: avatarDataUri }}
                  style={styles.avatarImage}
                />
              ) : (
                <View style={styles.avatarFallbackWrap}>
                  <Text style={styles.avatarFallbackEmoji}>{'\u{1F464}'}</Text>
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
                onPress={pickDownloadLocation}
                style={styles.changeButton}>
                <Text style={styles.changeButtonText}>
                  {editingLocation ? 'Close' : 'Change'}
                </Text>
              </TouchableOpacity>
            }
          />
          {editingLocation ? (
            <View style={styles.inlineInputWrap}>
              <TextInput
                ref={locationInputRef}
                value={locationDraft}
                onChangeText={setLocationDraft}
                onSubmitEditing={saveLocationEdit}
                placeholder={defaultDownloadLocation}
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
          <SettingsRow
            icon="lan-connect"
            title="Auto Enable Bridge"
            subtitle="Automatically enables bridge on start"
            rightElement={
              <ToggleSwitch
                value={autoEnableBridge}
                onValueChange={onAutoEnableBridgeToggle}
                disabled={editingLocation}
              />
            }
          />
          <SettingsRow
            icon="shuffle-variant"
            title="Auto Disable Bridge (30s idle)"
            subtitle="Turns bridge off after 30s idle or 2m after leaving Downloader"
            rightElement={
              <ToggleSwitch
                value={autoDisableBridgeAfterInactivity}
                onValueChange={onAutoDisableBridgeAfterInactivityToggle}
                disabled={editingLocation}
              />
            }
          />
          <SettingsRow
            icon="shuffle-variant"
            title="Auto Convert AAC -> mp3"
            subtitle="Default convert to MP3 for AAC downloads"
            rightElement={
              <ToggleSwitch
                value={autoConvertAacToMp3}
                onValueChange={onAutoConvertAacToMp3Toggle}
                disabled={editingLocation}
              />
            }
            isLast
          />
        </SettingsSection>

        <PlaybackSettingsSection
          SectionComponent={SettingsSection}
          RowComponent={SettingsRow}
          ToggleComponent={ToggleSwitch}
        />

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
            icon="theme-light-dark"
            title="Dark Mode"
            subtitle="Always on"
            rightElement={
              <ToggleSwitch
                value={darkModeEnabled}
                onValueChange={() => { }}
                disabled
              />
            }
            disabled
            isLast
          />
        </SettingsSection>

        <SettingsSection title="ABOUT">
          <SettingsRow
            icon="information-outline"
            title="Version"
            subtitle="1.0.0 - Build 42"
          />
          <SettingsRow
            icon="file-music-outline"
            title="Supported Formats"
            subtitle="MP3 - FLAC - AAC - OGG - WAV"
          />
          <SettingsRow
            icon="database-outline"
            title="Storage Used"
            subtitle={storageUsageSubtitle}
            onPress={toggleStorageUsageExpanded}
            rightElement={
              <Icon
                name={storageUsageExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={C.textDeep}
              />
            }
          />
          {storageUsageExpanded ? (
            <View style={styles.storageUsageDropdown}>
              {storageUsageLoading ? (
                <View style={styles.storageUsageLoadingWrap}>
                  <ActivityIndicator size="small" color={C.accentFg} />
                  <Text style={styles.storageUsageLoadingText}>
                    Reading local library usage...
                  </Text>
                </View>
              ) : null}
              {!storageUsageLoading && storageUsageError ? (
                <Text style={styles.storageUsageErrorText}>
                  {storageUsageError}
                </Text>
              ) : null}
              {!storageUsageLoading &&
                !storageUsageError &&
                storageUsageBreakdown.length === 0 ? (
                <Text style={styles.storageUsageEmptyText}>
                  No indexed audio files available.
                </Text>
              ) : null}
              {!storageUsageLoading && !storageUsageError
                ? storageUsageBreakdown.map(item => {
                  const itemMeta = `${formatStorageBytes(
                    item.bytes,
                  )} \u2022 ${formatFileCount(item.count)}`;
                  return (
                    <View key={item.format} style={styles.storageUsageItem}>
                      <View style={styles.storageUsageItemHeader}>
                        <Text style={styles.storageUsageFormatText}>
                          {item.format}
                        </Text>
                        <Text style={styles.storageUsageItemMetaText}>
                          {itemMeta}
                        </Text>
                      </View>
                      <View style={styles.storageUsageBarTrack}>
                        <View
                          style={[
                            styles.storageUsageBarFill,
                            {
                              width: `${toBarWidthPercent(item.percent)}%`,
                              backgroundColor: item.color,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })
                : null}
            </View>
          ) : null}
          <SettingsRow
            icon="shield-lock-outline"
            title="Privacy Policy"
            subtitle="View our data & privacy terms"
            onPress={togglePrivacyPolicyExpanded}
            rightElement={
              <Icon
                name={privacyPolicyExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={C.textDeep}
              />
            }
            isLast={!privacyPolicyExpanded}
          />
          {privacyPolicyExpanded ? (
            <View style={styles.privacyPolicyDropdown}>
              <Text style={styles.privacyPolicyIntro}>
                We use only the permissions required for playback, import, and
                downloading.
              </Text>
              <Text style={styles.privacyPolicyLastUpdated}>
                Last updated: March 3, 2026
              </Text>
              {PRIVACY_POLICY_ITEMS.map(item => (
                <View key={item.heading} style={styles.privacyPolicyItem}>
                  <Text style={styles.privacyPolicyItemHeading}>
                    {item.heading}
                  </Text>
                  <Text style={styles.privacyPolicyItemDetails}>
                    {item.details}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </SettingsSection>
      </ScrollView>
    </View>
  );
};

export default SettingsScreen;
