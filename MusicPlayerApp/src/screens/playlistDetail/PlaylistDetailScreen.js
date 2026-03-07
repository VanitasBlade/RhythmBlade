import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import PlaylistArtwork from '../../components/PlaylistArtwork';
import playbackService from '../../services/playback/PlaybackService';
import storageService from '../../services/storage/StorageService';
import {toFileUriFromPath, toPathFromUri} from '../../services/storage/storage.helpers';
import { MUSIC_HOME_THEME as C } from '../../theme/musicHomeTheme';
import styles from './playlistDetail.styles';

const SONG_ITEM_HEIGHT = 68;
const PLAYLIST_COVER_DIR = `${RNFS.DocumentDirectoryPath}/playlist_covers`;
const idKeyExtractor = item => item.id;
const songKey = song =>
  String(song?.id || song?.sourceSongId || song?.localPath || song?.url || '')
    .trim();
const songIdentityKeys = song => {
  const keys = [song?.id, song?.sourceSongId, song?.localPath, song?.url]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  return Array.from(new Set(keys));
};

const toPlaylistCoverExtension = file => {
  const fromName = String(file?.name || '').match(/\.([a-z0-9]{2,5})$/i);
  if (fromName?.[1]) {
    return fromName[1].toLowerCase();
  }
  const mimePart = String(file?.type || '').split('/')[1] || '';
  const normalized = mimePart.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!normalized) {
    return 'jpg';
  }
  if (normalized === 'jpeg') {
    return 'jpg';
  }
  return normalized.slice(0, 5);
};

const isManagedPlaylistCoverPath = pathValue => {
  const normalizedPath = String(pathValue || '').trim();
  if (!normalizedPath) {
    return false;
  }
  const normalizedDir = String(PLAYLIST_COVER_DIR || '').replace(/\\/g, '/');
  const normalizedCandidate = normalizedPath.replace(/\\/g, '/');
  return normalizedCandidate.indexOf(normalizedDir + '/') === 0;
};

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
  const [addTracksOpen, setAddTracksOpen] = useState(false);
  const [loadingLibrarySongs, setLoadingLibrarySongs] = useState(false);
  const [librarySongs, setLibrarySongs] = useState([]);
  const [selectedSongKeys, setSelectedSongKeys] = useState(new Set());
  const [addTracksQuery, setAddTracksQuery] = useState('');

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

  const isFavorites = useMemo(
    () => storageService.isFavoritesPlaylist(playlist),
    [playlist],
  );

  const persistCustomPlaylistArtwork = useCallback(
    async nextArtworkUri => {
      const normalizedArtwork = String(nextArtworkUri || '').trim();
      const previousArtwork = String(playlist?.customArtwork || '').trim();
      const result = await storageService.setPlaylistCustomArtwork(
        playlist.id,
        normalizedArtwork,
      );
      if (result?.playlist) {
        setPlaylist(result.playlist);
      } else {
        await loadPlaylist();
      }

      if (previousArtwork && previousArtwork !== normalizedArtwork) {
        const previousPath = toPathFromUri(previousArtwork);
        if (isManagedPlaylistCoverPath(previousPath)) {
          await RNFS.unlink(previousPath).catch(() => null);
        }
      }
    },
    [loadPlaylist, playlist?.customArtwork, playlist?.id],
  );

  const pickPlaylistCustomArtwork = useCallback(async () => {
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
      await RNFS.mkdir(PLAYLIST_COVER_DIR).catch(() => null);
      const extension = toPlaylistCoverExtension(file);
      const destinationPath = `${PLAYLIST_COVER_DIR}/${String(
        playlist?.id || 'playlist',
      )}_${Date.now()}.${extension}`;
      await RNFS.copyFile(sourcePath, destinationPath);
      await persistCustomPlaylistArtwork(toFileUriFromPath(destinationPath));
    } catch (error) {
      if (!DocumentPicker.isCancel(error)) {
        console.error('Failed to pick playlist cover artwork:', error);
      }
    }
  }, [persistCustomPlaylistArtwork, playlist?.id]);

  const clearPlaylistCustomArtwork = useCallback(() => {
    Alert.alert(
      'Remove Custom Cover',
      'Use the first four song artworks for this playlist thumbnail instead?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await persistCustomPlaylistArtwork('');
            } catch (error) {
              console.error('Failed to clear playlist cover artwork:', error);
              Alert.alert(
                'Cover Update Failed',
                error?.message || 'Could not clear the playlist cover image.',
              );
            }
          },
        },
      ],
    );
  }, [persistCustomPlaylistArtwork]);

  const openPlaylistCoverOptions = useCallback(() => {
    const currentCustomArtwork = String(playlist?.customArtwork || '').trim();
    if (!currentCustomArtwork) {
      pickPlaylistCustomArtwork().catch(() => null);
      return;
    }
    Alert.alert('Playlist Cover', 'Update or remove the custom cover image.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Change Image',
        onPress: () => {
          pickPlaylistCustomArtwork().catch(() => null);
        },
      },
      {
        text: 'Remove Image',
        style: 'destructive',
        onPress: clearPlaylistCustomArtwork,
      },
    ]);
  }, [
    clearPlaylistCustomArtwork,
    pickPlaylistCustomArtwork,
    playlist?.customArtwork,
  ]);

  const playSong = useCallback(
    async index => {
      const nextTrack = playlist.songs[index];
      if (!nextTrack) {
        return;
      }

      try {
        await playbackService.playSongs(playlist.songs, { startIndex: index });
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
      navigation.navigate('NowPlaying', {
        optimisticTrack: nextTrack,
        shuffleActive: false,
      });
    } catch (error) {
      console.error('Error playing all songs:', error);
      Alert.alert(
        'Playback Error',
        error.message || 'Could not play songs from this playlist.',
      );
    }
  }, [playlist.songs, navigation]);

  const filteredLibrarySongs = useMemo(() => {
    const query = addTracksQuery.trim().toLowerCase();
    if (!query) {
      return librarySongs;
    }
    return librarySongs.filter(item => {
      const title = String(item?.title || '').toLowerCase();
      const artist = String(item?.artist || '').toLowerCase();
      return title.includes(query) || artist.includes(query);
    });
  }, [addTracksQuery, librarySongs]);

  const openAddTracksModal = useCallback(async () => {
    try {
      setLoadingLibrarySongs(true);
      const library = await storageService.getLocalLibrary();
      const existingKeySet = new Set(
        playlist.songs.flatMap(song => songIdentityKeys(song)),
      );
      const candidates = library.filter(song => {
        const keys = songIdentityKeys(song);
        return keys.length > 0 && !keys.some(key => existingKeySet.has(key));
      });
      setLibrarySongs(candidates);
      setSelectedSongKeys(new Set());
      setAddTracksQuery('');
      setAddTracksOpen(true);
    } catch (error) {
      console.error('Error loading library songs for playlist add:', error);
      Alert.alert('Error', 'Could not load library songs.');
    } finally {
      setLoadingLibrarySongs(false);
    }
  }, [playlist.songs]);

  const toggleLibrarySongSelection = useCallback(song => {
    const key = songKey(song);
    if (!key) {
      return;
    }
    setSelectedSongKeys(previous => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const confirmAddTracks = useCallback(async () => {
    if (!selectedSongKeys.size) {
      setAddTracksOpen(false);
      return;
    }

    const chosenSongs = librarySongs.filter(song =>
      selectedSongKeys.has(songKey(song)),
    );
    if (!chosenSongs.length) {
      setAddTracksOpen(false);
      return;
    }

    try {
      const result = await storageService.addSongsToPlaylist(
        playlist.id,
        chosenSongs,
      );
      if (result?.playlist) {
        setPlaylist(result.playlist);
      }
      await loadPlaylist();
      setAddTracksOpen(false);
      setSelectedSongKeys(new Set());
      Alert.alert(
        'Tracks Added',
        `${Number(result?.addedCount) || chosenSongs.length} track${
          (Number(result?.addedCount) || chosenSongs.length) === 1 ? '' : 's'
        } added to "${playlist.name}".`,
      );
    } catch (error) {
      console.error('Error adding tracks to playlist:', error);
      Alert.alert(
        'Add Tracks Failed',
        error?.message || 'Could not add tracks to this playlist.',
      );
    }
  }, [librarySongs, loadPlaylist, playlist.id, playlist.name, selectedSongKeys]);

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
            <PlaylistArtwork
              playlist={playlist}
              size={180}
              borderRadius={12}
              placeholderIcon={isFavorites ? 'heart' : 'playlist-music'}
              placeholderIconColor={isFavorites ? '#f7a8cf' : C.textMute}
              placeholderIconSize={72}
              emptyCellIconSize={22}
            />
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

          <View style={styles.heroActions}>
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

            <TouchableOpacity
              style={styles.addTracksButton}
              onPress={openAddTracksModal}>
              <Icon name="playlist-plus" size={16} color={C.accentFg} />
              <Text style={styles.addTracksText}>Add Tracks</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.addTracksButton}
              onPress={openPlaylistCoverOptions}>
              <Icon
                name={
                  String(playlist?.customArtwork || '').trim()
                    ? 'image-edit-outline'
                    : 'image-plus'
                }
                size={16}
                color={C.accentFg}
              />
              <Text style={styles.addTracksText}>
                {String(playlist?.customArtwork || '').trim()
                  ? 'Edit Cover'
                  : 'Set Cover'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Tracks</Text>
      </View>
    ),
    [
      isFavorites,
      navigation,
      openAddTracksModal,
      openPlaylistCoverOptions,
      playAll,
      playlist,
    ],
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

  const selectedTrackCount = selectedSongKeys.size;

  const renderLibrarySongItem = useCallback(
    ({item}) => {
      const key = songKey(item);
      const selected = selectedSongKeys.has(key);
      return (
        <TouchableOpacity
          style={[
            styles.librarySongRow,
            selected && styles.librarySongRowSelected,
          ]}
          onPress={() => toggleLibrarySongSelection(item)}>
          <View style={styles.librarySongMeta}>
            <Text style={styles.librarySongTitle} numberOfLines={1}>
              {item.title || 'Unknown'}
            </Text>
            <Text style={styles.librarySongArtist} numberOfLines={1}>
              {item.artist || 'Unknown Artist'}
            </Text>
          </View>
          <Icon
            name={selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
            size={22}
            color={selected ? C.accentFg : C.textMute}
          />
        </TouchableOpacity>
      );
    },
    [selectedSongKeys, toggleLibrarySongSelection],
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

      <Modal
        visible={addTracksOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAddTracksOpen(false)}>
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setAddTracksOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Tracks</Text>
              <TouchableOpacity onPress={() => setAddTracksOpen(false)}>
                <Icon name="close" size={20} color={C.textDim} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Search library songs..."
              placeholderTextColor={C.textMute}
              value={addTracksQuery}
              onChangeText={setAddTracksQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {loadingLibrarySongs ? (
              <View style={styles.librarySongsLoading}>
                <Text style={styles.librarySongsEmptyText}>Loading songs...</Text>
              </View>
            ) : filteredLibrarySongs.length ? (
              <FlatList
                data={filteredLibrarySongs}
                keyExtractor={(item, index) => `${songKey(item)}-${index}`}
                style={styles.librarySongsList}
                contentContainerStyle={styles.librarySongsListContent}
                renderItem={renderLibrarySongItem}
              />
            ) : (
              <View style={styles.librarySongsEmpty}>
                <Text style={styles.librarySongsEmptyText}>
                  No more tracks available to add.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.modalPrimaryButton,
                selectedTrackCount <= 0 && styles.playAllDisabled,
              ]}
              onPress={confirmAddTracks}
              disabled={selectedTrackCount <= 0}>
              <Text style={styles.modalPrimaryButtonText}>
                Add {selectedTrackCount} Track
                {selectedTrackCount === 1 ? '' : 's'}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

export default PlaylistDetailScreen;
