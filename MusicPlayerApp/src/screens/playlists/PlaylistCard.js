import React, { useMemo } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import storageService from '../../services/storage/StorageService';
import { MUSIC_HOME_THEME as C } from '../../theme/musicHomeTheme';
import styles from './playlists.styles';

/**
 * Memoized playlist card for PlaylistsScreen FlatList.
 * Computes artworks internally with useMemo.
 */
const PlaylistCard = React.memo(({ item, onOpen, onDelete, onPlay }) => {
    const artworks = useMemo(
        () =>
            item.songs
                .filter(song => song.artwork)
                .slice(0, 4)
                .map(song => song.artwork),
        [item.songs],
    );

    const isFavorites = storageService.isFavoritesPlaylist(item);

    return (
        <View style={styles.playlistCard}>
            <TouchableOpacity
                style={styles.playlistMain}
                onPress={() => onOpen(item)}
                onLongPress={() => onDelete(item)}>
                <View style={styles.playlistArtwork}>
                    {artworks.length > 0 ? (
                        <View style={styles.artworkGrid}>
                            {artworks.map((artwork, index) => (
                                <Image
                                    key={`${item.id}-${index}`}
                                    source={{ uri: artwork }}
                                    style={styles.gridImage}
                                    resizeMode="cover"
                                    fadeDuration={0}
                                />
                            ))}
                            {artworks.length < 4
                                ? Array.from({ length: 4 - artworks.length }).map((_, index) => (
                                    <View
                                        key={`empty-${item.id}-${index}`}
                                        style={styles.gridImageEmpty}>
                                        <Icon
                                            name="music-note"
                                            size={16}
                                            color={C.textMute}
                                        />
                                    </View>
                                ))
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
                onPress={() => onPlay(item)}>
                <Icon name="play-circle" size={36} color={C.accentFg} />
            </TouchableOpacity>
        </View>
    );
});

PlaylistCard.displayName = 'PlaylistCard';

export default PlaylistCard;
