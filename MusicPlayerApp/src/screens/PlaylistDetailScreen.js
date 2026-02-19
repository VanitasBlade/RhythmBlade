import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import storageService from '../services/storage';
import playbackService from '../services/playback';

const PlaylistDetailScreen = ({ route, navigation }) => {
  const { playlist: initialPlaylist } = route.params;
  const [playlist, setPlaylist] = useState(initialPlaylist);

  useEffect(() => {
    loadPlaylist();
  }, []);

  const loadPlaylist = async () => {
    try {
      const playlists = await storageService.getPlaylists();
      const updated = playlists.find(p => p.id === playlist.id);
      if (updated) {
        setPlaylist(updated);
      }
    } catch (error) {
      console.error('Error loading playlist:', error);
    }
  };

  const playSong = async (song, index) => {
    try {
      await playbackService.reset();
      
      const tracks = playlist.songs.map(s => ({
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
    if (playlist.songs.length === 0) return;

    try {
      await playbackService.reset();
      
      const tracks = playlist.songs.map(s => ({
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

  const removeSong = async (song) => {
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
              await storageService.removeSongFromPlaylist(playlist.id, song.id);
              await loadPlaylist();
              Alert.alert('Success', 'Song removed from playlist');
            } catch (error) {
              console.error('Error removing song:', error);
              Alert.alert('Error', 'Failed to remove song');
            }
          },
        },
      ]
    );
  };

  const renderSongItem = ({ item, index }) => (
    <TouchableOpacity
      style={styles.songItem}
      onPress={() => playSong(item, index)}
      onLongPress={() => removeSong(item)}
    >
      <Text style={styles.songIndex}>{index + 1}</Text>

      <View style={styles.songArtwork}>
        {item.artwork ? (
          <Image source={{ uri: item.artwork }} style={styles.artworkImage} />
        ) : (
          <View style={styles.placeholderArtwork}>
            <Icon name="music-note" size={20} color="#666" />
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
        onPress={() => removeSong(item)}
      >
        <Icon name="close" size={24} color="#999" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderHeader = () => {
    const artworks = playlist.songs
      .filter(s => s.artwork)
      .slice(0, 4)
      .map(s => s.artwork);

    return (
      <View>
        <View style={styles.headerContainer}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Icon name="chevron-left" size={32} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.playlistHeader}>
          <View style={styles.playlistArtworkLarge}>
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
                        <Icon name="music-note" size={30} color="#666" />
                      </View>
                    ))}
              </View>
            ) : (
              <View style={styles.placeholderArtworkLarge}>
                <Icon name="playlist-music" size={80} color="#666" />
              </View>
            )}
          </View>

          <Text style={styles.playlistName}>{playlist.name}</Text>
          {playlist.description && (
            <Text style={styles.playlistDescription}>
              {playlist.description}
            </Text>
          )}
          <Text style={styles.playlistInfo}>
            {playlist.songs.length} {playlist.songs.length === 1 ? 'song' : 'songs'}
          </Text>

          {playlist.songs.length > 0 && (
            <TouchableOpacity style={styles.playAllButton} onPress={playAll}>
              <Icon name="play-circle" size={28} color="#fff" />
              <Text style={styles.playAllText}>Play All</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon name="music-note-off" size={80} color="#666" />
      <Text style={styles.emptyText}>This playlist is empty</Text>
      <Text style={styles.emptySubtext}>
        Add songs from your library
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={playlist.songs}
        renderItem={renderSongItem}
        keyExtractor={item => item.id}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  headerContainer: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 10,
  },
  backButton: {
    width: 40,
    height: 40,
  },
  playlistHeader: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  playlistArtworkLarge: {
    marginBottom: 20,
  },
  artworkGrid: {
    width: 200,
    height: 200,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 12,
    overflow: 'hidden',
  },
  gridImage: {
    width: 100,
    height: 100,
  },
  gridImageEmpty: {
    width: 100,
    height: 100,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderArtworkLarge: {
    width: 200,
    height: 200,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playlistName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  playlistDescription: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginBottom: 8,
  },
  playlistInfo: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  playAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1DB954',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
  },
  playAllText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 100,
  },
  songItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  songIndex: {
    width: 30,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginRight: 10,
  },
  songArtwork: {
    marginRight: 12,
  },
  artworkImage: {
    width: 45,
    height: 45,
    borderRadius: 4,
  },
  placeholderArtwork: {
    width: 45,
    height: 45,
    borderRadius: 4,
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
    paddingVertical: 60,
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

export default PlaylistDetailScreen;
