import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import storageService from '../services/storage';
import playbackService from '../services/playback';

const HomeScreen = ({ navigation }) => {
  const [recentSongs, setRecentSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadRecentSongs();
  }, []);

  const loadRecentSongs = async () => {
    try {
      setLoading(true);
      const library = await storageService.getLocalLibrary();
      // Sort by addedAt descending and take first 20
      const recent = library
        .sort((a, b) => b.addedAt - a.addedAt)
        .slice(0, 20);
      setRecentSongs(recent);
    } catch (error) {
      console.error('Error loading recent songs:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRecentSongs();
    setRefreshing(false);
  };

  const playSong = async (song, index) => {
    try {
      await playbackService.reset();
      
      const tracks = recentSongs.map(s => ({
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

  const renderSongItem = ({ item, index }) => (
    <TouchableOpacity
      style={styles.songItem}
      onPress={() => playSong(item, index)}
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
      </View>

      <TouchableOpacity
        style={styles.menuButton}
        onPress={() => {/* Show options menu */}}
      >
        <Icon name="dots-vertical" size={24} color="#fff" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Music Player</Text>
      <View style={styles.headerButtons}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => navigation.navigate('Search')}
        >
          <Icon name="cloud-download" size={24} color="#1DB954" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon name="music-off" size={80} color="#666" />
      <Text style={styles.emptyText}>No songs in your library</Text>
      <Text style={styles.emptySubtext}>
        Download songs from the Search tab
      </Text>
      <TouchableOpacity
        style={styles.downloadButton}
        onPress={() => navigation.navigate('Search')}
      >
        <Icon name="cloud-download" size={20} color="#fff" />
        <Text style={styles.downloadButtonText}>Download Songs</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {renderHeader()}
      
      {recentSongs.length === 0 && !loading ? (
        renderEmpty()
      ) : (
        <FlatList
          data={recentSongs}
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
  headerButtons: {
    flexDirection: 'row',
    gap: 15,
  },
  headerButton: {
    padding: 8,
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
    marginBottom: 30,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1DB954',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
  },
  downloadButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default HomeScreen;
