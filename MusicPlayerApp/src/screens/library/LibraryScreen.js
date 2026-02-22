import React, {useCallback, useMemo, useState} from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DocumentPicker from 'react-native-document-picker';
import {useFocusEffect} from '@react-navigation/native';

import playbackService from '../../services/playback/PlaybackService';
import storageService from '../../services/storage/StorageService';
import {
  MUSIC_HOME_ART_COLORS,
  MUSIC_HOME_THEME as C,
} from '../../theme/musicHomeTheme';
import styles from './library.styles';
import {
  ART_KEYS,
  PLAYLIST_ICONS,
  SORT_OPTIONS,
  SUB_TABS,
  TRACK_ICONS,
} from './library.constants';
import {formatDuration, normalizeFormats, sortSongs} from './library.utils';

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
        playlistData.find(item => storageService.isFavoritesPlaylist(item)) ||
        null;

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
    for (let index = 0; index < filteredPlaylists.length; index += 2) {
      rows.push(filteredPlaylists.slice(index, index + 2));
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
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[randomIndex]] = [
        shuffled[randomIndex],
        shuffled[index],
      ];
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
      {
        text: 'Delete Song',
        style: 'destructive',
        onPress: () => deleteSong(song),
      },
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
      Alert.alert(
        'Create Playlist Failed',
        error.message || 'Could not create playlist',
      );
    }
  };

  const deletePlaylist = playlist => {
    if (storageService.isFavoritesPlaylist(playlist)) {
      Alert.alert(
        'Protected Playlist',
        'favorites is a default playlist and cannot be deleted.',
      );
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
    const color =
      MUSIC_HOME_ART_COLORS[ART_KEYS[index % ART_KEYS.length]] || C.bgCard;
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
            <Text style={styles.trackTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.trackArtist} numberOfLines={1}>
              {item.artist}
            </Text>
          </View>
        </TouchableOpacity>
        <View style={styles.trackRight}>
          <Text style={styles.trackDuration}>
            {formatDuration(item.duration)}
          </Text>
          <TouchableOpacity
            onPress={() => showSongOptions(item)}
            style={styles.dotBtn}>
            <Icon name="dots-horizontal" size={18} color={C.textMute} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.navigate('Home')}>
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
              <Text
                style={[styles.subTabText, active && styles.subTabTextActive]}>
                {item.label}
              </Text>
              {active ? <View style={styles.subTabLine} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === 'tracks' ? (
        <View style={styles.panel}>
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                sortedSongs.length === 0 && styles.disabled,
              ]}
              onPress={playAll}
              disabled={sortedSongs.length === 0}>
              <Icon name="play" size={14} color={C.accentFg} />
              <Text style={styles.primaryBtnText}>Play All</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.ghostBtn,
                sortedSongs.length === 0 && styles.disabled,
              ]}
              onPress={shufflePlay}
              disabled={sortedSongs.length === 0}>
              <Icon name="shuffle" size={13} color={C.accentFg} />
              <Text style={styles.ghostBtnText}>Shuffle</Text>
            </TouchableOpacity>

            <View style={styles.sortWrap}>
              <TouchableOpacity
                style={styles.sortBtn}
                onPress={() => setSortOpen(open => !open)}>
                <Icon name="sort-variant" size={13} color={C.textDim} />
                <Text style={styles.sortBtnText}>{sortBy}</Text>
              </TouchableOpacity>
              {sortOpen ? (
                <View style={styles.sortMenu}>
                  {SORT_OPTIONS.map(option => (
                    <TouchableOpacity
                      key={option}
                      style={[
                        styles.sortOption,
                        sortBy === option && styles.sortOptionActive,
                      ]}
                      onPress={() => {
                        setSortBy(option);
                        setSortOpen(false);
                      }}>
                      <Text
                        style={[
                          styles.sortOptionText,
                          sortBy === option && styles.sortOptionTextActive,
                        ]}>
                        {option}
                      </Text>
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
                  <Text style={styles.emptySub}>
                    Add file sources in the Files tab to import songs.
                  </Text>
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
            <TouchableOpacity
              style={styles.addPlaylistBtn}
              onPress={() => setCreateOpen(true)}>
              <Icon name="plus" size={20} color={C.bg} />
            </TouchableOpacity>
          </View>

          <Text style={styles.metaText}>
            {filteredPlaylists.length} playlists
          </Text>

          <ScrollView contentContainerStyle={styles.listContent}>
            {playlistRows.map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={styles.playlistRow}>
                {row.map((playlist, cardIndex) => {
                  const idx = rowIndex * 2 + cardIndex;
                  const color =
                    MUSIC_HOME_ART_COLORS[ART_KEYS[idx % ART_KEYS.length]] ||
                    C.bgCard;
                  const icon = PLAYLIST_ICONS[idx % PLAYLIST_ICONS.length];
                  const songCount = Array.isArray(playlist.songs)
                    ? playlist.songs.length
                    : 0;
                  return (
                    <TouchableOpacity
                      key={playlist.id}
                      style={styles.playlistCard}
                      onPress={() =>
                        navigation.navigate('PlaylistDetail', {playlist})
                      }
                      onLongPress={() => deletePlaylist(playlist)}>
                      <View
                        style={[
                          styles.playlistCover,
                          {backgroundColor: color},
                        ]}>
                        <Icon name={icon} size={34} color={C.accentFg} />
                      </View>
                      <Text style={styles.playlistName} numberOfLines={1}>
                        {playlist.name}
                      </Text>
                      <Text style={styles.playlistCount} numberOfLines={1}>
                        {songCount} Songs
                      </Text>
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
            <Text style={styles.metaText}>
              {sourceSummary.files} files | {sourceSummary.active} active
              sources
            </Text>
          </View>

          <ScrollView contentContainerStyle={styles.listContent}>
            {normalizedSources.map(source => (
              <View
                key={source.id}
                style={[
                  styles.sourceCard,
                  !source.on && styles.sourceCardDisabled,
                ]}>
                <View
                  style={[
                    styles.sourceAccent,
                    source.on ? styles.sourceAccentOn : styles.sourceAccentOff,
                  ]}
                />
                <View style={styles.sourceBody}>
                  <View style={styles.sourceTop}>
                    <View style={styles.sourcePathWrap}>
                      <Icon
                        name="folder"
                        size={16}
                        color={source.on ? C.accentFg : C.textMute}
                      />
                      <Text
                        style={[
                          styles.sourcePath,
                          !source.on && styles.sourcePathDisabled,
                        ]}
                        numberOfLines={1}>
                        {source.path}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.toggleTrack,
                        source.on && styles.toggleTrackOn,
                      ]}
                      onPress={() => toggleSource(source)}>
                      <View
                        style={[
                          styles.toggleThumb,
                          source.on && styles.toggleThumbOn,
                        ]}
                      />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.sourceBottom}>
                    <View style={styles.sourceCountWrap}>
                      <Icon name="music-note" size={15} color={C.textDim} />
                      <Text style={styles.sourceCount}>
                        {source.count} files
                      </Text>
                    </View>

                    <View style={styles.formatWrap}>
                      {source.fmt.map(fmt => (
                        <View
                          key={`${source.id}-${fmt}`}
                          style={styles.fmtChip}>
                          <Text
                            style={[
                              styles.fmtText,
                              !source.on && styles.fmtTextOff,
                            ]}>
                            {fmt}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            ))}

            <TouchableOpacity
              style={styles.addSourceBtn}
              onPress={addFileSource}>
              <Text style={styles.addSourceText}>+ Add file source</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      ) : null}

      {sortOpen ? (
        <Pressable style={styles.backdrop} onPress={() => setSortOpen(false)} />
      ) : null}

      <Modal
        visible={createOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateOpen(false)}>
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setCreateOpen(false)}>
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
            <TouchableOpacity
              style={styles.modalCreateBtn}
              onPress={createPlaylist}>
              <Text style={styles.modalCreateText}>Create</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

export default LibraryScreen;
