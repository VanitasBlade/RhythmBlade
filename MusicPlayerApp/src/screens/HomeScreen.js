import React, {useCallback, useMemo, useState} from 'react';
import {
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';

import playbackService from '../services/playback';
import storageService from '../services/storage';
import {
  MUSIC_HOME_ART_COLORS,
  MUSIC_HOME_THEME as C,
  PLAYLIST_EMOJIS,
} from '../theme/musicHomeTheme';

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
          onPress={() => navigation.navigate('Library', {libraryTab: 'playlists'})}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 128,
  },
  header: {
    paddingTop: 40,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 40,
    color: '#e8e2f8',
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    marginTop: 4,
    color: C.textDim,
    fontSize: 12,
  },
  headerAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.bgCard,
  },
  profilePlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3b1f6e',
    borderWidth: 1,
    borderColor: C.accent,
  },
  profileInitial: {
    color: '#f0eaff',
    fontSize: 12,
    fontWeight: '700',
  },
  searchWrap: {
    marginTop: 8,
    marginBottom: 10,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    color: C.text,
    fontSize: 14,
  },
  quickActionsRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  quickActionCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionGap: {
    marginRight: 8,
  },
  quickActionLabel: {
    marginLeft: 8,
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
  },
  sectionRow: {
    marginTop: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: C.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionAction: {
    color: C.accentFg,
    fontSize: 12,
    fontWeight: '600',
  },
  playlistsRow: {
    paddingBottom: 4,
    paddingRight: 2,
  },
  playlistCard: {
    width: 102,
    marginRight: 10,
  },
  playlistArt: {
    height: 94,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistEmoji: {
    fontSize: 30,
  },
  playlistName: {
    marginTop: 6,
    color: '#bdb5d8',
    fontSize: 11,
    fontWeight: '700',
  },
  playlistCount: {
    marginTop: 2,
    color: C.textMute,
    fontSize: 10,
  },
  songCard: {
    marginBottom: 9,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: C.bgCard,
    flexDirection: 'row',
    alignItems: 'center',
  },
  songMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
  },
  songArtwork: {
    width: 60,
    height: 60,
  },
  songArtworkFallback: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a1b49',
  },
  songMeta: {
    flex: 1,
    minHeight: 60,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  songTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
  },
  songArtist: {
    marginTop: 3,
    color: C.textMute,
    fontSize: 11,
  },
  favoriteButton: {
    width: 42,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60,
  },
  emptyContainer: {
    paddingTop: 64,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  emptyTitle: {
    marginTop: 12,
    color: '#f0eaff',
    fontSize: 19,
    fontWeight: '700',
  },
  emptySubtitle: {
    marginTop: 8,
    color: C.textDim,
    fontSize: 13,
    textAlign: 'center',
  },
});

export default HomeScreen;
