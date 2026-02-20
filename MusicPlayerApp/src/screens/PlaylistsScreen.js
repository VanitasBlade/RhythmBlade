import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import storageService from '../services/storage';
import playbackService from '../services/playback';
import { useFocusEffect } from '@react-navigation/native';

const PlaylistsScreen = ({ navigation }) => {
  const [playlists, setPlaylists] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');

  useFocusEffect(
    useCallback(() => {
      loadPlaylists();
    }, [])
  );

  const loadPlaylists = async () => {
    try {
      const data = await storageService.getPlaylists();
      setPlaylists(data);
    } catch (error) {
      console.error('Error loading playlists:', error);
    }
  };

  const createPlaylist = async () => {
    if (!newPlaylistName.trim()) {
      Alert.alert('Error', 'Please enter a playlist name');
      return;
    }

    try {
      await storageService.createPlaylist(
        newPlaylistName.trim(),
        newPlaylistDesc.trim()
      );
      setModalVisible(false);
      setNewPlaylistName('');
      setNewPlaylistDesc('');
      await loadPlaylists();
      Alert.alert('Success', 'Playlist created successfully');
    } catch (error) {
      console.error('Error creating playlist:', error);
      Alert.alert('Error', 'Failed to create playlist');
    }
  };

  const deletePlaylist = (playlist) => {
    Alert.alert(
      'Delete Playlist',
      `Are you sure you want to delete "${playlist.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await storageService.deletePlaylist(playlist.id);
              await loadPlaylists();
              Alert.alert('Success', 'Playlist deleted successfully');
            } catch (error) {
              console.error('Error deleting playlist:', error);
              Alert.alert('Error', 'Failed to delete playlist');
            }
          },
        },
      ]
    );
  };

  const openPlaylist = (playlist) => {
    navigation.navigate('PlaylistDetail', { playlist });
  };

  const playPlaylist = async (playlist) => {
    if (playlist.songs.length === 0) {
      Alert.alert('Empty Playlist', 'This playlist has no songs');
      return;
    }

    try {
      await playbackService.playSongs(playlist.songs, {startIndex: 0});
      navigation.navigate('NowPlaying');
    } catch (error) {
      console.error('Error playing playlist:', error);
    }
  };

  const renderPlaylistItem = ({ item }) => {
    const artworks = item.songs
      .filter(s => s.artwork)
      .slice(0, 4)
      .map(s => s.artwork);

    return (
      <TouchableOpacity
        style={styles.playlistItem}
        onPress={() => openPlaylist(item)}
        onLongPress={() => deletePlaylist(item)}
      >
        <View style={styles.playlistArtwork}>
          {artworks.length > 0 ? (
            <View style={styles.artworkGrid}>
              {artworks.map((artwork, index) => (
                <Image
                  key={index}
                  source={{ uri: artwork }}
                  style={styles.gridImage}
                />
              ))}
              {artworks.length < 4 &&
                Array(4 - artworks.length)
                  .fill(0)
                  .map((_, index) => (
                    <View key={`empty-${index}`} style={styles.gridImageEmpty}>
                      <Icon name="music-note" size={20} color="#666" />
                    </View>
                  ))}
            </View>
          ) : (
            <View style={styles.placeholderArtwork}>
              <Icon name="playlist-music" size={40} color="#666" />
            </View>
          )}
        </View>

        <View style={styles.playlistInfo}>
          <Text style={styles.playlistName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.playlistCount} numberOfLines={1}>
            {item.songs.length} {item.songs.length === 1 ? 'song' : 'songs'}
          </Text>
          {item.description && (
            <Text style={styles.playlistDesc} numberOfLines={2}>
              {item.description}
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={styles.playButton}
          onPress={() => playPlaylist(item)}
        >
          <Icon name="play-circle" size={40} color="#1DB954" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Playlists</Text>
      <TouchableOpacity
        style={styles.createButton}
        onPress={() => setModalVisible(true)}
      >
        <Icon name="plus" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon name="playlist-music-outline" size={80} color="#666" />
      <Text style={styles.emptyText}>No playlists yet</Text>
      <Text style={styles.emptySubtext}>
        Create a playlist to organize your music
      </Text>
      <TouchableOpacity
        style={styles.createPlaylistButton}
        onPress={() => setModalVisible(true)}
      >
        <Icon name="plus" size={20} color="#fff" />
        <Text style={styles.createPlaylistButtonText}>Create Playlist</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {renderHeader()}

      {playlists.length === 0 ? (
        renderEmpty()
      ) : (
        <FlatList
          data={playlists}
          renderItem={renderPlaylistItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
        />
      )}

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Playlist</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Icon name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Playlist Name"
              placeholderTextColor="#666"
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
            />

            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Description (optional)"
              placeholderTextColor="#666"
              value={newPlaylistDesc}
              onChangeText={setNewPlaylistDesc}
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity
              style={styles.createModalButton}
              onPress={createPlaylist}
            >
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
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: '#1a1a1a',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1DB954',
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 15,
    paddingBottom: 100,
  },
  playlistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  playlistArtwork: {
    marginRight: 12,
  },
  artworkGrid: {
    width: 80,
    height: 80,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 6,
    overflow: 'hidden',
  },
  gridImage: {
    width: 40,
    height: 40,
  },
  gridImageEmpty: {
    width: 40,
    height: 40,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderArtwork: {
    width: 80,
    height: 80,
    borderRadius: 6,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playlistInfo: {
    flex: 1,
    marginRight: 12,
  },
  playlistName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  playlistCount: {
    fontSize: 14,
    color: '#999',
    marginBottom: 4,
  },
  playlistDesc: {
    fontSize: 12,
    color: '#666',
  },
  playButton: {
    padding: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginTop: 20,
    marginBottom: 10,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginBottom: 30,
  },
  createPlaylistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1DB954',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
  },
  createPlaylistButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  input: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
    color: '#fff',
    marginBottom: 15,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  createModalButton: {
    backgroundColor: '#1DB954',
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
  },
  createModalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PlaylistsScreen;
