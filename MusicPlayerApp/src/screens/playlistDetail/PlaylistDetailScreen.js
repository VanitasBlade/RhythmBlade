import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import playbackService from '../../services/playback/PlaybackService';
import storageService from '../../services/storage/StorageService';
import { MUSIC_HOME_THEME as C } from '../../theme/musicHomeTheme';
import styles from './playlistDetail.styles';

const SONG_ITEM_HEIGHT = 68;
const idKeyExtractor = item => item.id;

const SongCard = React.memo(({ item, index, onPress, onRemove }) => (
  <View style={styles.songCard}>
    <TouchableOpacity
      style={styles.songMain}
      onPress={() => onPress(index)}
      onLongPress={() => onRemove(item)}>
      <Text style={styles.songIndex}>{index + 1}</Text>

      {item.artwork ? (
        <Image
          source={{ uri: item.artwork }}
          style={styles.songArtwork}
          resizeMode="cover"
          fadeDuration={0}
        />
      ) : (
        <View style={styles.songArtworkFallback}>
          <Icon name="music-note" size={18} color={C.accentFg} />
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
      style={styles.removeBtn}
      onPress={() => onRemove(item)}>
      <Icon name="close" size={17} color={C.textMute} />
    </TouchableOpacity>
  </View>
));

SongCard.displayName = 'PlaylistDetailSongCard';

const PlaylistDetailScreen = ({ route, navigation }) => {
  const { playlist: initialPlaylist } = route.params;
  const [playlist, setPlaylist] = useState(initialPlaylist);

  const loadPlaylist = useCallback(async () => {
    try {
      const playlists = await storageService.getPlaylists();
      const updated = playlists.find(item => item.id === initialPlaylist.id);
      if (updated) {
        setPlaylist(updated);
      }
    } catch (error) {
      console.error('Error loading playlist:', error);
    }
  }, [initialPlaylist.id]);

  useEffect(() => {
    loadPlaylist();
  }, [loadPlaylist]);

  const playSong = useCallback(
    async index => {
      const nextTrack = playlist.songs[index];
      if (!nextTrack) {
        return;
      }

      try {
        await playbackService.playSongs(playlist.songs, { startIndex: index });
        navigation.navigate('NowPlaying', { optimisticTrack: nextTrack });
      } catch (error) {
        console.error('Error playing song:', error);
        Alert.alert(
          'Playback Error',
          error.message || 'Could not play this track.',
        );
      }
    },
    [playlist.songs, navigation],
  );

  const playAll = useCallback(async () => {
    if (playlist.songs.length === 0) {
      return;
    }

    const nextTrack = playlist.songs[0];

    try {
      await playbackService.playSongs(playlist.songs, { startIndex: 0 });
      navigation.navigate('NowPlaying', { optimisticTrack: nextTrack });
    } catch (error) {
      console.error('Error playing all songs:', error);
      Alert.alert(
        'Playback Error',
        error.message || 'Could not play songs from this playlist.',
      );
    }
  }, [playlist.songs, navigation]);

  const removeSong = useCallback(
    song => {
      Alert.alert(
        'Remove Song',
        `Remove "${song.title}" from this playlist?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                await storageService.removeSongFromPlaylist(
                  playlist.id,
                  song.id,
                );
                await loadPlaylist();
              } catch (error) {
                console.error('Error removing song:', error);
                Alert.alert('Error', 'Failed to remove song');
              }
            },
          },
        ],
      );
    },
    [playlist.id, loadPlaylist],
  );

  const artworks = useMemo(
    () =>
      playlist.songs
        .filter(song => song.artwork)
        .slice(0, 4)
        .map(song => song.artwork),
    [playlist.songs],
  );

  const listHeader = useMemo(
    () => (
      <View>
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}>
            <Icon name="chevron-left" size={24} color={C.accentFg} />
          </TouchableOpacity>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            Playlist
          </Text>
          <View style={styles.topBarSpacer} />
        </View>

        <View style={styles.heroSection}>
          <View style={styles.heroArtworkWrap}>
            {artworks.length > 0 ? (
              <View style={styles.artworkGrid}>
                {artworks.map((artwork, index) => (
                  <Image
                    key={`${playlist.id}-${index}`}
                    source={{ uri: artwork }}
                    style={styles.gridImage}
                    resizeMode="cover"
                    fadeDuration={0}
                  />
                ))}
                {artworks.length < 4
                  ? Array.from({ length: 4 - artworks.length }).map(
                    (_, index) => (
                      <View
                        key={`empty-${playlist.id}-${index}`}
                        style={styles.gridImageEmpty}>
                        <Icon
                          name="music-note"
                          size={22}
                          color={C.textMute}
                        />
                      </View>
                    ),
                  )
                  : null}
              </View>
            ) : (
              <View style={styles.placeholderArtwork}>
                <Icon name="playlist-music" size={72} color={C.textMute} />
              </View>
            )}
          </View>

          <Text style={styles.playlistName}>{playlist.name}</Text>
          {!!playlist.description && (
            <Text style={styles.playlistDescription}>
              {playlist.description}
            </Text>
          )}
          <Text style={styles.playlistInfo}>
            {playlist.songs.length}{' '}
            {playlist.songs.length === 1 ? 'song' : 'songs'}
          </Text>

          <TouchableOpacity
            style={[
              styles.playAllButton,
              playlist.songs.length === 0 && styles.playAllDisabled,
            ]}
            onPress={playAll}
            disabled={playlist.songs.length === 0}>
            <Icon name="play" size={16} color="#fff" />
            <Text style={styles.playAllText}>Play All</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>Tracks</Text>
      </View>
    ),
    [artworks, playlist, playAll, navigation],
  );

  const renderSongItem = useCallback(
    ({ item, index }) => (
      <SongCard
        item={item}
        index={index}
        onPress={playSong}
        onRemove={removeSong}
      />
    ),
    [playSong, removeSong],
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <Icon name="music-note-off" size={62} color={C.textMute} />
        <Text style={styles.emptyTitle}>This playlist is empty</Text>
        <Text style={styles.emptySubtitle}>Add songs from your library.</Text>
      </View>
    ),
    [],
  );

  const getItemLayout = useCallback(
    (_, index) => ({
      length: SONG_ITEM_HEIGHT,
      offset: SONG_ITEM_HEIGHT * index,
      index,
    }),
    [],
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={playlist.songs}
        renderItem={renderSongItem}
        keyExtractor={idKeyExtractor}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={10}
        initialNumToRender={12}
        getItemLayout={getItemLayout}
      />
    </View>
  );
};

export default PlaylistDetailScreen;
