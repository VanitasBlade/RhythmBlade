import React, {useCallback, useMemo, useState} from 'react';
import {
  FlatList,
  Image,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useFocusEffect} from '@react-navigation/native';

import playbackService from '../../services/playback/PlaybackService';
import storageService from '../../services/storage/StorageService';
import {MUSIC_HOME_THEME as C} from '../../theme/musicHomeTheme';
import styles from './playlists.styles';

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
