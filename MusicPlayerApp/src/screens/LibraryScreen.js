import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Image,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DocumentPicker from 'react-native-document-picker';
import storageService from '../services/storage';
import playbackService from '../services/playback';
import { useFocusEffect } from '@react-navigation/native';

const sortLibrarySongs = (library = [], sortBy = 'recent') => {
  const songs = Array.isArray(library) ? [...library] : [];
  switch (sortBy) {
    case 'recent':
      return songs.sort((a, b) => b.addedAt - a.addedAt);
    case 'title':
      return songs.sort((a, b) => a.title.localeCompare(b.title));
    case 'artist':
      return songs.sort((a, b) => a.artist.localeCompare(b.artist));
    default:
      return songs;
  }
};

const LibraryScreen = ({ navigation }) => {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState('recent'); // recent, title, artist

  useFocusEffect(
    useCallback(() => {
      loadLibrary();
    }, [sortBy])
  );

  const loadLibrary = async () => {
    try {
      setLoading(true);
      const library = await storageService.getLocalLibrary();
      setSongs(sortLibrarySongs(library, sortBy));

      storageService
        .hydrateArtworkForLibrary(library, 4)
        .then(updatedLibrary => {
          if (!updatedLibrary || updatedLibrary.length === 0) {
            return;
          }
          setSongs(sortLibrarySongs(updatedLibrary, sortBy));
        })
        .catch(error => {
          console.error('Error hydrating library artwork:', error);
        });
    } catch (error) {
      console.error('Error loading library:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadLibrary();
    setRefreshing(false);
  };

  const playSong = async (song, index) => {
    try {
      await playbackService.reset();
      
      const tracks = songs.map(s => ({
        id: s.id,
        url: s.url,
        title: s.title,
        artist: s.artist,
        album: s.album || 'Unknown Album',
        artwork: s.artwork || null,
        duration: s.duration || 0,
      }));

      await playbackService.addTracks(tracks);
      await playbackService.skipTo(index);
      navigation.navigate('NowPlaying');
    } catch (error) {
      console.error('Error playing song:', error);
    }
  };

  const playAll = async () => {
    if (songs.length === 0) return;

    try {
      await playbackService.reset();
      
      const tracks = songs.map(s => ({
        id: s.id,
        url: s.url,
        title: s.title,
        artist: s.artist,
        album: s.album || 'Unknown Album',
        artwork: s.artwork || null,
        duration: s.duration || 0,
      }));

      await playbackService.addTracks(tracks);
      await playbackService.play();
      navigation.navigate('NowPlaying');
    } catch (error) {
      console.error('Error playing all:', error);
    }
  };

  const deleteSong = async (song) => {
    Alert.alert(
      'Delete Song',
      `Are you sure you want to delete "${song.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await storageService.deleteSongFile(song);
              await loadLibrary();
              Alert.alert('Success', 'Song deleted successfully');
            } catch (error) {
              console.error('Error deleting song:', error);
              Alert.alert('Error', 'Failed to delete song');
            }
          },
        },
      ]
    );
  };

  const showSortOptions = () => {
    Alert.alert(
      'Sort By',
      'Choose how to sort your library',
      [
        {
          text: 'Recently Added',
          onPress: () => setSortBy('recent'),
        },
        {
          text: 'Song Title',
          onPress: () => setSortBy('title'),
        },
        {
          text: 'Artist Name',
          onPress: () => setSortBy('artist'),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const importLocalSong = async () => {
    try {
      const picked = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.audio],
      });

      const track = await storageService.importLocalAudioFile(picked);
      await loadLibrary();

      Alert.alert(
        'Imported',
        `"${track.title}" was added to your library.`,
        [
          { text: 'OK' },
          {
            text: 'Play Now',
            onPress: async () => {
              await playbackService.reset();
              await playbackService.addTrack(track);
              await playbackService.play();
              navigation.navigate('NowPlaying');
            },
          },
        ]
      );
    } catch (error) {
      if (DocumentPicker.isCancel(error)) {
        return;
      }
      console.error('Error importing local song:', error);
      Alert.alert('Import Failed', error.message || 'Unable to import selected file.');
    }
  };

  const renderSongItem = ({ item, index }) => (
    <TouchableOpacity
      style={styles.songItem}
      onPress={() => playSong(item, index)}
      onLongPress={() => deleteSong(item)}
    >
      <View style={styles.songArtwork}>
        {item.artwork ? (
          <Image source={{ uri: item.artwork }} style={styles.artworkImage} />
        ) : (
          <View style={styles.placeholderArtwork}>
            <Icon name="music-note" size={24} color="#666" />
          </View>
        )}
      </View>
      
      <View style={styles.songInfo}>
        <Text style={styles.songTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.songArtist} numberOfLines={1}>
          {item.artist}
        </Text>
        {item.album && (
          <Text style={styles.songAlbum} numberOfLines={1}>
            {item.album}
          </Text>
        )}
      </View>

      <TouchableOpacity
        style={styles.menuButton}
        onPress={() => deleteSong(item)}
      >
        <Icon name="delete-outline" size={24} color="#999" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <View>
        <Text style={styles.headerTitle}>Library</Text>
        <Text style={styles.headerSubtitle}>
          {songs.length} {songs.length === 1 ? 'song' : 'songs'}
        </Text>
      </View>
      <View style={styles.headerButtons}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={importLocalSong}
        >
          <Icon name="file-music-outline" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={showSortOptions}
        >
          <Icon name="sort" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon name="music-note-off" size={80} color="#666" />
      <Text style={styles.emptyText}>Your library is empty</Text>
      <Text style={styles.emptySubtext}>
        Download songs from the Search tab
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {renderHeader()}
      
      {songs.length > 0 && (
        <View style={styles.playAllContainer}>
          <TouchableOpacity style={styles.playAllButton} onPress={playAll}>
            <Icon name="play-circle" size={28} color="#1DB954" />
            <Text style={styles.playAllText}>Play All</Text>
          </TouchableOpacity>
        </View>
      )}

      {songs.length === 0 && !loading ? (
        renderEmpty()
      ) : (
        <FlatList
          data={songs}
          renderItem={renderSongItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#1DB954"
            />
          }
        />
      )}
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
  headerSubtitle: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 15,
  },
  headerButton: {
    padding: 8,
  },
  playAllContainer: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  playAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playAllText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  listContent: {
    padding: 15,
    paddingBottom: 100,
  },
  songItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    marginBottom: 10,
  },
  songArtwork: {
    marginRight: 12,
  },
  artworkImage: {
    width: 50,
    height: 50,
    borderRadius: 6,
  },
  placeholderArtwork: {
    width: 50,
    height: 50,
    borderRadius: 6,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  songInfo: {
    flex: 1,
  },
  songTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  songArtist: {
    fontSize: 14,
    color: '#999',
    marginBottom: 2,
  },
  songAlbum: {
    fontSize: 12,
    color: '#666',
  },
  menuButton: {
    padding: 8,
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
  },
});

export default LibraryScreen;
