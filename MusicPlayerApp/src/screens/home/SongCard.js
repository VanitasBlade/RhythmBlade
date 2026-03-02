import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { MUSIC_HOME_THEME as C } from '../../theme/musicHomeTheme';
import styles from './home.styles';

/**
 * Memoized song card for HomeScreen FlatList.
 * Only re-renders when its specific props change.
 */
const SongCard = React.memo(
  ({ item, index, isFavorite, onPress, onFavorite }) => {
    return (
      <View style={styles.songCard}>
        <TouchableOpacity
          style={styles.songMain}
          onPress={() => onPress(index)}
          activeOpacity={0.85}>
          {item.artwork ? (
            <Image
              source={{ uri: item.artwork }}
              style={styles.songArtwork}
              resizeMode="cover"
              fadeDuration={0}
            />
          ) : (
            <View style={styles.songArtworkFallback}>
              <Icon name="music-note" size={20} color={C.accentFg} />
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
          style={styles.favoriteButton}
          onPress={() => onFavorite(item)}>
          <Icon
            name={isFavorite ? 'heart' : 'heart-outline'}
            size={18}
            color={isFavorite ? '#f7a8cf' : C.textMute}
          />
        </TouchableOpacity>
      </View>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.item === nextProps.item &&
      prevProps.index === nextProps.index &&
      prevProps.isFavorite === nextProps.isFavorite &&
      prevProps.onPress === nextProps.onPress &&
      prevProps.onFavorite === nextProps.onFavorite
    );
  },
);

SongCard.displayName = 'SongCard';

export default SongCard;
