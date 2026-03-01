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
    ({ item, color, icon, duration, onPress, onLongPress, onOptions }) => {
        return (
            <View style={styles.trackCard}>
                <TouchableOpacity
                    style={styles.trackMain}
                    onPress={onPress}
                    onLongPress={onLongPress}
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
                    <TouchableOpacity style={styles.dotBtn} onPress={onOptions}>
                        <Icon name="dots-vertical" size={18} color={C.textMute} />
                    </TouchableOpacity>
                </View>
            </View>
        );
    },
);

TrackCard.displayName = 'TrackCard';

export default TrackCard;
