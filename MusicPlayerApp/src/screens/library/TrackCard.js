import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { MUSIC_HOME_THEME as C } from '../../theme/musicHomeTheme';
import styles from './library.styles';

/**
 * Memoized track card for LibraryScreen FlatList.
 * Only re-renders when its specific props change.
 */
const TrackCard = React.memo(
  ({
    item,
    rowIndex,
    color,
    icon,
    duration,
    onPressRow,
    onLongPressRow,
    onOptionsRow,
  }) => {
    return (
      <View style={styles.trackCard}>
        <TouchableOpacity
          style={styles.trackMain}
          onPress={() => onPressRow(rowIndex)}
          onLongPress={event => onLongPressRow(item, event)}
          activeOpacity={0.85}>
          {item.artwork ? (
            <Image
              source={{ uri: item.artwork }}
              style={styles.trackArtwork}
              resizeMode="cover"
              fadeDuration={0}
            />
          ) : (
            <View style={[styles.trackFallback, { backgroundColor: color }]}>
              <Icon name={icon} size={22} color={C.accentFg} />
            </View>
          )}

          <View style={styles.trackMeta}>
            <Text style={styles.trackTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.trackArtist} numberOfLines={1}>
              {item.artist || 'Unknown artist'}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.trackRight}>
          <Text style={styles.trackDuration}>{duration}</Text>
          <TouchableOpacity
            style={styles.dotBtn}
            onPress={event => onOptionsRow(item, event)}>
            <Icon name="dots-vertical" size={18} color={C.textMute} />
          </TouchableOpacity>
        </View>
      </View>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.item === nextProps.item &&
      prevProps.rowIndex === nextProps.rowIndex &&
      prevProps.color === nextProps.color &&
      prevProps.icon === nextProps.icon &&
      prevProps.duration === nextProps.duration &&
      prevProps.onPressRow === nextProps.onPressRow &&
      prevProps.onLongPressRow === nextProps.onLongPressRow &&
      prevProps.onOptionsRow === nextProps.onOptionsRow
    );
  },
);

TrackCard.displayName = 'TrackCard';

export default TrackCard;
