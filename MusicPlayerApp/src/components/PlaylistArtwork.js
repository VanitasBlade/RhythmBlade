import React, {useMemo} from 'react';
import {Image, StyleSheet, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {MUSIC_HOME_THEME as C} from '../theme/musicHomeTheme';

const EMPTY_CELL_BG = '#2a1b49';

function normalizeUri(value = '') {
  const normalized = String(value || '').trim();
  return normalized || '';
}

const PlaylistArtwork = React.memo(
  ({
    playlist,
    size = 68,
    width,
    height,
    borderRadius = 8,
    borderWidth = 1,
    borderColor = C.border,
    placeholderIcon = 'playlist-music',
    placeholderIconColor = C.textMute,
    placeholderIconSize = 28,
    emptyCellIcon = 'music-note',
    emptyCellIconColor = C.textMute,
    emptyCellIconSize = 16,
  }) => {
    const frameWidth = Math.max(
      24,
      Number(width) || Math.max(24, Number(size) || 68),
    );
    const frameHeight = Math.max(24, Number(height) || frameWidth);
    const tileWidth = frameWidth / 2;
    const tileHeight = frameHeight / 2;
    const radius = Math.max(0, Number(borderRadius) || 0);
    const frameBorderWidth = Math.max(0, Number(borderWidth) || 0);
    const customArtwork = normalizeUri(
      playlist?.customArtwork || playlist?.coverArtwork || '',
    );
    const artworks = useMemo(() => {
      const songs = Array.isArray(playlist?.songs) ? playlist.songs : [];
      const next = [];
      for (let index = 0; index < songs.length; index += 1) {
        const artwork = normalizeUri(songs[index]?.artwork);
        if (!artwork) {
          continue;
        }
        next.push(artwork);
        if (next.length >= 4) {
          break;
        }
      }
      return next;
    }, [playlist?.songs]);
    const collageCells = useMemo(
      () =>
        Array.from({length: 4}).map((_, index) => ({
          key: `cell-${String(playlist?.id || 'playlist')}-${index}`,
          artwork: artworks[index] || '',
        })),
      [artworks, playlist?.id],
    );

    const frameStyle = {
      width: frameWidth,
      height: frameHeight,
      borderRadius: radius,
      borderWidth: frameBorderWidth,
      borderColor,
      overflow: 'hidden',
      backgroundColor: EMPTY_CELL_BG,
    };

    if (customArtwork) {
      return (
        <Image
          source={{uri: customArtwork}}
          style={frameStyle}
          resizeMode="cover"
          fadeDuration={0}
        />
      );
    }

    if (artworks.length > 0) {
      return (
        <View style={frameStyle}>
          {[0, 1].map(rowIndex => {
            const start = rowIndex * 2;
            const rowCells = collageCells.slice(start, start + 2);
            return (
              <View
                key={`row-${String(playlist?.id || 'playlist')}-${rowIndex}`}
                style={styles.gridRow}>
                {rowCells.map(cell =>
                  cell.artwork ? (
                    <Image
                      key={`${cell.key}-${cell.artwork}`}
                      source={{uri: cell.artwork}}
                      style={{width: tileWidth, height: tileHeight}}
                      resizeMode="cover"
                      fadeDuration={0}
                    />
                  ) : (
                    <View
                      key={cell.key}
                      style={[
                        styles.centerContent,
                        {
                          width: tileWidth,
                          height: tileHeight,
                          backgroundColor: EMPTY_CELL_BG,
                        },
                      ]}>
                      <Icon
                        name={emptyCellIcon}
                        size={emptyCellIconSize}
                        color={emptyCellIconColor}
                      />
                    </View>
                  ),
                )}
              </View>
            );
          })}
        </View>
      );
    }

    return (
      <View style={[frameStyle, styles.centerContent]}>
        <Icon
          name={placeholderIcon}
          size={placeholderIconSize}
          color={placeholderIconColor}
        />
      </View>
    );
  },
);

PlaylistArtwork.displayName = 'PlaylistArtwork';

const styles = StyleSheet.create({
  gridRow: {
    flexDirection: 'row',
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default PlaylistArtwork;
