import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import playbackService from '../../services/playback/PlaybackService';
import storageService from '../../services/storage/StorageService';
import { MUSIC_HOME_THEME as C } from '../../theme/musicHomeTheme';
import PlaylistCard from './PlaylistCard';
import styles from './playlists.styles';

const PLAYLIST_ITEM_HEIGHT = 96;
const idKeyExtractor = item => item.id;

const PlaylistsScreen = ({ navigation }) => {
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

  const createPlaylist = useCallback(async () => {
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
  }, [newPlaylistName, newPlaylistDesc, loadPlaylists]);

  const deletePlaylist = useCallback(
    playlist => {
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
              await loadPlaylists();
            } catch (error) {
              Alert.alert(
                'Error',
                error.message || 'Failed to delete playlist',
              );
            }
          },
        },
      ]);
    },
    [loadPlaylists],
  );

  const openPlaylist = useCallback(
    playlist => {
      navigation.navigate('PlaylistDetail', { playlist });
    },
    [navigation],
  );

  const playPlaylist = useCallback(
    async playlist => {
      if (playlist.songs.length === 0) {
        Alert.alert('Empty Playlist', 'This playlist has no songs yet.');
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
        console.error('Error playing playlist:', error);
        Alert.alert(
          'Playback Error',
          error.message || 'Could not play songs from this playlist.',
        );
      }
    },
    [navigation],
  );

  const listHeader = useMemo(
    () => (
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
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
      </View>
    ),
    [playlists.length, search],
  );

  const renderPlaylistItem = useCallback(
    ({ item }) => (
      <PlaylistCard
        item={item}
        onOpen={openPlaylist}
        onDelete={deletePlaylist}
        onPlay={playPlaylist}
      />
    ),
    [openPlaylist, deletePlaylist, playPlaylist],
  );

  const renderEmpty = useCallback(() => {
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
  }, [search]);

  const getItemLayout = useCallback(
    (_, index) => ({
      length: PLAYLIST_ITEM_HEIGHT,
      offset: PLAYLIST_ITEM_HEIGHT * index,
      index,
    }),
    [],
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredPlaylists}
        renderItem={renderPlaylistItem}
        keyExtractor={idKeyExtractor}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={renderEmpty}
        removeClippedSubviews={true}
        maxToRenderPerBatch={8}
        windowSize={10}
        initialNumToRender={10}
        getItemLayout={getItemLayout}
      />

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Playlist</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
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

export default PlaylistsScreen;
