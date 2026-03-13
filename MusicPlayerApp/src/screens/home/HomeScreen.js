import { useFocusEffect } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  InteractionManager,
  RefreshControl,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import RNFS from 'react-native-fs';
import Svg, { Circle } from 'react-native-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import PlaylistArtwork from '../../components/PlaylistArtwork';
import playbackService from '../../services/playback/PlaybackService';
import storageService from '../../services/storage/StorageService';
import {
  getExtensionFromSong,
  normalizeFormatLabel,
} from '../../services/storage/storage.helpers';
import { MUSIC_HOME_THEME as C } from '../../theme/musicHomeTheme';
import SongCard from './SongCard';
import styles from './home.styles';

const SONG_ITEM_HEIGHT = 78;
const PLAYLIST_ITEM_SIZE = 112;
const PLAYLIST_LIST_HEIGHT = 132;
const PLAYLIST_LIST_VIEWPORT_WIDTH = Math.max(
  Dimensions.get('window').width - 32,
  PLAYLIST_ITEM_SIZE,
);
const RECENT_TRACKS_LIMIT = 5;
const idKeyExtractor = item => String(item?.id ?? '');
const playlistListSize = {
  height: PLAYLIST_LIST_HEIGHT,
  width: PLAYLIST_LIST_VIEWPORT_WIDTH,
};

const areSetsEqual = (left, right) => {
  if (left === right) {
    return true;
  }
  if (!(left instanceof Set) || !(right instanceof Set)) {
    return false;
  }
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
};

const areSongListsEquivalent = (left = [], right = []) => {
  if (left === right) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.id !== right[index]?.id) {
      return false;
    }
  }
  return true;
};

const formatBytes = (bytes, decimals = 1) => {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const StorageDonutChart = ({ breakdown = [], totalBytes, size = 60, strokeWidth = 8 }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const colors = ['#a288f5', '#ff7a9f', '#ffc168', '#4db2f8', '#20c997', '#a7a0be'];

  let currentPercentOffset = 0;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {breakdown.map((item, index) => {
          const percent = Math.min(Math.max(item.bytes / totalBytes, 0), 1);
          if (percent <= 0) return null;

          const strokeLength = percent * circumference;
          const strokeDasharray = `${strokeLength} ${circumference}`;
          const rotationAngle = -90 + (currentPercentOffset * 360);

          currentPercentOffset += percent;

          return (
            <Circle
              key={item.type}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={colors[index % colors.length]}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={strokeDasharray}
              strokeDashoffset={0}
              transform={`rotate(${rotationAngle} ${size / 2} ${size / 2})`}
            />
          );
        })}
      </Svg>
      <View style={{ marginLeft: 16 }}>
        {breakdown.length === 0 && <Text style={{ color: '#a7a0be', fontSize: 10 }}>No files yet</Text>}
        {breakdown.slice(0, 3).map((item, index) => (
          <View key={item.type} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors[index % colors.length], marginRight: 6 }} />
            <Text style={{ color: '#f0eaff', fontSize: 10, textTransform: 'uppercase', fontWeight: 'bold' }}>{item.type}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const LibraryAtAGlance = ({ stats, storageBytes, totalStorageBytes, storageBreakdown }) => {
  if (!stats) return null;

  // 1. Weekly Listening
  const today = new Date();
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    return { dateStr, dayName, seconds: stats.dailyListening?.[dateStr] || 0 };
  });

  const totalWeeklySeconds = last7Days.reduce((sum, day) => sum + day.seconds, 0);
  const maxDailySeconds = Math.max(...last7Days.map(d => d.seconds), 1);
  const weeklyHours = (totalWeeklySeconds / 3600).toFixed(1);

  // 2. Storage
  const storageGB = (storageBytes / (1024 ** 3)).toFixed(1);
  const totalGB = (totalStorageBytes / (1024 ** 3)).toFixed(1);

  // 3. Most Played
  const mostPlayed = stats.topSongData;
  const hasData = totalWeeklySeconds > 0 || storageBytes > 0;

  return (
    <View style={styles.bentoGrid}>
      {!hasData ? (
        <View style={styles.bentoEmpty}>
          <Text style={styles.bentoEmptyText}>Start listening to see your stats!</Text>
        </View>
      ) : (
        <>
          <View style={[styles.bentoCard, styles.bentoCardLarge]}>
            <View style={styles.weeklyHeaderRow}>
              <Text style={styles.bentoTitle}>Weekly Listening</Text>
              <Text style={styles.bentoSubtitleInline}>{weeklyHours} hrs</Text>
            </View>
            <View style={styles.barChartContainer}>
              {last7Days.map((day, i) => {
                const heightPercent = (day.seconds / maxDailySeconds) * 100;
                return (
                  <View key={i} style={styles.barCol}>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { height: `${heightPercent}%` }]} />
                    </View>
                    <Text style={styles.barLabel}>{day.dayName}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.bentoRow}>
            <View style={[styles.bentoCard, styles.bentoCardMedium, { marginRight: 8 }]}>
              <Text style={styles.bentoTitle}>Music Storage</Text>
              <View style={styles.storageDonutContainer}>
                <StorageDonutChart breakdown={storageBreakdown} totalBytes={totalStorageBytes} size={60} strokeWidth={8} />
              </View>
              <Text style={styles.bentoSubtitleCentered}>{storageGB} GB / {totalGB} GB</Text>
            </View>

            <View style={[styles.bentoCard, styles.bentoCardMedium]}>
              <Text style={styles.bentoTitle}>Most Played</Text>
              <View style={styles.mostPlayedContainer}>
                {mostPlayed ? (
                  <>
                    {mostPlayed.artwork ? (
                      <Image source={{ uri: mostPlayed.artwork }} style={styles.mostPlayedArtworkLarge} />
                    ) : (
                      <View style={styles.mostPlayedArtworkFallbackLarge}>
                        <Icon name="music-note" size={24} color={C.textMute} />
                      </View>
                    )}
                    <Text style={styles.mostPlayedTitle} numberOfLines={1}>{mostPlayed.title || 'Unknown'}</Text>
                    <Text style={styles.mostPlayedArtist} numberOfLines={1}>{mostPlayed.artist || 'Unknown'}</Text>
                  </>
                ) : (
                  <Text style={styles.bentoPlaceholder}>Your most played song will appear here</Text>
                )}
              </View>
            </View>
          </View>
        </>
      )}
    </View>
  );
};

const getPlaylistArtworkSignature = playlist => {
  const customArtwork = String(
    playlist?.customArtwork || playlist?.coverArtwork || '',
  ).trim();
  const songs = Array.isArray(playlist?.songs) ? playlist.songs : [];
  const firstFourArtwork = songs
    .slice(0, 4)
    .map(song => String(song?.artwork || '').trim())
    .join('|');
  return `${customArtwork}::${firstFourArtwork}`;
};

const arePlaylistsEquivalent = (left = [], right = []) => {
  if (left === right) {
    return true;
  }
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const previous = left[index];
    const next = right[index];
    if (
      previous !== next &&
      (String(previous?.id || '') !== String(next?.id || '') ||
        String(previous?.name || '') !== String(next?.name || '') ||
        String(previous?.description || '') !== String(next?.description || '') ||
        getPlaylistArtworkSignature(previous) !==
        getPlaylistArtworkSignature(next) ||
        ((Array.isArray(previous?.songs) ? previous.songs.length : 0) !==
          (Array.isArray(next?.songs) ? next.songs.length : 0)) ||
        (Number(previous?.updatedAt) || 0) !== (Number(next?.updatedAt) || 0))
    ) {
      return false;
    }
  }
  return true;
};

const areSyncStatesEquivalent = (left = {}, right = {}) =>
  Boolean(left?.isRunning) === Boolean(right?.isRunning) &&
  (Number(left?.startedAt) || 0) === (Number(right?.startedAt) || 0) &&
  (Number(left?.completedAt) || 0) === (Number(right?.completedAt) || 0) &&
  (Number(left?.lastSyncedAt) || 0) === (Number(right?.lastSyncedAt) || 0) &&
  String(left?.error || '') === String(right?.error || '');

const HomeListHeader = React.memo(
  ({
    dashboardData,
    isSyncing,
    onTriggerSync,
    onOpenSettings,
    onOpenLibrary,
    onOpenDownloader,
    onOpenPlaylists,
    playlists,
    profileAvatarDataUri,
    renderPlaylistCard,
    playlistKeyExtractor,
    onRefresh,
  }) => (
    <View>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Home</Text>
          <Text style={styles.headerSubtitle}>
            Your library at a glance
          </Text>
        </View>

        <TouchableOpacity
          style={styles.headerAction}
          onPress={onOpenSettings}>
          {profileAvatarDataUri ? (
            <Image
              source={{ uri: profileAvatarDataUri }}
              style={styles.profileImage}
            />
          ) : (
            <Text style={styles.profileInitial}>U</Text>
          )}
        </TouchableOpacity>
      </View>

      <LibraryAtAGlance
        stats={dashboardData.listeningStats}
        storageBytes={dashboardData.storageUsageBytes}
        totalStorageBytes={dashboardData.storageTotalBytes}
        storageBreakdown={dashboardData.storageUsageBreakdown}
      />

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Playlists</Text>
        <TouchableOpacity onPress={onOpenPlaylists}>
          <Text style={styles.sectionAction}>View all</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.playlistsListWrap}>
        <FlashList
          horizontal
          data={playlists}
          renderItem={renderPlaylistCard}
          keyExtractor={playlistKeyExtractor}
          estimatedItemSize={PLAYLIST_ITEM_SIZE}
          estimatedListSize={playlistListSize}
          disableHorizontalListHeightMeasurement
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          contentContainerStyle={styles.playlistsRow}
          drawDistance={PLAYLIST_ITEM_SIZE * 2}
        />
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Recent Tracks</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Text style={styles.sectionAction}>Refresh</Text>
        </TouchableOpacity>
      </View>
    </View>
  ),
);

HomeListHeader.displayName = 'HomeListHeader';

const HomeScreen = ({ navigation }) => {
  const [recentSongs, setRecentSongs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [dashboardData, setDashboardData] = useState({
    listeningStats: null,
    storageUsageBytes: 0,
    storageUsageBreakdown: [],
    storageTotalBytes: 10 * 1024 * 1024 * 1024,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profileAvatarDataUri, setProfileAvatarDataUri] = useState('');
  const [syncState, setSyncState] = useState(() =>
    storageService.getLibrarySyncState(),
  );
  const previousSyncRunningRef = useRef(
    Boolean(storageService.getLibrarySyncState()?.isRunning),
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [library, playlistData, avatarUri, listeningStats, fsInfo] = await Promise.all([
        storageService.getLocalLibrary(),
        storageService.getPlaylists(),
        storageService.getProfileAvatar(),
        storageService.getListeningStats(),
        RNFS.getFSInfo().catch(() => ({ totalSpace: 0 })),
      ]);

      const recent = [...library]
        .sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0))
        .slice(0, RECENT_TRACKS_LIMIT);

      const usageByFormat = new Map();
      const unresolvedSongs = [];

      library.forEach(song => {
        const type = normalizeFormatLabel(getExtensionFromSong(song));
        const current = usageByFormat.get(type) || { type, bytes: 0 };

        const knownSize = Math.max(0, Number(song?.fileSizeBytes) || 0);
        if (knownSize > 0) {
          current.bytes += knownSize;
        } else {
          const path = storageService.resolveSongLocalPath(song);
          if (path) {
            unresolvedSongs.push({ type, path });
          }
        }
        usageByFormat.set(type, current);
      });

      const STAT_BATCH_SIZE = 8;
      for (let index = 0; index < unresolvedSongs.length; index += STAT_BATCH_SIZE) {
        const batch = unresolvedSongs.slice(index, index + STAT_BATCH_SIZE);
        const stats = await Promise.all(
          batch.map(async entry => {
            const stat = await RNFS.stat(entry.path).catch(() => null);
            return {
              type: entry.type,
              bytes: Math.max(0, Number(stat?.size) || 0),
            };
          })
        );
        stats.forEach(statEntry => {
          if (!statEntry.bytes) return;
          const target = usageByFormat.get(statEntry.type);
          if (target) {
            target.bytes += statEntry.bytes;
          }
        });
      }

      const storageUsageBreakdown = Array.from(usageByFormat.values())
        .filter(item => item.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes);
      const storageUsageBytes = storageUsageBreakdown.reduce((sum, item) => sum + item.bytes, 0);

      setDashboardData({
        listeningStats,
        storageUsageBytes,
        storageUsageBreakdown,
        storageTotalBytes: 10 * 1024 * 1024 * 1024, // 10 GB FIXED
      });

      const favorites =
        playlistData.find(playlist =>
          storageService.isFavoritesPlaylist(playlist),
        ) || null;
      const nextFavoriteIds = new Set((favorites?.songs || []).map(song => song.id));

      setRecentSongs(prev => (areSongListsEquivalent(prev, recent) ? prev : recent));
      setPlaylists(prev =>
        arePlaylistsEquivalent(prev, playlistData) ? prev : playlistData,
      );
      setFavoriteIds(prev =>
        areSetsEqual(prev, nextFavoriteIds) ? prev : nextFavoriteIds,
      );
      const nextAvatar = String(avatarUri || '').trim();
      setProfileAvatarDataUri(prev => (prev === nextAvatar ? prev : nextAvatar));
    } catch (error) {
      console.error('Error loading home data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const task = InteractionManager.runAfterInteractions(() => {
        if (active) {
          loadData();
        }
      });

      return () => {
        active = false;
        task.cancel();
      };
    }, [loadData]),
  );

  useEffect(() => {
    const unsubscribe = storageService.subscribeToLibrarySync(nextState => {
      const wasRunning = previousSyncRunningRef.current;
      const isRunning = Boolean(nextState?.isRunning);
      previousSyncRunningRef.current = isRunning;
      const normalizedNext = nextState || {};
      setSyncState(prev =>
        areSyncStatesEquivalent(prev, normalizedNext) ? prev : normalizedNext,
      );
      if (wasRunning && !isRunning) {
        loadData();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const triggerLibrarySync = useCallback(async () => {
    try {
      await storageService.runLibrarySyncInBackground({
        promptForPermission: true,
      });
    } catch (error) {
      console.error('Manual library sync failed:', error);
    }
  }, []);

  const loadDataWithFallback = useCallback(() => {
    loadData().catch(error => {
      console.error('Home data load failed:', error);
    });
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadDataWithFallback();
    }, [loadDataWithFallback]),
  );

  const resumePlayback = useCallback(async (trackToResume) => {
    if (!trackToResume) return;

    try {
      const currentTrack = await playbackService.getCurrentTrack();
      if (currentTrack?.id === trackToResume.id) {
        // Already active, just play
        await playbackService.play();
      } else {
        // Fallback track, set it as queue
        await playbackService.playSong(trackToResume);
      }
      navigation.navigate('NowPlaying', {
        optimisticTrack: trackToResume,
        shuffleActive: playbackService.isShuffleEnabled(),
      });
    } catch (error) {
      console.error('Error resuming playback:', error);
    }
  }, [navigation]);

  const playSong = useCallback(
    async index => {
      const nextTrack = recentSongs[index];
      if (!nextTrack) {
        return;
      }

      try {
        await playbackService.playSongs(recentSongs, { startIndex: index });
        navigation.navigate('NowPlaying', {
          optimisticTrack: nextTrack,
          shuffleActive: false,
        });
      } catch (error) {
        console.error('Error playing song:', error);
      }
    },
    [recentSongs, navigation],
  );

  const toggleFavorite = useCallback(async song => {
    try {
      const result = await storageService.toggleSongInFavorites(song);
      const nextPlaylists = Array.isArray(result?.playlists) ? result.playlists : [];
      const nextFavoriteIds = new Set(
        (result?.playlist?.songs || []).map(item => item.id),
      );
      setPlaylists(prev =>
        arePlaylistsEquivalent(prev, nextPlaylists) ? prev : nextPlaylists,
      );
      setFavoriteIds(prev =>
        areSetsEqual(prev, nextFavoriteIds) ? prev : nextFavoriteIds,
      );
    } catch (error) {
      console.error('Error toggling favorite:', error);
    }
  }, []);

  const openPlaylist = useCallback(
    playlist => {
      navigation.navigate('PlaylistDetail', { playlist });
    },
    [navigation],
  );

  const openSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  const openLibrary = useCallback(() => {
    navigation.navigate('Library');
  }, [navigation]);

  const openDownloader = useCallback(() => {
    navigation.navigate('Search');
  }, [navigation]);

  const openPlaylistsTab = useCallback(() => {
    navigation.navigate('Library', { libraryTab: 'playlists' });
  }, [navigation]);

  const renderPlaylistCard = useCallback(
    ({ item }) => {
      const isFavorites = storageService.isFavoritesPlaylist(item);
      return (
        <TouchableOpacity
          key={item.id}
          style={styles.playlistCard}
          onPress={() => openPlaylist(item)}>
          <PlaylistArtwork
            playlist={item}
            size={94}
            borderRadius={7}
            placeholderIcon={isFavorites ? 'heart' : 'playlist-music'}
            placeholderIconColor={isFavorites ? '#f7a8cf' : C.textMute}
            placeholderIconSize={30}
            emptyCellIconSize={16}
          />
          <Text style={styles.playlistName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.playlistCount} numberOfLines={1}>
            {item.songs.length} songs
          </Text>
        </TouchableOpacity>
      );
    },
    [openPlaylist],
  );

  const playlistKeyExtractor = useCallback(item => String(item?.id ?? ''), []);

  const listHeader = useMemo(
    () => (
      <HomeListHeader
        dashboardData={dashboardData}
        isSyncing={Boolean(syncState?.isRunning)}
        onTriggerSync={triggerLibrarySync}
        onOpenSettings={openSettings}
        onOpenLibrary={openLibrary}
        onOpenDownloader={openDownloader}
        onOpenPlaylists={openPlaylistsTab}
        playlists={playlists}
        profileAvatarDataUri={profileAvatarDataUri}
        renderPlaylistCard={renderPlaylistCard}
        playlistKeyExtractor={playlistKeyExtractor}
        onRefresh={onRefresh}
      />
    ),
    [
      dashboardData,
      syncState?.isRunning,
      triggerLibrarySync,
    ],
  );

  const renderSongItem = useCallback(
    ({ item, index }) => (
      <SongCard
        item={item}
        index={index}
        isFavorite={favoriteIds.has(item.id)}
        onPress={playSong}
        onFavorite={toggleFavorite}
      />
    ),
    [favoriteIds, playSong, toggleFavorite],
  );

  const renderEmpty = useCallback(() => {
    if (loading) {
      return null;
    }

    return (
      <View style={styles.emptyContainer}>
        <Icon
          name="music-off"
          size={58}
          color={C.textMute}
        />
        <Text style={styles.emptyTitle}>
          No songs in your library
        </Text>
        <Text style={styles.emptySubtitle}>
          Download songs from the Downloader tab.
        </Text>
      </View>
    );
  }, [loading]);

  return (
    <View style={styles.container}>
      <FlashList
        data={recentSongs}
        renderItem={renderSongItem}
        keyExtractor={idKeyExtractor}
        estimatedItemSize={SONG_ITEM_HEIGHT}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.accentFg}
          />
        }
        drawDistance={420}
      />
    </View>
  );
};

export default HomeScreen;
