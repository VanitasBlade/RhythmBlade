import { useFocusEffect } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  InteractionManager,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import playbackService from '../../services/playback/PlaybackService';
import storageService from '../../services/storage/StorageService';
import {
  MUSIC_HOME_THEME as C,
  MUSIC_HOME_ART_COLORS,
  PLAYLIST_EMOJIS,
} from '../../theme/musicHomeTheme';
import { ART_KEYS } from '../library/library.constants';
import SongCard from './SongCard';
import styles from './home.styles';

const getPlaylistColor = index => {
  const key = ART_KEYS[index % ART_KEYS.length];
  return MUSIC_HOME_ART_COLORS[key] || MUSIC_HOME_ART_COLORS.purple;
};

const SONG_ITEM_HEIGHT = 78;
const PLAYLIST_ITEM_SIZE = 112;
const PLAYLIST_LIST_HEIGHT = 132;
const PLAYLIST_LIST_VIEWPORT_WIDTH = Math.max(
  Dimensions.get('window').width - 32,
  PLAYLIST_ITEM_SIZE,
);
const RECENT_TRACKS_LIMIT = 5;
const idKeyExtractor = item => String(item?.id ?? '');
const playlistListSize = {
  height: PLAYLIST_LIST_HEIGHT,
  width: PLAYLIST_LIST_VIEWPORT_WIDTH,
};

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

const areSongListsEquivalent = (left = [], right = []) => {
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

const areSyncStatesEquivalent = (left = {}, right = {}) =>
  Boolean(left?.isRunning) === Boolean(right?.isRunning) &&
  (Number(left?.startedAt) || 0) === (Number(right?.startedAt) || 0) &&
  (Number(left?.completedAt) || 0) === (Number(right?.completedAt) || 0) &&
  (Number(left?.lastSyncedAt) || 0) === (Number(right?.lastSyncedAt) || 0) &&
  String(left?.error || '') === String(right?.error || '');

const HomeListHeader = React.memo(
  ({
    search,
    onSearchChange,
    isSyncing,
    onTriggerSync,
    onOpenSettings,
    onOpenLibrary,
    onOpenDownloader,
    onOpenPlaylists,
    playlists,
    profileAvatarDataUri,
    renderPlaylistCard,
    playlistKeyExtractor,
    onRefresh,
  }) => (
    <View>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Home</Text>
          <Text style={styles.headerSubtitle}>
            Your library at a glance
          </Text>
        </View>

        <TouchableOpacity
          style={styles.headerAction}
          onPress={onOpenSettings}>
          {profileAvatarDataUri ? (
            <Image
              source={{ uri: profileAvatarDataUri }}
              style={styles.profileImage}
            />
          ) : (
            <Text style={styles.profileInitial}>U</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Icon name="magnify" size={18} color={C.textMute} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search your recent tracks"
          placeholderTextColor={C.textMute}
          value={search}
          onChangeText={onSearchChange}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      <TouchableOpacity
        style={styles.syncBanner}
        activeOpacity={0.9}
        onPress={onTriggerSync}
        disabled={Boolean(isSyncing)}>
        {isSyncing ? (
          <ActivityIndicator size="small" color={C.accentFg} />
        ) : (
          <Icon name="refresh" size={16} color={C.accentFg} />
        )}
        <Text style={styles.syncBannerText}>
          {isSyncing ? 'Updating library in background' : 'Update Library'}
        </Text>
      </TouchableOpacity>

      <View style={styles.quickActionsRow}>
        <TouchableOpacity
          style={[styles.quickActionCard, styles.quickActionGap]}
          onPress={onOpenLibrary}>
          <Icon name="music-box-multiple" size={20} color={C.accentFg} />
          <Text style={styles.quickActionLabel}>Library</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickActionCard}
          onPress={onOpenDownloader}>
          <Icon
            name="cloud-download-outline"
            size={20}
            color={C.accentFg}
          />
          <Text style={styles.quickActionLabel}>Downloader</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Playlists</Text>
        <TouchableOpacity onPress={onOpenPlaylists}>
          <Text style={styles.sectionAction}>View all</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.playlistsListWrap}>
        <FlashList
          horizontal
          data={playlists}
          renderItem={renderPlaylistCard}
          keyExtractor={playlistKeyExtractor}
          estimatedItemSize={PLAYLIST_ITEM_SIZE}
          estimatedListSize={playlistListSize}
          disableHorizontalListHeightMeasurement
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          contentContainerStyle={styles.playlistsRow}
          drawDistance={PLAYLIST_ITEM_SIZE * 2}
        />
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Recent Tracks</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Text style={styles.sectionAction}>Refresh</Text>
        </TouchableOpacity>
      </View>
    </View>
  ),
);

HomeListHeader.displayName = 'HomeListHeader';

const HomeScreen = ({ navigation }) => {
  const [recentSongs, setRecentSongs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profileAvatarDataUri, setProfileAvatarDataUri] = useState('');
  const [syncState, setSyncState] = useState(() =>
    storageService.getLibrarySyncState(),
  );
  const previousSyncRunningRef = useRef(
    Boolean(storageService.getLibrarySyncState()?.isRunning),
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [library, playlistData, avatarUri] = await Promise.all([
        storageService.getLocalLibrary(),
        storageService.getPlaylists(),
        storageService.getProfileAvatar(),
      ]);

      const recent = [...library]
        .sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0))
        .slice(0, RECENT_TRACKS_LIMIT);

      const favorites =
        playlistData.find(playlist =>
          storageService.isFavoritesPlaylist(playlist),
        ) || null;
      const nextFavoriteIds = new Set((favorites?.songs || []).map(song => song.id));

      setRecentSongs(prev => (areSongListsEquivalent(prev, recent) ? prev : recent));
      setPlaylists(prev =>
        arePlaylistsEquivalent(prev, playlistData) ? prev : playlistData,
      );
      setFavoriteIds(prev =>
        areSetsEqual(prev, nextFavoriteIds) ? prev : nextFavoriteIds,
      );
      const nextAvatar = String(avatarUri || '').trim();
      setProfileAvatarDataUri(prev => (prev === nextAvatar ? prev : nextAvatar));
    } catch (error) {
      console.error('Error loading home data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const task = InteractionManager.runAfterInteractions(() => {
        if (active) {
          loadData();
        }
      });

      return () => {
        active = false;
        task.cancel();
      };
    }, [loadData]),
  );

  useEffect(() => {
    const unsubscribe = storageService.subscribeToLibrarySync(nextState => {
      const wasRunning = previousSyncRunningRef.current;
      const isRunning = Boolean(nextState?.isRunning);
      previousSyncRunningRef.current = isRunning;
      const normalizedNext = nextState || {};
      setSyncState(prev =>
        areSyncStatesEquivalent(prev, normalizedNext) ? prev : normalizedNext,
      );
      if (wasRunning && !isRunning) {
        loadData();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const triggerLibrarySync = useCallback(async () => {
    try {
      await storageService.runLibrarySyncInBackground({
        promptForPermission: true,
      });
    } catch (error) {
      console.error('Manual library sync failed:', error);
    }
  }, []);

  const filteredSongs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return recentSongs;
    }

    return recentSongs.filter(song => {
      const title = String(song.title || '').toLowerCase();
      const artist = String(song.artist || '').toLowerCase();
      return title.includes(query) || artist.includes(query);
    });
  }, [recentSongs, search]);

  const playSong = useCallback(
    async index => {
      const nextTrack = filteredSongs[index];
      if (!nextTrack) {
        return;
      }

      try {
        await playbackService.playSongs(filteredSongs, { startIndex: index });
        navigation.navigate('NowPlaying', {
          optimisticTrack: nextTrack,
          shuffleActive: false,
        });
      } catch (error) {
        console.error('Error playing song:', error);
      }
    },
    [filteredSongs, navigation],
  );

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
      console.error('Error toggling favorite:', error);
    }
  }, []);

  const openPlaylist = useCallback(
    playlist => {
      navigation.navigate('PlaylistDetail', { playlist });
    },
    [navigation],
  );

  const openSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  const openLibrary = useCallback(() => {
    navigation.navigate('Library');
  }, [navigation]);

  const openDownloader = useCallback(() => {
    navigation.navigate('Search');
  }, [navigation]);

  const openPlaylistsTab = useCallback(() => {
    navigation.navigate('Library', { libraryTab: 'playlists' });
  }, [navigation]);

  const renderPlaylistCard = useCallback(
    ({ item, index }) => {
      const color = getPlaylistColor(index);
      const emoji = PLAYLIST_EMOJIS[index % PLAYLIST_EMOJIS.length];
      return (
        <TouchableOpacity
          key={item.id}
          style={styles.playlistCard}
          onPress={() => openPlaylist(item)}>
          <View style={[styles.playlistArt, { backgroundColor: color }]}>
            <Text style={styles.playlistEmoji}>{emoji}</Text>
          </View>
          <Text style={styles.playlistName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.playlistCount} numberOfLines={1}>
            {item.songs.length} songs
          </Text>
        </TouchableOpacity>
      );
    },
    [openPlaylist],
  );

  const playlistKeyExtractor = useCallback(item => String(item?.id ?? ''), []);

  const listHeader = useMemo(
    () => (
      <HomeListHeader
        search={search}
        onSearchChange={setSearch}
        isSyncing={Boolean(syncState?.isRunning)}
        onTriggerSync={triggerLibrarySync}
        onOpenSettings={openSettings}
        onOpenLibrary={openLibrary}
        onOpenDownloader={openDownloader}
        onOpenPlaylists={openPlaylistsTab}
        playlists={playlists}
        profileAvatarDataUri={profileAvatarDataUri}
        renderPlaylistCard={renderPlaylistCard}
        playlistKeyExtractor={playlistKeyExtractor}
        onRefresh={onRefresh}
      />
    ),
    [
      onRefresh,
      openDownloader,
      openLibrary,
      openPlaylistsTab,
      openSettings,
      playlistKeyExtractor,
      playlists,
      profileAvatarDataUri,
      renderPlaylistCard,
      search,
      syncState?.isRunning,
      triggerLibrarySync,
    ],
  );

  const renderSongItem = useCallback(
    ({ item, index }) => (
      <SongCard
        item={item}
        index={index}
        isFavorite={favoriteIds.has(item.id)}
        onPress={playSong}
        onFavorite={toggleFavorite}
      />
    ),
    [favoriteIds, playSong, toggleFavorite],
  );

  const renderEmpty = useCallback(() => {
    if (loading) {
      return null;
    }

    const hasSearch = search.trim().length > 0;
    return (
      <View style={styles.emptyContainer}>
        <Icon
          name={hasSearch ? 'music-note-search' : 'music-off'}
          size={58}
          color={C.textMute}
        />
        <Text style={styles.emptyTitle}>
          {hasSearch ? 'No matching tracks' : 'No songs in your library'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {hasSearch
            ? 'Try searching for another title or artist.'
            : 'Download songs from the Downloader tab.'}
        </Text>
      </View>
    );
  }, [loading, search]);

  return (
    <View style={styles.container}>
      <FlashList
        data={filteredSongs}
        renderItem={renderSongItem}
        keyExtractor={idKeyExtractor}
        estimatedItemSize={SONG_ITEM_HEIGHT}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.accentFg}
          />
        }
        drawDistance={420}
      />
    </View>
  );
};

export default HomeScreen;
