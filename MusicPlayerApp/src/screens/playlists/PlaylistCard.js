import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import PlaylistArtwork from '../../components/PlaylistArtwork';
import storageService from '../../services/storage/StorageService';
import {MUSIC_HOME_THEME as C} from '../../theme/musicHomeTheme';
import styles from './playlists.styles';

/**
 * Memoized playlist card for PlaylistsScreen FlatList.
 * Uses shared PlaylistArtwork renderer.
 */
const PlaylistCard = React.memo(({item, onOpen, onDelete, onPlay}) => {
  const isFavorites = storageService.isFavoritesPlaylist(item);

  return (
    <View style={styles.playlistCard}>
      <TouchableOpacity
        style={styles.playlistMain}
        onPress={() => onOpen(item)}
        onLongPress={() => onDelete(item)}>
        <View style={styles.playlistArtwork}>
          <PlaylistArtwork
            playlist={item}
            size={68}
            borderRadius={6}
            placeholderIcon={isFavorites ? 'heart' : 'playlist-music'}
            placeholderIconColor={isFavorites ? '#f7a8cf' : C.textMute}
            placeholderIconSize={30}
            emptyCellIconSize={16}
          />
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

      <TouchableOpacity style={styles.playIconButton} onPress={() => onPlay(item)}>
        <Icon name="play-circle" size={36} color={C.accentFg} />
      </TouchableOpacity>
    </View>
  );
});

PlaylistCard.displayName = 'PlaylistCard';

export default PlaylistCard;
