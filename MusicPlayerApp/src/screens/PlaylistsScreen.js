import React, {useCallback, useMemo, useState} from 'react';
import {
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';

import playbackService from '../services/playback';
import storageService from '../services/storage';
import {MUSIC_HOME_THEME as C} from '../theme/musicHomeTheme';

const PlaylistsScreen = ({navigation}) => {
  const [playlists, setPlaylists] = useState([]);
  const [search, setSearch] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');

  const loadPlaylists = useCallback(async () => {
    try {
      const data = await storageService.getPlaylists();
      setPlaylists(data);
    } catch (error) {
      console.error('Error loading playlists:', error);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPlaylists();
    }, [loadPlaylists]),
  );

  const filteredPlaylists = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return playlists;
    }

    return playlists.filter(playlist => {
      const name = String(playlist.name || '').toLowerCase();
      const desc = String(playlist.description || '').toLowerCase();
      return name.includes(query) || desc.includes(query);
    });
  }, [playlists, search]);

  const createPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) {
      Alert.alert('Error', 'Please enter a playlist name');
      return;
    }

    try {
      await storageService.createPlaylist(name, newPlaylistDesc.trim());
      setModalVisible(false);
      setNewPlaylistName('');
      setNewPlaylistDesc('');
      await loadPlaylists();
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
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await storageService.deletePlaylist(playlist.id);
            await loadPlaylists();
          } catch (error) {
            Alert.alert('Error', error.message || 'Failed to delete playlist');
          }
        },
      },
    ]);
  };

  const openPlaylist = playlist => {
    navigation.navigate('PlaylistDetail', {playlist});
  };

  const playPlaylist = async playlist => {
    if (playlist.songs.length === 0) {
      Alert.alert('Empty Playlist', 'This playlist has no songs yet.');
      return;
    }

    try {
      await playbackService.playSongs(playlist.songs, {startIndex: 0});
      navigation.navigate('NowPlaying');
    } catch (error) {
      console.error('Error playing playlist:', error);
    }
  };

  const renderHeader = () => (
    <View>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Playlists</Text>
          <Text style={styles.headerSubtitle}>
            {playlists.length} collections
          </Text>
        </View>

        <TouchableOpacity
          style={styles.createButton}
          onPress={() => setModalVisible(true)}>
          <Icon name="plus" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Icon name="magnify" size={18} color={C.textMute} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search playlists"
          placeholderTextColor={C.textMute}
          value={search}
          onChangeText={setSearch}
        />
      </View>
    </View>
  );

  const renderPlaylistItem = ({item}) => {
    const artworks = item.songs
      .filter(song => song.artwork)
      .slice(0, 4)
      .map(song => song.artwork);
    const isFavorites = storageService.isFavoritesPlaylist(item);

    return (
      <View style={styles.playlistCard}>
        <TouchableOpacity
          style={styles.playlistMain}
          onPress={() => openPlaylist(item)}
          onLongPress={() => deletePlaylist(item)}>
          <View style={styles.playlistArtwork}>
            {artworks.length > 0 ? (
              <View style={styles.artworkGrid}>
                {artworks.map((artwork, index) => (
                  <Image
                    key={`${item.id}-${index}`}
                    source={{uri: artwork}}
                    style={styles.gridImage}
                  />
                ))}
                {artworks.length < 4
                  ? Array.from({length: 4 - artworks.length}).map(
                      (_, index) => (
                        <View
                          key={`empty-${item.id}-${index}`}
                          style={styles.gridImageEmpty}>
                          <Icon
                            name="music-note"
                            size={16}
                            color={C.textMute}
                          />
                        </View>
                      ),
                    )
                  : null}
              </View>
            ) : (
              <View style={styles.placeholderArtwork}>
                <Icon
                  name={isFavorites ? 'heart' : 'playlist-music'}
                  size={30}
                  color={isFavorites ? '#f7a8cf' : C.textMute}
                />
              </View>
            )}
          </View>

          <View style={styles.playlistMeta}>
            <View style={styles.nameRow}>
              <Text style={styles.playlistName} numberOfLines={1}>
                {item.name}
              </Text>
              {isFavorites ? (
                <View style={styles.favoriteBadge}>
                  <Text style={styles.favoriteBadgeText}>Default</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.playlistCount}>
              {item.songs.length} {item.songs.length === 1 ? 'song' : 'songs'}
            </Text>
            {!!item.description && (
              <Text style={styles.playlistDesc} numberOfLines={2}>
                {item.description}
              </Text>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.playIconButton}
          onPress={() => playPlaylist(item)}>
          <Icon name="play-circle" size={36} color={C.accentFg} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderEmpty = () => {
    const hasSearch = search.trim().length > 0;
    return (
      <View style={styles.emptyContainer}>
        <Icon
          name={hasSearch ? 'playlist-search' : 'playlist-music-outline'}
          size={64}
          color={C.textMute}
        />
        <Text style={styles.emptyTitle}>
          {hasSearch ? 'No matching playlists' : 'No playlists yet'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {hasSearch
            ? 'Try another search term.'
            : 'Create playlists to organize your music.'}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredPlaylists}
        renderItem={renderPlaylistItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
      />

      <Modal
        visible={modalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Playlist</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Icon name="close" size={22} color={C.textDim} />
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
              numberOfLines={3}
            />

            <TouchableOpacity
              style={styles.createModalButton}
              onPress={createPlaylist}>
              <Text style={styles.createModalButtonText}>Create</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingTop: 54,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 30,
    color: '#f0eaff',
    fontWeight: '800',
  },
  headerSubtitle: {
    marginTop: 4,
    color: C.textDim,
    fontSize: 12,
  },
  createButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },
  searchWrap: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    color: C.text,
    fontSize: 14,
  },
  playlistCard: {
    marginBottom: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  playlistMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 86,
  },
  playlistArtwork: {
    marginLeft: 8,
    marginRight: 10,
  },
  artworkGrid: {
    width: 68,
    height: 68,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 6,
    overflow: 'hidden',
  },
  gridImage: {
    width: 34,
    height: 34,
  },
  gridImageEmpty: {
    width: 34,
    height: 34,
    backgroundColor: '#2a1b49',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderArtwork: {
    width: 68,
    height: 68,
    borderRadius: 6,
    backgroundColor: '#2a1b49',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistMeta: {
    flex: 1,
    paddingRight: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playlistName: {
    flexShrink: 1,
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
  },
  favoriteBadge: {
    marginLeft: 8,
    borderWidth: 1,
    borderColor: '#704f9e',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    backgroundColor: '#2d1b54',
  },
  favoriteBadgeText: {
    color: '#d4c5ff',
    fontSize: 10,
    fontWeight: '700',
  },
  playlistCount: {
    marginTop: 3,
    color: C.textDim,
    fontSize: 12,
  },
  playlistDesc: {
    marginTop: 3,
    color: C.textMute,
    fontSize: 11,
  },
  playIconButton: {
    width: 48,
    minHeight: 86,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    paddingTop: 86,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 5, 18, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    color: C.text,
    fontSize: 20,
    fontWeight: '700',
  },
  modalInput: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    backgroundColor: C.bg,
    color: C.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 14,
  },
  modalTextArea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  createModalButton: {
    marginTop: 2,
    borderRadius: 8,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  createModalButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});

export default PlaylistsScreen;
