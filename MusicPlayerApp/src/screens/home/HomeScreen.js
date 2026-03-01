import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
const idKeyExtractor = item => item.id;

const HomeScreen = ({ navigation }) => {
  const [recentSongs, setRecentSongs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncState, setSyncState] = useState(() =>
    storageService.getLibrarySyncState(),
  );
  const previousSyncRunningRef = useRef(
    Boolean(storageService.getLibrarySyncState()?.isRunning),
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [library, playlistData] = await Promise.all([
        storageService.getLocalLibrary(),
        storageService.getPlaylists(),
      ]);

      const recent = [...library]
        .sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0))
        .slice(0, 30);

      const favorites =
        playlistData.find(playlist =>
          storageService.isFavoritesPlaylist(playlist),
        ) || null;

      setRecentSongs(recent);
      setPlaylists(playlistData);
      setFavoriteIds(new Set((favorites?.songs || []).map(song => song.id)));
    } catch (error) {
      console.error('Error loading home data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  useEffect(() => {
    const unsubscribe = storageService.subscribeToLibrarySync(nextState => {
      const wasRunning = previousSyncRunningRef.current;
      const isRunning = Boolean(nextState?.isRunning);
      previousSyncRunningRef.current = isRunning;
      setSyncState(nextState || {});
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
      setPlaylists(result.playlists);
      setFavoriteIds(new Set(result.playlist.songs.map(item => item.id)));
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

  const playlistKeyExtractor = useCallback(item => item.id, []);

  const getPlaylistItemLayout = useCallback(
    (_, index) => ({ length: 112, offset: 112 * index, index }),
    [],
  );

  const listHeader = useMemo(
    () => (
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
            onPress={() => navigation.navigate('Settings')}>
            <View style={styles.profilePlaceholder}>
              <Text style={styles.profileInitial}>U</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.searchWrap}>
          <Icon name="magnify" size={18} color={C.textMute} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search your recent tracks"
            placeholderTextColor={C.textMute}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        {syncState?.isRunning ? (
          <View style={styles.syncBanner}>
            <ActivityIndicator size="small" color={C.accentFg} />
            <Text style={styles.syncBannerText}>
              Updating library in background
            </Text>
          </View>
        ) : null}

        <View style={styles.quickActionsRow}>
          <TouchableOpacity
            style={[styles.quickActionCard, styles.quickActionGap]}
            onPress={() => navigation.navigate('Library')}>
            <Icon name="music-box-multiple" size={20} color={C.accentFg} />
            <Text style={styles.quickActionLabel}>Library</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => navigation.navigate('Search')}>
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
          <TouchableOpacity
            onPress={() =>
              navigation.navigate('Library', { libraryTab: 'playlists' })
            }>
            <Text style={styles.sectionAction}>View all</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          horizontal
          data={playlists}
          renderItem={renderPlaylistCard}
          keyExtractor={playlistKeyExtractor}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.playlistsRow}
          initialNumToRender={5}
          getItemLayout={getPlaylistItemLayout}
        />

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Recent Tracks</Text>
          <TouchableOpacity onPress={onRefresh}>
            <Text style={styles.sectionAction}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>
    ),
    [
      search,
      syncState?.isRunning,
      playlists,
      onRefresh,
      navigation,
      renderPlaylistCard,
      playlistKeyExtractor,
      getPlaylistItemLayout,
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

  const getItemLayout = useCallback(
    (_, index) => ({ length: SONG_ITEM_HEIGHT, offset: SONG_ITEM_HEIGHT * index, index }),
    [],
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredSongs}
        renderItem={renderSongItem}
        keyExtractor={idKeyExtractor}
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
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={10}
        initialNumToRender={12}
        getItemLayout={getItemLayout}
      />
    </View>
  );
};

export default HomeScreen;
