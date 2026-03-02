import { useFocusEffect } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import playbackService from '../../services/playback/PlaybackService';
import storageService from '../../services/storage/StorageService';
import {
  MUSIC_HOME_THEME as C,
  MUSIC_HOME_ART_COLORS,
} from '../../theme/musicHomeTheme';
import {
  ART_KEYS,
  PLAYLIST_ICONS,
  SORT_OPTIONS,
  SUB_TABS,
  TRACK_ICONS,
} from './library.constants';
import styles from './library.styles';
import {
  compactFolderPath,
  formatDuration,
  normalizeFormats,
  sortSongs,
} from './library.utils';
import TrackCard from './TrackCard';

const noop = () => { };
const idKeyExtractor = item => item.id;

const areSetsEqual = (left, right) => {
  if (left === right) {
    return true;
  }
  if (!(left instanceof Set) || !(right instanceof Set)) {
    return false;
  }
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
};

const areSongsEquivalent = (left = [], right = []) => {
  if (left === right) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const previous = left[index];
    const next = right[index];
    if (
      previous !== next &&
      (String(previous?.id || '') !== String(next?.id || '') ||
        String(previous?.title || '') !== String(next?.title || '') ||
        String(previous?.artist || '') !== String(next?.artist || '') ||
        String(previous?.artwork || '') !== String(next?.artwork || '') ||
        (Number(previous?.duration) || 0) !== (Number(next?.duration) || 0) ||
        (Number(previous?.addedAt) || 0) !== (Number(next?.addedAt) || 0))
    ) {
      return false;
    }
  }
  return true;
};

const arePlaylistsEquivalent = (left = [], right = []) => {
  if (left === right) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const previous = left[index];
    const next = right[index];
    if (
      previous !== next &&
      (String(previous?.id || '') !== String(next?.id || '') ||
        String(previous?.name || '') !== String(next?.name || '') ||
        String(previous?.description || '') !== String(next?.description || '') ||
        ((Array.isArray(previous?.songs) ? previous.songs.length : 0) !==
          (Array.isArray(next?.songs) ? next.songs.length : 0))
      )
    ) {
      return false;
    }
  }
  return true;
};

const areSourceListsEquivalent = (left = [], right = []) => {
  if (left === right) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const previous = left[index];
    const next = right[index];
    const previousFmt = Array.isArray(previous?.fmt) ? previous.fmt : [];
    const nextFmt = Array.isArray(next?.fmt) ? next.fmt : [];
    if (
      previous !== next &&
      (String(previous?.id || '') !== String(next?.id || '') ||
        String(previous?.path || '') !== String(next?.path || '') ||
        Boolean(previous?.on) !== Boolean(next?.on) ||
        (Number(previous?.count) || 0) !== (Number(next?.count) || 0) ||
        previousFmt.join('|') !== nextFmt.join('|'))
    ) {
      return false;
    }
  }
  return true;
};

const LibrarySubTabs = React.memo(({ activeTab, onTabPress }) => (
  <View style={styles.subTabs}>
    {SUB_TABS.map(item => {
      const active = item.id === activeTab;
      return (
        <TouchableOpacity
          key={item.id}
          style={styles.subTabBtn}
          onPress={() => onTabPress(item.id)}>
          <Text
            style={[styles.subTabText, active && styles.subTabTextActive]}>
            {item.label}
          </Text>
          {active ? <View style={styles.subTabLine} /> : null}
        </TouchableOpacity>
      );
    })}
  </View>
));

LibrarySubTabs.displayName = 'LibrarySubTabs';

const LibraryTrackControls = React.memo(
  ({
    trackCount,
    sortBy,
    sortOpen,
    onToggleSort,
    onSelectSort,
    onPlayAll,
    onShuffle,
  }) => (
    <>
      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            trackCount === 0 && styles.disabled,
          ]}
          onPress={onPlayAll}
          disabled={trackCount === 0}>
          <Icon name="play" size={14} color={C.accentFg} />
          <Text style={styles.primaryBtnText}>Play All</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.ghostBtn,
            trackCount === 0 && styles.disabled,
          ]}
          onPress={onShuffle}
          disabled={trackCount === 0}>
          <Icon name="shuffle" size={13} color={C.accentFg} />
          <Text style={styles.ghostBtnText}>Shuffle</Text>
        </TouchableOpacity>

        <View style={styles.sortWrap}>
          <TouchableOpacity
            style={styles.sortBtn}
            onPress={onToggleSort}>
            <Icon name="sort-variant" size={13} color={C.textDim} />
            <Text style={styles.sortBtnText}>{sortBy}</Text>
          </TouchableOpacity>
          {sortOpen ? (
            <View style={styles.sortMenu}>
              {SORT_OPTIONS.map(option => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.sortOption,
                    sortBy === option && styles.sortOptionActive,
                  ]}
                  onPress={() => onSelectSort(option)}>
                  <Text
                    style={[
                      styles.sortOptionText,
                      sortBy === option && styles.sortOptionTextActive,
                    ]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      <Text style={styles.metaText}>{trackCount} tracks</Text>
    </>
  ),
  (prevProps, nextProps) => (
    prevProps.trackCount === nextProps.trackCount &&
    prevProps.sortBy === nextProps.sortBy &&
    prevProps.sortOpen === nextProps.sortOpen &&
    prevProps.onToggleSort === nextProps.onToggleSort &&
    prevProps.onSelectSort === nextProps.onSelectSort &&
    prevProps.onPlayAll === nextProps.onPlayAll &&
    prevProps.onShuffle === nextProps.onShuffle
  ),
);

LibraryTrackControls.displayName = 'LibraryTrackControls';

const LibraryScreen = ({ navigation, route }) => {
  const [songs, setSongs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshingLibrary, setRefreshingLibrary] = useState(false);
  const [migratingArtwork, setMigratingArtwork] = useState(false);
  const [migratingDuration, setMigratingDuration] = useState(false);
  const [sourceImportState, setSourceImportState] = useState({
    visible: false,
    status: '',
    processed: 0,
    total: 0,
    importedCount: 0,
    skippedCount: 0,
    errorCount: 0,
  });

  const [tab, setTab] = useState('tracks');
  const [sortBy, setSortBy] = useState('Name');
  const [sortOpen, setSortOpen] = useState(false);

  const [playlistQuery, setPlaylistQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const [playlistPickerSong, setPlaylistPickerSong] = useState(null);
  const [songMenuState, setSongMenuState] = useState({
    visible: false,
    song: null,
    anchorX: 0,
    anchorY: 0,
  });

  const loadLibrary = useCallback(async () => {
    try {
      setLoading(true);
      const [library, playlistData, storedSources] = await Promise.all([
        storageService.getLocalLibrary(),
        storageService.getPlaylists(),
        storageService.getFileSources(),
      ]);

      const favorites =
        playlistData.find(item => storageService.isFavoritesPlaylist(item)) ||
        null;
      const nextFavoriteIds = new Set((favorites?.songs || []).map(song => song.id));

      setSongs(prev => (areSongsEquivalent(prev, library) ? prev : library));
      setPlaylists(prev =>
        arePlaylistsEquivalent(prev, playlistData) ? prev : playlistData,
      );
      setFavoriteIds(prev =>
        areSetsEqual(prev, nextFavoriteIds) ? prev : nextFavoriteIds,
      );
      setSources(prev =>
        areSourceListsEquivalent(prev, storedSources) ? prev : storedSources,
      );

      // Hydrate artwork and duration in parallel, then merge results to avoid
      // a race condition where whichever resolves last overwrites the other.
      const [artworkResult, durationResult] = await Promise.allSettled([
        storageService.hydrateArtworkForLibrary(library, 3),
        storageService.hydrateDurationForLibrary(library, 4),
      ]);
      const artworkLib =
        artworkResult.status === 'fulfilled' ? artworkResult.value : null;
      const durationLib =
        durationResult.status === 'fulfilled' ? durationResult.value : null;
      const base = artworkLib?.length ? artworkLib : library;
      if (durationLib?.length) {
        const durMap = new Map(durationLib.map(s => [s.id, s.duration]));
        const mergedSongs = base.map(s =>
          durMap.has(s.id) ? { ...s, duration: durMap.get(s.id) } : s,
        );
        setSongs(prev =>
          areSongsEquivalent(prev, mergedSongs) ? prev : mergedSongs,
        );
      } else if (base !== library) {
        setSongs(prev => (areSongsEquivalent(prev, base) ? prev : base));
      }
    } catch (error) {
      console.error('Error loading library:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const requested = String(route?.params?.libraryTab || '').toLowerCase();
      if (requested && SUB_TABS.some(item => item.id === requested)) {
        setTab(requested);
        navigation.setParams({ libraryTab: undefined });
      }
      let active = true;
      const task = InteractionManager.runAfterInteractions(() => {
        if (active) {
          loadLibrary();
        }
      });

      return () => {
        active = false;
        task.cancel();
      };
    }, [loadLibrary, navigation, route?.params?.libraryTab]),
  );

  const showLibraryMessage = useCallback((message, title = 'Library') => {
    if (!message) {
      return;
    }
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
      return;
    }
    Alert.alert(title, message);
  }, []);

  const onRefreshLibrary = useCallback(async () => {
    if (refreshingLibrary) {
      return;
    }

    setRefreshingLibrary(true);
    try {
      const activeTrack = await playbackService
        .getCurrentTrack()
        .catch(() => null);
      const activeTrackId = String(activeTrack?.id || '').trim();
      const activeTrackPath = storageService.resolveSongLocalPath(activeTrack);
      const activeTrackPathKey = storageService.toNormalizedPathKey(
        activeTrackPath || activeTrack?.url,
      );

      const summary = await storageService.refreshLibraryAcrossSources({
        recursive: true,
        promptForPermission: true,
        readEmbeddedTextMetadata: false,
      });

      if (summary?.permissionDenied) {
        Alert.alert(
          'Permission Required',
          'Audio file access is required to refresh your library.',
        );
        return;
      }

      const removedSongIdSet = new Set(summary?.removedSongIds || []);
      const removedPathKeySet = new Set(summary?.removedPathKeys || []);
      const activeTrackWasRemoved =
        (activeTrackId && removedSongIdSet.has(activeTrackId)) ||
        (activeTrackPathKey && removedPathKeySet.has(activeTrackPathKey));

      if (activeTrackWasRemoved) {
        await playbackService.reset();
        showLibraryMessage('Track no longer available', 'Playback');
      }

      await loadLibrary();
      if (!activeTrackWasRemoved) {
        showLibraryMessage('Library updated');
      }
    } catch (error) {
      Alert.alert(
        'Refresh Failed',
        error?.message || 'Could not refresh your library right now.',
      );
    } finally {
      setRefreshingLibrary(false);
    }
  }, [loadLibrary, refreshingLibrary, showLibraryMessage]);

  const sortedSongs = useMemo(() => sortSongs(songs, sortBy), [songs, sortBy]);

  const filteredPlaylists = useMemo(() => {
    const query = playlistQuery.trim().toLowerCase();
    if (!query) {
      return playlists;
    }
    return playlists.filter(item => {
      const name = String(item.name || '').toLowerCase();
      const desc = String(item.description || '').toLowerCase();
      return name.includes(query) || desc.includes(query);
    });
  }, [playlists, playlistQuery]);

  const playlistRows = useMemo(() => {
    const rows = [];
    for (let index = 0; index < filteredPlaylists.length; index += 2) {
      rows.push(filteredPlaylists.slice(index, index + 2));
    }
    return rows;
  }, [filteredPlaylists]);

  const selectablePlaylists = useMemo(
    () =>
      playlists.filter(item => !storageService.isFavoritesPlaylist(item)),
    [playlists],
  );

  const normalizedSources = useMemo(
    () =>
      sources.map(source => ({
        ...source,
        fmt: normalizeFormats(source),
        displayPath: compactFolderPath(source.path, 2),
      })),
    [sources],
  );

  const sourceSummary = useMemo(() => {
    const active = normalizedSources.filter(source => source.on).length;
    const files = normalizedSources.reduce(
      (sum, source) => sum + (Number(source.count) || 0),
      0,
    );
    return { active, files };
  }, [normalizedSources]);

  const importProgressFillStyle = useMemo(() => {
    const total = Math.max(0, Number(sourceImportState.total) || 0);
    const processed = Math.max(0, Number(sourceImportState.processed) || 0);
    if (total <= 0) {
      return { width: '12%' };
    }
    const percentage = Math.max(
      4,
      Math.min(100, Math.round((processed / total) * 100)),
    );
    return { width: `${percentage}%` };
  }, [sourceImportState.processed, sourceImportState.total]);

  const playSong = useCallback(async index => {
    const nextTrack = sortedSongs[index];
    if (!nextTrack) {
      return;
    }

    try {
      await playbackService.playSongs(sortedSongs, { startIndex: index });
      navigation.navigate('NowPlaying', {
        optimisticTrack: nextTrack,
        shuffleActive: false,
      });
    } catch (error) {
      console.error('Error playing song:', error);
      Alert.alert(
        'Playback Error',
        error.message || 'Could not play this track.',
      );
    }
  }, [sortedSongs, navigation]);

  const playAll = useCallback(async () => {
    if (!sortedSongs.length) {
      return;
    }

    const nextTrack = sortedSongs[0];

    try {
      await playbackService.playSongs(sortedSongs, { startIndex: 0 });
      navigation.navigate('NowPlaying', {
        optimisticTrack: nextTrack,
        shuffleActive: false,
      });
    } catch (error) {
      console.error('Error playing all songs:', error);
      Alert.alert(
        'Playback Error',
        error.message || 'Could not play songs right now.',
      );
    }
  }, [sortedSongs, navigation]);

  const shufflePlay = useCallback(async () => {
    if (!sortedSongs.length) {
      return;
    }
    const shuffled = [...sortedSongs];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[randomIndex]] = [
        shuffled[randomIndex],
        shuffled[index],
      ];
    }

    const nextTrack = shuffled[0];

    try {
      await playbackService.playSongs(shuffled, {
        startIndex: 0,
        shuffleEnabled: true,
        shuffleOriginalQueue: sortedSongs,
      });
      navigation.navigate('NowPlaying', {
        optimisticTrack: nextTrack,
        shuffleActive: true,
      });
    } catch (error) {
      console.error('Error shuffling songs:', error);
      Alert.alert(
        'Playback Error',
        error.message || 'Could not start shuffle playback.',
      );
    }
  }, [sortedSongs, navigation]);

  const deleteSong = useCallback(song => {
    Alert.alert('Delete Song', `Delete "${song.title}" from your library?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await storageService.deleteSongFile(song);
            await loadLibrary();
          } catch (error) {
            Alert.alert('Error', 'Failed to delete song');
          }
        },
      },
    ]);
  }, [loadLibrary]);

  const toggleFavorite = useCallback(async song => {
    try {
      const result = await storageService.toggleSongInFavorites(song);
      const nextPlaylists = Array.isArray(result?.playlists) ? result.playlists : [];
      const nextFavoriteIds = new Set(
        (result?.playlist?.songs || []).map(item => item.id),
      );
      setPlaylists(prev =>
        arePlaylistsEquivalent(prev, nextPlaylists) ? prev : nextPlaylists,
      );
      setFavoriteIds(prev =>
        areSetsEqual(prev, nextFavoriteIds) ? prev : nextFavoriteIds,
      );
    } catch (error) {
      Alert.alert('Error', 'Could not update favorites');
    }
  }, []);

  const closeSongMenu = useCallback(() => {
    setSongMenuState(prev =>
      prev.visible
        ? {
          visible: false,
          song: null,
          anchorX: 0,
          anchorY: 0,
        }
        : prev,
    );
  }, []);

  const openSongMenu = useCallback((song, event) => {
    if (!song) {
      return;
    }

    setSortOpen(false);
    const window = Dimensions.get('window');
    const fallbackX = Math.max(0, window.width - 16);
    const fallbackY = Math.max(0, window.height * 0.42);
    const rawX = Number(event?.nativeEvent?.pageX);
    const rawY = Number(event?.nativeEvent?.pageY);
    const anchorX = Number.isFinite(rawX) ? rawX : fallbackX;
    const anchorY = Number.isFinite(rawY) ? rawY : fallbackY;

    setSongMenuState({
      visible: true,
      song,
      anchorX,
      anchorY,
    });
  }, []);

  const runSongMenuAction = useCallback(
    action => {
      const targetSong = songMenuState.song;
      closeSongMenu();
      if (!targetSong) {
        return;
      }

      if (action === 'favorite') {
        toggleFavorite(targetSong);
        return;
      }

      if (action === 'playlist') {
        if (!selectablePlaylists.length) {
          Alert.alert(
            'No Playlists',
            'Create a playlist first, then add songs to it.',
          );
          return;
        }
        setPlaylistPickerSong(targetSong);
        setPlaylistPickerOpen(true);
        return;
      }

      if (action === 'delete') {
        deleteSong(targetSong);
      }
    },
    [
      closeSongMenu,
      deleteSong,
      selectablePlaylists,
      songMenuState.song,
      toggleFavorite,
    ],
  );

  const addSongToPlaylist = useCallback(
    async playlist => {
      const targetSong = playlistPickerSong;
      if (!playlist || !targetSong) {
        return;
      }

      try {
        const nextPlaylists = await storageService.addSongToPlaylist(
          playlist.id,
          targetSong,
        );
        setPlaylists(prev =>
          arePlaylistsEquivalent(prev, nextPlaylists) ? prev : nextPlaylists,
        );
        setPlaylistPickerOpen(false);
        setPlaylistPickerSong(null);
        Alert.alert(
          'Added to Playlist',
          `"${targetSong.title}" was added to "${playlist.name}".`,
        );
      } catch (error) {
        Alert.alert(
          'Add to Playlist Failed',
          error?.message || 'Could not add this song to the playlist.',
        );
      }
    },
    [playlistPickerSong],
  );

  const createPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) {
      Alert.alert('Error', 'Please enter a playlist name');
      return;
    }
    try {
      await storageService.createPlaylist(name, newPlaylistDesc.trim());
      setCreateOpen(false);
      setNewPlaylistName('');
      setNewPlaylistDesc('');
      await loadLibrary();
    } catch (error) {
      Alert.alert(
        'Create Playlist Failed',
        error.message || 'Could not create playlist',
      );
    }
  };

  const deletePlaylist = playlist => {
    if (storageService.isFavoritesPlaylist(playlist)) {
      Alert.alert(
        'Protected Playlist',
        'favorites is a default playlist and cannot be deleted.',
      );
      return;
    }
    Alert.alert('Delete Playlist', `Delete "${playlist.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await storageService.deletePlaylist(playlist.id);
            await loadLibrary();
          } catch (error) {
            Alert.alert('Error', error.message || 'Failed to delete playlist');
          }
        },
      },
    ]);
  };

  const addFileSource = async () => {
    try {
      if (typeof DocumentPicker.pickDirectory !== 'function') {
        Alert.alert(
          'Not Supported',
          'Folder selection is not supported on this device.',
        );
        return;
      }

      const pickedDirectory = await DocumentPicker.pickDirectory();
      const sourceUri =
        typeof pickedDirectory === 'string'
          ? pickedDirectory
          : pickedDirectory?.uri;

      if (!sourceUri) {
        throw new Error('No folder selected');
      }

      setSourceImportState({
        visible: true,
        status: 'Preparing import...',
        processed: 0,
        total: 0,
        importedCount: 0,
        skippedCount: 0,
        errorCount: 0,
      });

      const result = await storageService.importFolderAsFileSource(sourceUri, {
        recursive: true,
        onProgress: progress => {
          const total = Math.max(0, Number(progress?.total) || 0);
          const processed = Math.max(0, Number(progress?.processed) || 0);
          setSourceImportState(prev => ({
            ...prev,
            visible: true,
            status:
              progress?.status ||
              (total > 0
                ? `Extracting metadata... ${processed}/${total} files`
                : 'Extracting metadata...'),
            processed,
            total,
            importedCount: Math.max(
              0,
              Number(progress?.importedCount) || prev.importedCount,
            ),
            skippedCount: Math.max(
              0,
              Number(progress?.skippedCount) || prev.skippedCount,
            ),
            errorCount: Math.max(
              0,
              Number(progress?.errorCount) || prev.errorCount,
            ),
          }));
        },
      });
      const importedSources = Array.isArray(result?.fileSources)
        ? result.fileSources
        : [];
      setSources(prev =>
        areSourceListsEquivalent(prev, importedSources) ? prev : importedSources,
      );

      await loadLibrary();
      Alert.alert(
        'Import Complete',
        `${result.importedCount} file${result.importedCount === 1 ? '' : 's'
        } imported — album art and metadata extracted successfully.`,
        [{ text: 'OK' }],
      );
    } catch (error) {
      if (!DocumentPicker.isCancel(error)) {
        Alert.alert(
          'File Source Error',
          error.message || 'Unable to add file source.',
        );
      }
    } finally {
      setSourceImportState(prev => ({
        ...prev,
        visible: false,
      }));
    }
  };

  const toggleSource = async source => {
    try {
      const nextSources = await storageService.toggleFileSource(source.id);
      setSources(prev =>
        areSourceListsEquivalent(prev, nextSources) ? prev : nextSources,
      );
    } catch (error) {
      Alert.alert('Error', 'Could not update this source.');
    }
  };

  const migrateArtworkNow = async () => {
    if (migratingArtwork) {
      return;
    }

    try {
      setMigratingArtwork(true);
      const summary = await storageService.migrateAllArtworkNow({
        batchSize: 8,
        yieldMs: 0,
      });
      await loadLibrary();

      const updatedCount = Number(summary?.updatedCount) || 0;
      const extractedCount = Number(summary?.extractedCount) || 0;
      const inlineConvertedCount = Number(summary?.inlineConvertedCount) || 0;
      const processedCount = Number(summary?.processedCount) || 0;

      Alert.alert(
        'Artwork Migration Complete',
        `${updatedCount} track${updatedCount === 1 ? '' : 's'
        } updated (${extractedCount} extracted, ${inlineConvertedCount} inline converted).\nProcessed ${processedCount} candidate track${processedCount === 1 ? '' : 's'
        }.`,
      );
    } catch (error) {
      Alert.alert(
        'Migration Failed',
        error.message || 'Could not migrate artwork right now.',
      );
    } finally {
      setMigratingArtwork(false);
    }
  };

  const migrateDurationsNow = async () => {
    if (migratingDuration) {
      return;
    }

    try {
      setMigratingDuration(true);
      const summary = await storageService.migrateAllDurationsNow({
        batchSize: 10,
        yieldMs: 0,
      });
      await loadLibrary();

      const updatedCount = Number(summary?.updatedCount) || 0;
      const processedCount = Number(summary?.processedCount) || 0;
      const skippedCount = Number(summary?.skippedCount) || 0;

      Alert.alert(
        'Duration Migration Complete',
        `${updatedCount} track${updatedCount === 1 ? '' : 's'
        } updated.\nProcessed ${processedCount} candidate track${processedCount === 1 ? '' : 's'
        }, skipped ${skippedCount}.`,
      );
    } catch (error) {
      Alert.alert(
        'Migration Failed',
        error.message || 'Could not migrate durations right now.',
      );
    } finally {
      setMigratingDuration(false);
    }
  };

  const TRACK_ITEM_HEIGHT = 72;
  const SONG_MENU_WIDTH = 214;
  const SONG_MENU_HEIGHT = 186;

  const songMenuPositionStyle = useMemo(() => {
    const { width, height } = Dimensions.get('window');
    const inset = 10;
    const anchorX = Number(songMenuState.anchorX) || width - inset;
    const anchorY = Number(songMenuState.anchorY) || height / 2;

    let left = anchorX - SONG_MENU_WIDTH + 20;
    left = Math.max(inset, Math.min(left, width - SONG_MENU_WIDTH - inset));

    let top = anchorY + 8;
    if (top + SONG_MENU_HEIGHT > height - inset) {
      top = Math.max(inset, anchorY - SONG_MENU_HEIGHT - 8);
    }

    return { left, top };
  }, [songMenuState.anchorX, songMenuState.anchorY]);

  const renderTrackItem = useCallback(({ item, index }) => {
    const color =
      MUSIC_HOME_ART_COLORS[ART_KEYS[index % ART_KEYS.length]] || C.bgCard;
    const icon = TRACK_ICONS[index % TRACK_ICONS.length];
    return (
      <TrackCard
        item={item}
        rowIndex={index}
        color={color}
        icon={icon}
        duration={formatDuration(item.duration)}
        onPressRow={playSong}
        onLongPressRow={openSongMenu}
        onOptionsRow={openSongMenu}
      />
    );
  }, [openSongMenu, playSong]);

  const onTabPress = useCallback(id => {
    closeSongMenu();
    setSortOpen(false);
    setTab(id);
  }, [closeSongMenu]);

  const toggleSortMenu = useCallback(() => {
    setSortOpen(open => !open);
  }, []);

  const selectSortOption = useCallback(option => {
    setSortBy(option);
    setSortOpen(false);
  }, []);

  const songMenuIsFavorite = useMemo(
    () => Boolean(songMenuState.song?.id && favoriteIds.has(songMenuState.song.id)),
    [favoriteIds, songMenuState.song],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.navigate('Home')}>
          <Icon name="chevron-left" size={24} color={C.accentFg} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Library</Text>
      </View>

      <LibrarySubTabs activeTab={tab} onTabPress={onTabPress} />

      {tab === 'tracks' ? (
        <View style={styles.panel}>
          <LibraryTrackControls
            trackCount={sortedSongs.length}
            sortBy={sortBy}
            sortOpen={sortOpen}
            onToggleSort={toggleSortMenu}
            onSelectSort={selectSortOption}
            onPlayAll={playAll}
            onShuffle={shufflePlay}
          />

          <FlashList
            data={sortedSongs}
            renderItem={renderTrackItem}
            keyExtractor={idKeyExtractor}
            estimatedItemSize={TRACK_ITEM_HEIGHT}
            contentContainerStyle={styles.listContent}
            drawDistance={520}
            refreshControl={
              <RefreshControl
                refreshing={refreshingLibrary}
                onRefresh={onRefreshLibrary}
                tintColor={C.accentFg}
              />
            }
            ListEmptyComponent={
              loading ? null : (
                <View style={styles.emptyState}>
                  <Icon name="music-note-off" size={56} color={C.textMute} />
                  <Text style={styles.emptyTitle}>Your library is empty</Text>
                  <Text style={styles.emptySub}>
                    Add file sources in the Files tab to import songs.
                  </Text>
                </View>
              )
            }
          />
        </View>
      ) : null}

      {tab === 'playlists' ? (
        <View style={styles.panel}>
          <View style={styles.playlistSearchRow}>
            <View style={styles.searchBox}>
              <Icon name="magnify" size={18} color={C.textMute} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search playlists..."
                placeholderTextColor={C.textMute}
                value={playlistQuery}
                onChangeText={setPlaylistQuery}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            <TouchableOpacity
              style={styles.addPlaylistBtn}
              onPress={() => setCreateOpen(true)}>
              <Icon name="plus" size={20} color={C.bg} />
            </TouchableOpacity>
          </View>

          <Text style={styles.metaText}>
            {filteredPlaylists.length} playlists
          </Text>

          <ScrollView contentContainerStyle={styles.listContent}>
            {playlistRows.map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={styles.playlistRow}>
                {row.map((playlist, cardIndex) => {
                  const idx = rowIndex * 2 + cardIndex;
                  const color =
                    MUSIC_HOME_ART_COLORS[ART_KEYS[idx % ART_KEYS.length]] ||
                    C.bgCard;
                  const icon = PLAYLIST_ICONS[idx % PLAYLIST_ICONS.length];
                  const songCount = Array.isArray(playlist.songs)
                    ? playlist.songs.length
                    : 0;
                  return (
                    <TouchableOpacity
                      key={playlist.id}
                      style={styles.playlistCard}
                      onPress={() =>
                        navigation.navigate('PlaylistDetail', { playlist })
                      }
                      onLongPress={() => deletePlaylist(playlist)}>
                      <View
                        style={[
                          styles.playlistCover,
                          { backgroundColor: color },
                        ]}>
                        <Icon name={icon} size={34} color={C.accentFg} />
                      </View>
                      <Text style={styles.playlistName} numberOfLines={1}>
                        {playlist.name}
                      </Text>
                      <Text style={styles.playlistCount} numberOfLines={1}>
                        {songCount} Songs
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {row.length === 1 ? <View style={styles.playlistCard} /> : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {tab === 'files' ? (
        <View style={styles.panel}>
          <View style={styles.filesHeader}>
            <Text style={styles.filesLabel}>FILE SOURCES</Text>
            <Text style={styles.metaText}>
              {sourceSummary.files} files | {sourceSummary.active} active
              sources
            </Text>
          </View>

          <ScrollView contentContainerStyle={styles.listContent}>
            {normalizedSources.map(source => (
              <View
                key={source.id}
                style={[
                  styles.sourceCard,
                  !source.on && styles.sourceCardDisabled,
                ]}>
                <View
                  style={[
                    styles.sourceAccent,
                    source.on ? styles.sourceAccentOn : styles.sourceAccentOff,
                  ]}
                />
                <View style={styles.sourceBody}>
                  <View style={styles.sourceTop}>
                    <View style={styles.sourcePathWrap}>
                      <Icon
                        name="folder"
                        size={16}
                        color={source.on ? C.accentFg : C.textMute}
                      />
                      <Text
                        style={[
                          styles.sourcePath,
                          !source.on && styles.sourcePathDisabled,
                        ]}
                        numberOfLines={1}>
                        {source.displayPath || source.path}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.toggleTrack,
                        source.on && styles.toggleTrackOn,
                      ]}
                      onPress={() => toggleSource(source)}>
                      <View
                        style={[
                          styles.toggleThumb,
                          source.on && styles.toggleThumbOn,
                        ]}
                      />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.sourceBottom}>
                    <View style={styles.sourceCountWrap}>
                      <Icon name="music-note" size={15} color={C.textDim} />
                      <Text style={styles.sourceCount}>
                        {source.count} files
                      </Text>
                    </View>

                    <View style={styles.formatWrap}>
                      {source.fmt.map(fmt => (
                        <View
                          key={`${source.id}-${fmt}`}
                          style={styles.fmtChip}>
                          <Text
                            style={[
                              styles.fmtText,
                              !source.on && styles.fmtTextOff,
                            ]}>
                            {fmt}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            ))}

            <TouchableOpacity
              style={styles.addSourceBtn}
              onPress={addFileSource}>
              <Text style={styles.addSourceText}>+ Add file source</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.migrateArtworkBtn,
                migratingArtwork && styles.disabled,
              ]}
              onPress={migrateArtworkNow}
              disabled={migratingArtwork}>
              <Icon name="cached" size={18} color={C.accentFg} />
              <Text style={styles.migrateArtworkText}>
                {migratingArtwork
                  ? 'Migrating artwork...'
                  : 'Migrate Artwork Now (One-Time)'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.migrateArtworkBtn,
                migratingDuration && styles.disabled,
              ]}
              onPress={migrateDurationsNow}
              disabled={migratingDuration}>
              <Icon name="timer-outline" size={18} color={C.accentFg} />
              <Text style={styles.migrateArtworkText}>
                {migratingDuration
                  ? 'Migrating durations...'
                  : 'Migrate Durations Now (One-Time)'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      ) : null}

      {sortOpen ? (
        <Pressable style={styles.backdrop} onPress={() => setSortOpen(false)} />
      ) : null}

      <Modal
        visible={songMenuState.visible}
        transparent
        animationType="fade"
        onRequestClose={closeSongMenu}>
        <Pressable style={styles.songMenuBackdrop} onPress={closeSongMenu}>
          <Pressable
            style={[styles.songMenuCard, songMenuPositionStyle]}
            onPress={noop}>
            <View style={styles.songMenuHeader}>
              <Text style={styles.songMenuTitle} numberOfLines={1}>
                {songMenuState.song?.title || 'Track'}
              </Text>
              <Text style={styles.songMenuSubtitle} numberOfLines={1}>
                {songMenuState.song?.artist || 'Unknown artist'}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.songMenuItem}
              onPress={() => runSongMenuAction('favorite')}>
              <Icon
                name={songMenuIsFavorite ? 'heart-off-outline' : 'heart-outline'}
                size={18}
                color={C.accentFg}
              />
              <Text style={styles.songMenuItemText}>
                {songMenuIsFavorite
                  ? 'Remove from Favorites'
                  : 'Add to Favorites'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.songMenuItem}
              onPress={() => runSongMenuAction('playlist')}>
              <Icon name="playlist-plus" size={18} color={C.accentFg} />
              <Text style={styles.songMenuItemText}>Add to Playlist</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.songMenuItem, styles.songMenuItemDanger]}
              onPress={() => runSongMenuAction('delete')}>
              <Icon name="trash-can-outline" size={18} color="#f87171" />
              <Text style={[styles.songMenuItemText, styles.songMenuItemTextDanger]}>
                Delete Song
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={sourceImportState.visible}
        transparent
        animationType="fade"
        onRequestClose={() => { }}>
        <Pressable style={styles.modalOverlay} onPress={noop}>
          <Pressable style={styles.importProgressCard} onPress={noop}>
            <View style={styles.importProgressHeader}>
              <Text style={styles.importProgressTitle}>Importing Files</Text>
              <ActivityIndicator size="small" color={C.accentFg} />
            </View>
            <Text style={styles.importProgressStatus}>
              {sourceImportState.status || 'Extracting metadata...'}
            </Text>
            <View style={styles.importProgressTrack}>
              <View
                style={[styles.importProgressFill, importProgressFillStyle]}
              />
            </View>
            <Text style={styles.importProgressMeta}>
              Imported {sourceImportState.importedCount}
              {sourceImportState.skippedCount > 0
                ? ` • Skipped ${sourceImportState.skippedCount}`
                : ''}
              {sourceImportState.errorCount > 0
                ? ` • Errors ${sourceImportState.errorCount}`
                : ''}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={playlistPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setPlaylistPickerOpen(false);
          setPlaylistPickerSong(null);
        }}>
        <Pressable
          style={styles.modalOverlay}
          onPress={() => {
            setPlaylistPickerOpen(false);
            setPlaylistPickerSong(null);
          }}>
          <Pressable style={styles.modalCard} onPress={noop}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add to Playlist</Text>
              <TouchableOpacity
                onPress={() => {
                  setPlaylistPickerOpen(false);
                  setPlaylistPickerSong(null);
                }}>
                <Icon name="close" size={20} color={C.textDim} />
              </TouchableOpacity>
            </View>

            <Text style={styles.playlistPickerSubtitle} numberOfLines={2}>
              {playlistPickerSong?.title || 'Select a playlist'}
            </Text>

            <ScrollView
              style={styles.playlistPickerList}
              contentContainerStyle={styles.playlistPickerContent}>
              {selectablePlaylists.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.playlistPickerItem}
                  onPress={() => addSongToPlaylist(item)}>
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
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={createOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateOpen(false)}>
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setCreateOpen(false)}>
          <Pressable style={styles.modalCard} onPress={noop}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Playlist</Text>
              <TouchableOpacity onPress={() => setCreateOpen(false)}>
                <Icon name="close" size={20} color={C.textDim} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Playlist name"
              placeholderTextColor={C.textMute}
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
            />
            <TextInput
              style={[styles.modalInput, styles.modalTextArea]}
              placeholder="Description (optional)"
              placeholderTextColor={C.textMute}
              value={newPlaylistDesc}
              onChangeText={setNewPlaylistDesc}
              multiline
            />
            <TouchableOpacity
              style={styles.modalCreateBtn}
              onPress={createPlaylist}>
              <Text style={styles.modalCreateText}>Create</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

export default LibraryScreen;
