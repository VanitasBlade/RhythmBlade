import React, {useCallback, useMemo, useState} from 'react';
import {
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';

import playbackService from '../../services/playback/PlaybackService';
import storageService from '../../services/storage/StorageService';
import {
  MUSIC_HOME_ART_COLORS,
  MUSIC_HOME_THEME as C,
  PLAYLIST_EMOJIS,
} from '../../theme/musicHomeTheme';
import styles from './home.styles';

const ART_KEYS = Object.keys(MUSIC_HOME_ART_COLORS);

const getPlaylistColor = index => {
  const key = ART_KEYS[index % ART_KEYS.length];
  return MUSIC_HOME_ART_COLORS[key] || MUSIC_HOME_ART_COLORS.purple;
};

const HomeScreen = ({navigation}) => {
  const [recentSongs, setRecentSongs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

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

  const playSong = async index => {
    try {
      await playbackService.playSongs(filteredSongs, {startIndex: index});
      navigation.navigate('NowPlaying');
    } catch (error) {
      console.error('Error playing song:', error);
    }
  };

  const toggleFavorite = async song => {
    try {
      const result = await storageService.toggleSongInFavorites(song);
      setPlaylists(result.playlists);
      setFavoriteIds(new Set(result.playlist.songs.map(item => item.id)));
    } catch (error) {
      console.error('Error toggling favorite:', error);
    }
  };

  const openPlaylist = playlist => {
    navigation.navigate('PlaylistDetail', {playlist});
  };

  const renderTopContent = () => (
    <View>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Home</Text>
          <Text style={styles.headerSubtitle}>Your library at a glance</Text>
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
        />
      </View>

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
          <Icon name="cloud-download-outline" size={20} color={C.accentFg} />
          <Text style={styles.quickActionLabel}>Downloader</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Playlists</Text>
        <TouchableOpacity
          onPress={() =>
            navigation.navigate('Library', {libraryTab: 'playlists'})
          }>
          <Text style={styles.sectionAction}>View all</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.playlistsRow}>
        {playlists.map((playlist, index) => {
          const color = getPlaylistColor(index);
          const emoji = PLAYLIST_EMOJIS[index % PLAYLIST_EMOJIS.length];
          return (
            <TouchableOpacity
              key={playlist.id}
              style={styles.playlistCard}
              onPress={() => openPlaylist(playlist)}>
              <View style={[styles.playlistArt, {backgroundColor: color}]}>
                <Text style={styles.playlistEmoji}>{emoji}</Text>
              </View>
              <Text style={styles.playlistName} numberOfLines={1}>
                {playlist.name}
              </Text>
              <Text style={styles.playlistCount} numberOfLines={1}>
                {playlist.songs.length} songs
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Recent Tracks</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Text style={styles.sectionAction}>Refresh</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSongItem = ({item, index}) => {
    const isFavorite = favoriteIds.has(item.id);

    return (
      <View style={styles.songCard}>
        <TouchableOpacity
          style={styles.songMain}
          onPress={() => playSong(index)}
          activeOpacity={0.85}>
          {item.artwork ? (
            <Image source={{uri: item.artwork}} style={styles.songArtwork} />
          ) : (
            <View style={styles.songArtworkFallback}>
              <Icon name="music-note" size={20} color={C.accentFg} />
            </View>
          )}

          <View style={styles.songMeta}>
            <Text style={styles.songTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.songArtist} numberOfLines={1}>
              {item.artist}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.favoriteButton}
          onPress={() => toggleFavorite(item)}>
          <Icon
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={18}
            color={isFavorite ? '#f7a8cf' : C.textMute}
          />
        </TouchableOpacity>
      </View>
    );
  };

  const renderEmpty = () => {
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
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredSongs}
        renderItem={renderSongItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={renderTopContent}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.accentFg}
          />
        }
      />
    </View>
  );
};

export default HomeScreen;
