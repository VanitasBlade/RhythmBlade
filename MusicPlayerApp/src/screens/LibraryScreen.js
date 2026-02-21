import React, {useCallback, useMemo, useState} from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DocumentPicker from 'react-native-document-picker';
import {useFocusEffect} from '@react-navigation/native';

import playbackService from '../services/playback';
import storageService from '../services/storage';
import {
  MUSIC_HOME_ART_COLORS,
  MUSIC_HOME_THEME as C,
} from '../theme/musicHomeTheme';

const SUB_TABS = [
  {id: 'tracks', label: 'Tracks'},
  {id: 'playlists', label: 'Playlists'},
  {id: 'files', label: 'Files'},
];
const SORT_OPTIONS = ['Name', 'Artist', 'Date Added'];
const TRACK_ICONS = [
  'guitar-electric',
  'city-variant-outline',
  'flash',
  'violin',
  'music-note-eighth',
];
const PLAYLIST_ICONS = [
  'heart',
  'music-note',
  'city-variant-outline',
  'arm-flex',
  'weather-night',
  'car',
  'headphones',
];
const ART_KEYS = Object.keys(MUSIC_HOME_ART_COLORS);

const formatDuration = value => {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const sortSongs = (songs = [], sortBy = 'Name') => {
  const list = [...songs];
  if (sortBy === 'Artist') {
    return list.sort((a, b) =>
      String(a.artist || '').localeCompare(String(b.artist || '')),
    );
  }
  if (sortBy === 'Date Added') {
    return list.sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0));
  }
  return list.sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || '')),
  );
};

const normalizeFormats = source => {
  if (Array.isArray(source?.fmt)) {
    return source.fmt;
  }
  return String(source?.fmt || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const LibraryScreen = ({navigation, route}) => {
  const [songs, setSongs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState('tracks');
  const [sortBy, setSortBy] = useState('Name');
  const [sortOpen, setSortOpen] = useState(false);

  const [playlistQuery, setPlaylistQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');

  const loadLibrary = useCallback(async () => {
    try {
      setLoading(true);
      const [library, playlistData, storedSources] = await Promise.all([
        storageService.getLocalLibrary(),
        storageService.getPlaylists(),
        storageService.getFileSources(),
      ]);

      const favorites =
        playlistData.find(item => storageService.isFavoritesPlaylist(item)) || null;

      setSongs(library);
      setPlaylists(playlistData);
      setFavoriteIds(new Set((favorites?.songs || []).map(song => song.id)));
      setSources(storedSources);

      storageService
        .hydrateArtworkForLibrary(library, 6)
        .then(updated => {
          if (updated?.length) {
            setSongs(updated);
          }
        })
        .catch(() => {});
    } catch (error) {
      console.error('Error loading library:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLibrary();
    }, [loadLibrary]),
  );

  useFocusEffect(
    useCallback(() => {
      const requested = String(route?.params?.libraryTab || '').toLowerCase();
      if (requested && SUB_TABS.some(item => item.id === requested)) {
        setTab(requested);
        navigation.setParams({libraryTab: undefined});
      }
    }, [navigation, route?.params?.libraryTab]),
  );

  const sortedSongs = useMemo(() => sortSongs(songs, sortBy), [songs, sortBy]);

  const filteredPlaylists = useMemo(() => {
    const query = playlistQuery.trim().toLowerCase();
    if (!query) {
      return playlists;
    }
    return playlists.filter(item => {
      const name = String(item.name || '').toLowerCase();
      const desc = String(item.description || '').toLowerCase();
      return name.includes(query) || desc.includes(query);
    });
  }, [playlists, playlistQuery]);

  const playlistRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < filteredPlaylists.length; i += 2) {
      rows.push(filteredPlaylists.slice(i, i + 2));
    }
    return rows;
  }, [filteredPlaylists]);

  const normalizedSources = useMemo(
    () => sources.map(source => ({...source, fmt: normalizeFormats(source)})),
    [sources],
  );

  const sourceSummary = useMemo(() => {
    const active = normalizedSources.filter(source => source.on).length;
    const files = normalizedSources.reduce(
      (sum, source) => sum + (Number(source.count) || 0),
      0,
    );
    return {active, files};
  }, [normalizedSources]);

  const playSong = async index => {
    try {
      await playbackService.playSongs(sortedSongs, {startIndex: index});
      navigation.navigate('NowPlaying');
    } catch (error) {
      console.error('Error playing song:', error);
    }
  };

  const playAll = async () => {
    if (!sortedSongs.length) {
      return;
    }
    try {
      await playbackService.playSongs(sortedSongs, {startIndex: 0});
      navigation.navigate('NowPlaying');
    } catch (error) {
      console.error('Error playing all songs:', error);
    }
  };

  const shufflePlay = async () => {
    if (!sortedSongs.length) {
      return;
    }
    const shuffled = [...sortedSongs];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    try {
      await playbackService.playSongs(shuffled, {startIndex: 0});
      navigation.navigate('NowPlaying');
    } catch (error) {
      console.error('Error shuffling songs:', error);
    }
  };

  const deleteSong = song => {
    Alert.alert('Delete Song', `Delete "${song.title}" from your library?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await storageService.deleteSongFile(song);
            await loadLibrary();
          } catch (error) {
            Alert.alert('Error', 'Failed to delete song');
          }
        },
      },
    ]);
  };

  const toggleFavorite = async song => {
    try {
      const result = await storageService.toggleSongInFavorites(song);
      setPlaylists(result.playlists);
      setFavoriteIds(new Set(result.playlist.songs.map(item => item.id)));
    } catch (error) {
      Alert.alert('Error', 'Could not update favorites');
    }
  };

  const showSongOptions = song => {
    const isFavorite = favoriteIds.has(song.id);
    Alert.alert(song.title, 'Choose an action', [
      {
        text: isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
        onPress: () => toggleFavorite(song),
      },
      {text: 'Delete Song', style: 'destructive', onPress: () => deleteSong(song)},
      {text: 'Cancel', style: 'cancel'},
    ]);
  };

  const createPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) {
      Alert.alert('Error', 'Please enter a playlist name');
      return;
    }
    try {
      await storageService.createPlaylist(name, newPlaylistDesc.trim());
      setCreateOpen(false);
      setNewPlaylistName('');
      setNewPlaylistDesc('');
      await loadLibrary();
    } catch (error) {
      Alert.alert('Create Playlist Failed', error.message || 'Could not create playlist');
    }
  };

  const deletePlaylist = playlist => {
    if (storageService.isFavoritesPlaylist(playlist)) {
      Alert.alert('Protected Playlist', 'favorites is a default playlist and cannot be deleted.');
      return;
    }
    Alert.alert('Delete Playlist', `Delete "${playlist.name}"?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await storageService.deletePlaylist(playlist.id);
            await loadLibrary();
          } catch (error) {
            Alert.alert('Error', error.message || 'Failed to delete playlist');
          }
        },
      },
    ]);
  };

  const addFileSource = async () => {
    try {
      if (typeof DocumentPicker.pickDirectory !== 'function') {
        Alert.alert(
          'Not Supported',
          'Folder selection is not supported on this device.',
        );
        return;
      }

      const pickedDirectory = await DocumentPicker.pickDirectory();
      const sourceUri =
        typeof pickedDirectory === 'string'
          ? pickedDirectory
          : pickedDirectory?.uri;

      if (!sourceUri) {
        throw new Error('No folder selected');
      }

      const result = await storageService.importFolderAsFileSource(sourceUri, {
        recursive: true,
      });
      setSources(result.fileSources);

      await loadLibrary();
      Alert.alert(
        'Folder Imported',
        `${result.fileCount} audio file${
          result.fileCount === 1 ? '' : 's'
        } scanned from ${result.sourcePath}.`,
      );
    } catch (error) {
      if (!DocumentPicker.isCancel(error)) {
        Alert.alert(
          'File Source Error',
          error.message || 'Unable to add file source.',
        );
      }
    }
  };

  const toggleSource = async source => {
    try {
      const nextSources = await storageService.toggleFileSource(source.id);
      setSources(nextSources);
    } catch (error) {
      Alert.alert('Error', 'Could not update this source.');
    }
  };

  const renderTrackItem = ({item, index}) => {
    const color = MUSIC_HOME_ART_COLORS[ART_KEYS[index % ART_KEYS.length]] || C.bgCard;
    const icon = TRACK_ICONS[index % TRACK_ICONS.length];
    return (
      <View style={styles.trackCard}>
        <TouchableOpacity
          style={styles.trackMain}
          onPress={() => playSong(index)}
          onLongPress={() => showSongOptions(item)}
          activeOpacity={0.85}>
          {item.artwork ? (
            <Image source={{uri: item.artwork}} style={styles.trackArtwork} />
          ) : (
            <View style={[styles.trackFallback, {backgroundColor: color}]}>
              <Icon name={icon} size={20} color={C.accentFg} />
            </View>
          )}
          <View style={styles.trackMeta}>
            <Text style={styles.trackTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.trackArtist} numberOfLines={1}>{item.artist}</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.trackRight}>
          <Text style={styles.trackDuration}>{formatDuration(item.duration)}</Text>
          <TouchableOpacity onPress={() => showSongOptions(item)} style={styles.dotBtn}>
            <Icon name="dots-horizontal" size={18} color={C.textMute} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate('Home')}>
          <Icon name="chevron-left" size={24} color={C.accentFg} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Library</Text>
      </View>

      <View style={styles.subTabs}>
        {SUB_TABS.map(item => {
          const active = item.id === tab;
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.subTabBtn}
              onPress={() => {
                setSortOpen(false);
                setTab(item.id);
              }}>
              <Text style={[styles.subTabText, active && styles.subTabTextActive]}>{item.label}</Text>
              {active ? <View style={styles.subTabLine} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === 'tracks' ? (
        <View style={styles.panel}>
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[styles.primaryBtn, sortedSongs.length === 0 && styles.disabled]}
              onPress={playAll}
              disabled={sortedSongs.length === 0}>
              <Icon name="play" size={14} color={C.accentFg} />
              <Text style={styles.primaryBtnText}>Play All</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.ghostBtn, sortedSongs.length === 0 && styles.disabled]}
              onPress={shufflePlay}
              disabled={sortedSongs.length === 0}>
              <Icon name="shuffle" size={13} color={C.accentFg} />
              <Text style={styles.ghostBtnText}>Shuffle</Text>
            </TouchableOpacity>

            <View style={styles.sortWrap}>
              <TouchableOpacity style={styles.sortBtn} onPress={() => setSortOpen(open => !open)}>
                <Icon name="sort-variant" size={13} color={C.textDim} />
                <Text style={styles.sortBtnText}>{sortBy}</Text>
              </TouchableOpacity>
              {sortOpen ? (
                <View style={styles.sortMenu}>
                  {SORT_OPTIONS.map(option => (
                    <TouchableOpacity
                      key={option}
                      style={[styles.sortOption, sortBy === option && styles.sortOptionActive]}
                      onPress={() => {
                        setSortBy(option);
                        setSortOpen(false);
                      }}>
                      <Text style={[styles.sortOptionText, sortBy === option && styles.sortOptionTextActive]}>{option}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          </View>

          <Text style={styles.metaText}>{sortedSongs.length} tracks</Text>

          <FlatList
            data={sortedSongs}
            renderItem={renderTrackItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              loading ? null : (
                <View style={styles.emptyState}>
                  <Icon name="music-note-off" size={56} color={C.textMute} />
                  <Text style={styles.emptyTitle}>Your library is empty</Text>
                  <Text style={styles.emptySub}>Add file sources in the Files tab to import songs.</Text>
                </View>
              )
            }
          />
        </View>
      ) : null}

      {tab === 'playlists' ? (
        <View style={styles.panel}>
          <View style={styles.playlistSearchRow}>
            <View style={styles.searchBox}>
              <Icon name="magnify" size={18} color={C.textMute} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search playlists..."
                placeholderTextColor={C.textMute}
                value={playlistQuery}
                onChangeText={setPlaylistQuery}
              />
            </View>
            <TouchableOpacity style={styles.addPlaylistBtn} onPress={() => setCreateOpen(true)}>
              <Icon name="plus" size={20} color={C.bg} />
            </TouchableOpacity>
          </View>

          <Text style={styles.metaText}>{filteredPlaylists.length} playlists</Text>

          <ScrollView contentContainerStyle={styles.listContent}>
            {playlistRows.map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={styles.playlistRow}>
                {row.map((playlist, cardIndex) => {
                  const idx = rowIndex * 2 + cardIndex;
                  const color = MUSIC_HOME_ART_COLORS[ART_KEYS[idx % ART_KEYS.length]] || C.bgCard;
                  const icon = PLAYLIST_ICONS[idx % PLAYLIST_ICONS.length];
                  const songCount = Array.isArray(playlist.songs) ? playlist.songs.length : 0;
                  return (
                    <TouchableOpacity
                      key={playlist.id}
                      style={styles.playlistCard}
                      onPress={() => navigation.navigate('PlaylistDetail', {playlist})}
                      onLongPress={() => deletePlaylist(playlist)}>
                      <View style={[styles.playlistCover, {backgroundColor: color}]}>
                        <Icon name={icon} size={34} color={C.accentFg} />
                      </View>
                      <Text style={styles.playlistName} numberOfLines={1}>{playlist.name}</Text>
                      <Text style={styles.playlistCount} numberOfLines={1}>{songCount} Songs</Text>
                    </TouchableOpacity>
                  );
                })}
                {row.length === 1 ? <View style={styles.playlistCard} /> : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {tab === 'files' ? (
        <View style={styles.panel}>
          <View style={styles.filesHeader}>
            <Text style={styles.filesLabel}>FILE SOURCES</Text>
            <Text style={styles.metaText}>{sourceSummary.files} files · {sourceSummary.active} active sources</Text>
          </View>

          <ScrollView contentContainerStyle={styles.listContent}>
            {normalizedSources.map(source => (
              <View key={source.id} style={[styles.sourceCard, !source.on && styles.sourceCardDisabled]}>
                <View style={[styles.sourceAccent, source.on ? styles.sourceAccentOn : styles.sourceAccentOff]} />
                <View style={styles.sourceBody}>
                  <View style={styles.sourceTop}>
                    <View style={styles.sourcePathWrap}>
                      <Icon name="folder" size={16} color={source.on ? C.accentFg : C.textMute} />
                      <Text style={[styles.sourcePath, !source.on && styles.sourcePathDisabled]} numberOfLines={1}>{source.path}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.toggleTrack, source.on && styles.toggleTrackOn]}
                      onPress={() => toggleSource(source)}>
                      <View style={[styles.toggleThumb, source.on && styles.toggleThumbOn]} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.sourceBottom}>
                    <View style={styles.sourceCountWrap}>
                      <Icon name="file-music-outline" size={14} color={C.textDim} />
                      <Text style={styles.sourceCount}>{source.count} files</Text>
                    </View>

                    <View style={styles.formatWrap}>
                      {source.fmt.map(fmt => (
                        <View key={`${source.id}-${fmt}`} style={styles.fmtChip}>
                          <Text style={[styles.fmtText, !source.on && styles.fmtTextOff]}>{fmt}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            ))}

            <TouchableOpacity style={styles.addSourceBtn} onPress={addFileSource}>
              <Text style={styles.addSourceText}>+ Add file source</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      ) : null}

      {sortOpen ? <Pressable style={styles.backdrop} onPress={() => setSortOpen(false)} /> : null}

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setCreateOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Playlist</Text>
              <TouchableOpacity onPress={() => setCreateOpen(false)}>
                <Icon name="close" size={20} color={C.textDim} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Playlist name"
              placeholderTextColor={C.textMute}
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
            />
            <TextInput
              style={[styles.modalInput, styles.modalTextArea]}
              placeholder="Description (optional)"
              placeholderTextColor={C.textMute}
              value={newPlaylistDesc}
              onChangeText={setNewPlaylistDesc}
              multiline
            />
            <TouchableOpacity style={styles.modalCreateBtn} onPress={createPlaylist}>
              <Text style={styles.modalCreateText}>Create</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: C.bg},
  header: {
    paddingTop: 40,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: C.borderDim,
  },
  backBtn: {marginRight: 8, paddingRight: 4, paddingVertical: 2},
  headerTitle: {color: '#e8e2f8', fontSize: 40, fontWeight: '800', letterSpacing: -0.3},
  subTabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.borderDim,
  },
  subTabBtn: {flex: 1, alignItems: 'center', paddingVertical: 11},
  subTabText: {fontSize: 18, color: C.textMute, fontWeight: '500'},
  subTabTextActive: {color: C.text, fontWeight: '700'},
  subTabLine: {marginTop: 9, width: '54%', height: 2, backgroundColor: C.accent},
  panel: {flex: 1},
  controlsRow: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: C.accent,
    backgroundColor: C.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryBtnText: {marginLeft: 4, fontSize: 13, fontWeight: '700', color: '#fff'},
  ghostBtn: {
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ghostBtnText: {marginLeft: 4, fontSize: 13, fontWeight: '700', color: C.accentFg},
  sortWrap: {marginLeft: 'auto', position: 'relative', zIndex: 20},
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sortBtnText: {marginLeft: 4, fontSize: 13, fontWeight: '600', color: C.textDim},
  sortMenu: {
    position: 'absolute',
    top: 42,
    right: 0,
    minWidth: 140,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    overflow: 'hidden',
  },
  sortOption: {paddingHorizontal: 12, paddingVertical: 9},
  sortOptionActive: {backgroundColor: '#211840'},
  sortOptionText: {color: C.textDim, fontSize: 12, fontWeight: '600'},
  sortOptionTextActive: {color: C.accentFg},
  disabled: {opacity: 0.5},
  metaText: {color: C.textDeep, fontSize: 14, paddingHorizontal: 16, paddingBottom: 8},
  listContent: {paddingHorizontal: 16, paddingBottom: 180},
  trackCard: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    backgroundColor: C.bgCard,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    marginBottom: 8,
  },
  trackMain: {flex: 1, minHeight: 64, flexDirection: 'row', alignItems: 'center'},
  trackArtwork: {width: 64, height: 64},
  trackFallback: {width: 64, height: 64, alignItems: 'center', justifyContent: 'center'},
  trackMeta: {flex: 1, paddingHorizontal: 10},
  trackTitle: {color: C.text, fontSize: 14, fontWeight: '700'},
  trackArtist: {marginTop: 2, color: C.textMute, fontSize: 12},
  trackRight: {width: 58, minHeight: 64, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 8},
  trackDuration: {color: C.textDeep, fontSize: 11, marginBottom: 2},
  dotBtn: {width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center'},
  playlistSearchRow: {paddingTop: 12, paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center'},
  searchBox: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  searchInput: {flex: 1, marginLeft: 8, color: C.text, fontSize: 14},
  addPlaylistBtn: {width: 42, height: 42, marginLeft: 8, borderRadius: 8, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center'},
  playlistRow: {flexDirection: 'row', marginBottom: 14, gap: 10},
  playlistCard: {flex: 1},
  playlistCover: {height: 124, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center'},
  playlistName: {marginTop: 6, color: '#bdb5d8', fontSize: 15, fontWeight: '700'},
  playlistCount: {marginTop: 2, color: C.textMute, fontSize: 14},
  filesHeader: {paddingTop: 14, paddingHorizontal: 16, paddingBottom: 8},
  filesLabel: {color: C.textDim, fontSize: 22, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1},
  sourceCard: {flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.bgCard, marginBottom: 8, overflow: 'hidden'},
  sourceCardDisabled: {borderColor: C.borderDim, backgroundColor: '#16102a'},
  sourceAccent: {width: 3},
  sourceAccentOn: {backgroundColor: C.accent},
  sourceAccentOff: {backgroundColor: C.border},
  sourceBody: {flex: 1, paddingHorizontal: 12, paddingVertical: 10},
  sourceTop: {flexDirection: 'row', alignItems: 'center', marginBottom: 7},
  sourcePathWrap: {flex: 1, flexDirection: 'row', alignItems: 'center'},
  sourcePath: {marginLeft: 8, color: C.text, fontSize: 21, fontWeight: '700', flex: 1},
  sourcePathDisabled: {color: C.textMute},
  toggleTrack: {width: 36, height: 21, borderRadius: 12, backgroundColor: C.border, justifyContent: 'center', paddingHorizontal: 2},
  toggleTrackOn: {backgroundColor: C.accent},
  toggleThumb: {width: 16, height: 16, borderRadius: 8, backgroundColor: C.textMute, alignSelf: 'flex-start'},
  toggleThumbOn: {alignSelf: 'flex-end', backgroundColor: '#fff'},
  sourceBottom: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  sourceCountWrap: {flexDirection: 'row', alignItems: 'center'},
  sourceCount: {marginLeft: 6, color: C.textDim, fontSize: 14},
  formatWrap: {flexDirection: 'row', gap: 4},
  fmtChip: {borderRadius: 4, backgroundColor: C.border, paddingHorizontal: 6, paddingVertical: 2},
  fmtText: {color: C.accentFg, fontSize: 11, fontWeight: '800'},
  fmtTextOff: {color: C.textDeep},
  addSourceBtn: {marginTop: 2, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: C.border, minHeight: 52, alignItems: 'center', justifyContent: 'center'},
  addSourceText: {color: C.textMute, fontSize: 16, fontWeight: '500'},
  emptyState: {paddingTop: 90, alignItems: 'center', paddingHorizontal: 24},
  emptyTitle: {marginTop: 12, color: '#f0eaff', fontSize: 20, fontWeight: '700', textAlign: 'center'},
  emptySub: {marginTop: 8, color: C.textDim, fontSize: 13, textAlign: 'center'},
  backdrop: {...StyleSheet.absoluteFillObject, zIndex: 15},
  modalOverlay: {flex: 1, backgroundColor: 'rgba(8, 5, 18, 0.78)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20},
  modalCard: {width: '100%', borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.bgCard, padding: 16},
  modalHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12},
  modalTitle: {color: C.text, fontSize: 21, fontWeight: '700'},
  modalInput: {borderWidth: 1, borderColor: C.border, borderRadius: 8, backgroundColor: C.bg, color: C.text, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, fontSize: 14},
  modalTextArea: {minHeight: 90, textAlignVertical: 'top'},
  modalCreateBtn: {marginTop: 2, borderRadius: 8, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingVertical: 11},
  modalCreateText: {color: '#fff', fontSize: 14, fontWeight: '700'},
});

export default LibraryScreen;
