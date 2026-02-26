import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {WebView} from 'react-native-webview';

import storageService from '../../services/storage/StorageService';
import {MUSIC_HOME_THEME as C} from '../../theme/musicHomeTheme';
import QueueItemCard from './components/QueueItemCard';
import SearchResultCard from './components/SearchResultCard';
import styles from './search.styles';
import useSquidWebViewDownloader from './useSquidWebViewDownloader';
import {
  ACTIVE_QUEUE_STATUSES,
  DOWNLOAD_OPTIONS,
  DOWNLOADER_TABS,
  SEARCH_TYPES,
} from './search.constants';
import {toTrackKey} from './search.utils';

const SearchScreen = () => {
  const [query, setQuery] = useState('');
  const [activeSearchType, setActiveSearchType] = useState('Tracks');
  const [activeDownloaderTab, setActiveDownloaderTab] = useState('Search');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [queue, setQueue] = useState([]);
  const [queuingKeys, setQueuingKeys] = useState({});
  const [retryingJobs, setRetryingJobs] = useState({});
  const [cancelingJobs, setCancelingJobs] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloadSetting, setDownloadSetting] = useState('Hi-Res');
  const [activeAlbum, setActiveAlbum] = useState(null);
  const [albumTracks, setAlbumTracks] = useState([]);
  const [albumTracksLoading, setAlbumTracksLoading] = useState(false);
  const [albumQueueingAll, setAlbumQueueingAll] = useState(false);

  const mountedRef = useRef(true);
  const pollInFlightRef = useRef(false);
  const persistedJobsRef = useRef(new Set());
  const dismissedDoneJobsRef = useRef(new Set());
  const {
    webViewRef,
    webViewProps,
    searchSongs: searchSongsFromWebView,
    getAlbumTracks: getAlbumTracksFromWebView,
    startDownload: startDownloadFromWebView,
    getDownloadJobs: getDownloadJobsFromWebView,
    retryDownload: retryDownloadFromWebView,
    cancelDownload: cancelDownloadFromWebView,
  } = useSquidWebViewDownloader();

  const currentOption = useMemo(
    () =>
      DOWNLOAD_OPTIONS.find(option => option.label === downloadSetting) ||
      DOWNLOAD_OPTIONS[0],
    [downloadSetting],
  );

  const activeQueueCount = useMemo(
    () =>
      queue.filter(job => ACTIVE_QUEUE_STATUSES.has(job.status || 'queued'))
        .length,
    [queue],
  );

  const orderedQueue = useMemo(
    () => [...queue].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    [queue],
  );

  const queueByTrackKey = useMemo(() => {
    const map = new Map();

    queue.forEach(job => {
      const key = toTrackKey(job);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, job);
        return;
      }

      const existingActive = ACTIVE_QUEUE_STATUSES.has(existing.status);
      const nextActive = ACTIVE_QUEUE_STATUSES.has(job.status);
      if (
        (nextActive && !existingActive) ||
        (job.updatedAt || 0) > (existing.updatedAt || 0)
      ) {
        map.set(key, job);
      }
    });

    return map;
  }, [queue]);

  const refreshQueue = useCallback(async () => {
    if (pollInFlightRef.current) {
      return;
    }
    pollInFlightRef.current = true;
    try {
      const jobs = await getDownloadJobsFromWebView(100);
      if (mountedRef.current) {
        jobs.forEach(job => {
          if (job.status !== 'done') {
            dismissedDoneJobsRef.current.delete(job.id);
          }
        });
        const filtered = jobs.filter(
          job =>
            !(
              job.status === 'done' && dismissedDoneJobsRef.current.has(job.id)
            ),
        );
        setQueue(filtered);
      }
    } catch (error) {
      // Queue polling is best-effort.
    } finally {
      pollInFlightRef.current = false;
    }
  }, [getDownloadJobsFromWebView]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      mountedRef.current = true;

      const loadFocusedData = async () => {
        const settings = await storageService.getSettings();
        if (active && settings?.downloadSetting) {
          setDownloadSetting(settings.downloadSetting);
        }
        await refreshQueue();
      };

      loadFocusedData();
      const timer = setInterval(() => {
        refreshQueue();
      }, 1200);

      return () => {
        active = false;
        mountedRef.current = false;
        clearInterval(timer);
      };
    }, [refreshQueue]),
  );

  useEffect(() => {
    const persistCompletedDownloads = async () => {
      const completedJobs = queue.filter(
        job =>
          job.status === 'done' &&
          job.song?.id &&
          !persistedJobsRef.current.has(job.id),
      );

      for (const job of completedJobs) {
        persistedJobsRef.current.add(job.id);
        try {
          const isAlreadyLocalFile =
            job?.song?.isLocal &&
            String(job?.song?.url || '').startsWith('file://');
          if (!isAlreadyLocalFile) {
            await storageService.saveRemoteSongToDevice(job.song);
          }
        } catch (error) {
          persistedJobsRef.current.delete(job.id);
          // Do not block queue rendering for storage failures.
        }
      }
    };

    persistCompletedDownloads();
  }, [queue]);

  const persistDownloadSetting = useCallback(async nextSetting => {
    setDownloadSetting(nextSetting);
    const settings = await storageService.getSettings();
    await storageService.saveSettings({
      ...settings,
      downloadSetting: nextSetting,
    });
  }, []);

  const closeAlbumView = useCallback(() => {
    setActiveAlbum(null);
    setAlbumTracks([]);
    setAlbumTracksLoading(false);
    setAlbumQueueingAll(false);
  }, []);

  const getSearchResultKey = useCallback(
    (item, index) => {
      const type = String(item?.type || activeSearchType || 'track').toLowerCase();
      const tidalId = String(item?.tidalId || '').trim();
      const url = String(item?.url || '').trim();
      const title = String(item?.title || 'unknown').trim();
      const artist = String(item?.artist || '').trim();
      const itemIndex = Number.isInteger(item?.index) ? item.index : index;
      const identity = tidalId || url || `${title}|${artist}|${item?.duration || 0}`;
      return `${type}-${identity}-${itemIndex}`;
    },
    [activeSearchType],
  );

  const searchSongs = useCallback(async () => {
    if (!query.trim()) {
      return;
    }

    try {
      Keyboard.dismiss();
      setLoading(true);
      setResults([]);
      closeAlbumView();
      const songs = await searchSongsFromWebView(
        query.trim(),
        activeSearchType.toLowerCase(),
      );
      setResults(songs);
      console.log('[SquidWV UI] FlatList render diagnostics.', {
        requestedCount: songs.length,
        sampleKeys: songs.slice(0, 10).map((item, index) =>
          getSearchResultKey(item, index),
        ),
      });
      console.log('[SquidWV UI] Search state updated.', {
        query: query.trim(),
        searchType: activeSearchType.toLowerCase(),
        count: songs.length,
        firstFive: songs.slice(0, 5).map(item => ({
          title: item?.title,
          artist: item?.artist,
          index: item?.index,
          tidalId: item?.tidalId || null,
          url: item?.url || null,
        })),
      });

      if (songs.length === 0) {
        Alert.alert(
          'No Results',
          `No ${activeSearchType.toLowerCase()} found for your search.`,
        );
      }
    } catch (error) {
      Alert.alert(
        'Search Error',
        error.message || 'Failed to search. Please check your connection.',
      );
    } finally {
      setLoading(false);
    }
  }, [
    activeSearchType,
    closeAlbumView,
    getSearchResultKey,
    query,
    searchSongsFromWebView,
  ]);

  const queueDownload = useCallback(
    async (item, index, options = {}) => {
      const suppressAlert = Boolean(options?.suppressAlert);
      const switchToQueue =
        typeof options?.switchToQueue === 'boolean' ? options.switchToQueue : true;

      if (!item.downloadable) {
        return {status: 'not-downloadable'};
      }

      const resolvedIndex = Number.isInteger(item?.index)
        ? item.index
        : Number.isInteger(index)
        ? index
        : null;

      const key = toTrackKey(item);
      const existingJob = queueByTrackKey.get(key);
      if (existingJob && existingJob.status !== 'failed') {
        if (switchToQueue) {
          setActiveDownloaderTab('Queue');
        }
        return {status: 'exists', job: existingJob};
      }

      try {
        setQueuingKeys(prev => ({...prev, [key]: true}));
        const job = await startDownloadFromWebView(
          item,
          resolvedIndex,
          downloadSetting,
        );
        if (mountedRef.current) {
          setQueue(prev => {
            const withoutDup = prev.filter(existing => existing.id !== job.id);
            return [...withoutDup, job];
          });
          if (switchToQueue) {
            setActiveDownloaderTab('Queue');
          }
        }
        return {status: 'queued', job};
      } catch (error) {
        if (!suppressAlert) {
          Alert.alert(
            'Download Failed',
            error.message || 'Failed to queue download. Please try again.',
          );
        }
        return {status: 'failed', error};
      } finally {
        if (mountedRef.current) {
          setQueuingKeys(prev => {
            const next = {...prev};
            delete next[key];
            return next;
          });
        }
      }
    },
    [downloadSetting, queueByTrackKey, startDownloadFromWebView],
  );

  const openAlbum = useCallback(async album => {
    if (!album?.url) {
      Alert.alert('Album Error', 'Album details are unavailable for this item.');
      return;
    }

    setActiveAlbum(album);
    setAlbumTracks([]);
    setAlbumTracksLoading(true);
    setAlbumQueueingAll(false);

    try {
      const tracks = await getAlbumTracksFromWebView(album);
      if (!mountedRef.current) {
        return;
      }
      setAlbumTracks(tracks);
      if (tracks.length === 0) {
        Alert.alert('No Tracks', 'No tracks found for this album.');
      }
    } catch (error) {
      if (mountedRef.current) {
        setActiveAlbum(null);
        setAlbumTracks([]);
        Alert.alert(
          'Album Error',
          error.message || 'Failed to load album tracks.',
        );
      }
    } finally {
      if (mountedRef.current) {
        setAlbumTracksLoading(false);
      }
    }
  }, [getAlbumTracksFromWebView]);

  const queueAlbumTracksAll = useCallback(async () => {
    if (!activeAlbum || albumQueueingAll || albumTracks.length === 0) {
      return;
    }

    setAlbumQueueingAll(true);
    let queued = 0;
    let skipped = 0;
    let failed = 0;

    try {
      for (const track of albumTracks) {
        const result = await queueDownload(track, track?.index, {
          suppressAlert: true,
          switchToQueue: false,
        });

        if (result?.status === 'queued') {
          queued += 1;
        } else if (
          result?.status === 'exists' ||
          result?.status === 'not-downloadable'
        ) {
          skipped += 1;
        } else {
          failed += 1;
        }
      }
    } finally {
      if (mountedRef.current) {
        setAlbumQueueingAll(false);
      }
    }

    if (failed > 0) {
      Alert.alert(
        'Album Queue Result',
        `Queued ${queued} tracks, skipped ${skipped}, failed ${failed}.`,
      );
      return;
    }

    Alert.alert(
      'Album Queued',
      skipped > 0
        ? `Queued ${queued} tracks. Skipped ${skipped} already in queue.`
        : `Queued ${queued} tracks from ${activeAlbum.title}.`,
    );
  }, [activeAlbum, albumQueueingAll, albumTracks, queueDownload]);

  const retryQueueItem = useCallback(
    async job => {
      if (!job?.id || retryingJobs[job.id]) {
        return;
      }

      try {
        setRetryingJobs(prev => ({...prev, [job.id]: true}));
        const fallbackSong = {
          title: job.title,
          artist: job.artist || 'Unknown Artist',
          album: job.album || '',
          artwork: job.artwork || null,
          duration: job.duration || 0,
          downloadable: true,
        };
        const retriedJob = await retryDownloadFromWebView(
          job.id,
          fallbackSong,
          job.downloadSetting || downloadSetting,
        );
        if (mountedRef.current && retriedJob) {
          setQueue(prev => {
            const filtered = prev.filter(
              existing =>
                existing.id !== job.id && existing.id !== retriedJob.id,
            );
            return [...filtered, retriedJob];
          });
        }
      } catch (error) {
        Alert.alert(
          'Retry Failed',
          error.message || 'Could not retry this download.',
        );
      } finally {
        if (mountedRef.current) {
          setRetryingJobs(prev => {
            const next = {...prev};
            delete next[job.id];
            return next;
          });
        }
      }
    },
    [downloadSetting, retryDownloadFromWebView, retryingJobs],
  );

  const cancelQueueItem = useCallback(
    async job => {
      if (!job?.id || cancelingJobs[job.id]) {
        return;
      }

      try {
        setCancelingJobs(prev => ({...prev, [job.id]: true}));
        await cancelDownloadFromWebView(job.id);
        if (mountedRef.current) {
          setQueue(prev => prev.filter(existing => existing.id !== job.id));
        }
      } catch (error) {
        Alert.alert(
          'Cancel Failed',
          error.message || 'Could not cancel this download.',
        );
      } finally {
        if (mountedRef.current) {
          setCancelingJobs(prev => {
            const next = {...prev};
            delete next[job.id];
            return next;
          });
        }
      }
    },
    [cancelDownloadFromWebView, cancelingJobs],
  );

  const dismissDoneQueueItem = useCallback(jobId => {
    if (!jobId) {
      return;
    }
    dismissedDoneJobsRef.current.add(jobId);
    if (mountedRef.current) {
      setQueue(prev => prev.filter(existing => existing.id !== jobId));
    }
  }, []);

  const renderSearchResult = useCallback(
    ({item, index}) => {
      const key = toTrackKey(item);
      const canOpenAlbum =
        activeSearchType === 'Albums' &&
        (item?.type === 'album' || String(item?.url || '').includes('/album/'));

      return (
        <SearchResultCard
          item={item}
          index={index}
          activeSearchType={activeSearchType}
          linkedJob={queueByTrackKey.get(key)}
          isQueuing={Boolean(queuingKeys[key])}
          onQueueDownload={queueDownload}
          onPress={canOpenAlbum ? openAlbum : null}
        />
      );
    },
    [activeSearchType, openAlbum, queueByTrackKey, queuingKeys, queueDownload],
  );

  const renderAlbumTrack = useCallback(
    ({item, index}) => {
      const key = toTrackKey(item);
      return (
        <SearchResultCard
          item={item}
          index={index}
          activeSearchType="Tracks"
          linkedJob={queueByTrackKey.get(key)}
          isQueuing={Boolean(queuingKeys[key])}
          onQueueDownload={(trackItem, trackIndex) =>
            queueDownload(trackItem, trackIndex, {switchToQueue: false})
          }
        />
      );
    },
    [queueByTrackKey, queuingKeys, queueDownload],
  );

  const renderQueueItem = useCallback(
    ({item}) => (
      <QueueItemCard
        item={item}
        retrying={Boolean(retryingJobs[item.id])}
        canceling={Boolean(cancelingJobs[item.id])}
        onRetry={retryQueueItem}
        onCancel={cancelQueueItem}
        onDoneAnimationComplete={dismissDoneQueueItem}
      />
    ),
    [
      cancelQueueItem,
      cancelingJobs,
      dismissDoneQueueItem,
      retryQueueItem,
      retryingJobs,
    ],
  );

  const renderSearchEmpty = useCallback(() => {
    if (loading) {
      return null;
    }

    return (
      <View style={styles.emptyContainer}>
        <Icon
          name="magnify"
          size={22}
          color={C.textDeep}
          style={styles.emptyIcon}
        />
        <Text style={styles.emptyTitle}>
          {query
            ? `No ${activeSearchType.toLowerCase()} found`
            : `Search ${activeSearchType.toLowerCase()}`}
        </Text>
        <Text style={styles.emptySubtitle}>
          Find tracks or albums.
        </Text>
      </View>
    );
  }, [activeSearchType, loading, query]);

  const renderAlbumTracksHeader = useCallback(
    () => (
      <View style={styles.albumHeaderCard}>
        <View style={styles.albumHeaderTopRow}>
          <TouchableOpacity
            style={styles.albumBackButton}
            onPress={closeAlbumView}
            disabled={albumQueueingAll}>
            <Icon name="arrow-left" size={15} color={C.textDim} />
            <Text style={styles.albumBackText}>Back to albums</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.albumQueueAllButton,
              (albumQueueingAll || albumTracksLoading || albumTracks.length === 0) &&
                styles.albumQueueAllButtonDisabled,
            ]}
            onPress={queueAlbumTracksAll}
            disabled={albumQueueingAll || albumTracksLoading || albumTracks.length === 0}>
            {albumQueueingAll ? (
              <ActivityIndicator size="small" color={C.accentFg} />
            ) : (
              <Icon name="download-multiple" size={14} color={C.accentFg} />
            )}
            <Text style={styles.albumQueueAllText}>Download all</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.albumHeaderTitle} numberOfLines={2}>
          {activeAlbum?.title || 'Album'}
        </Text>
        <Text style={styles.albumHeaderMeta} numberOfLines={1}>
          {activeAlbum?.artist || 'Unknown Artist'}
          {albumTracks.length > 0 ? `  •  ${albumTracks.length} tracks` : ''}
        </Text>
      </View>
    ),
    [
      activeAlbum,
      albumQueueingAll,
      albumTracks.length,
      albumTracksLoading,
      closeAlbumView,
      queueAlbumTracksAll,
    ],
  );

  const renderAlbumTracksEmpty = useCallback(
    () => (
      <View style={styles.albumTracksEmptyWrap}>
        {albumTracksLoading ? (
          <>
            <ActivityIndicator size="small" color={C.accent} />
            <Text style={styles.albumTracksLoadingText}>Loading album tracks...</Text>
          </>
        ) : (
          <>
            <Icon
              name="music-note-off-outline"
              size={20}
              color={C.textDeep}
              style={styles.emptyIcon}
            />
            <Text style={styles.emptySubtitle}>No tracks found for this album.</Text>
          </>
        )}
      </View>
    ),
    [albumTracksLoading],
  );

  const renderQueueEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <Icon
          name="download-outline"
          size={22}
          color={C.textDeep}
          style={styles.emptyIcon}
        />
        <Text style={styles.emptyTitle}>Queue is empty</Text>
        <Text style={styles.emptySubtitle}>
          Start downloads from the Search tab.
        </Text>
      </View>
    ),
    [],
  );

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>Downloader</Text>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => setSettingsOpen(true)}>
          <Icon name="music-note-eighth" size={14} color={C.textDim} />
          <Text style={styles.settingsValue}>{currentOption.label}</Text>
          <Icon name="chevron-down" size={15} color={C.textMute} />
        </TouchableOpacity>
      </View>

      <View style={styles.downloaderTabsRow}>
        {DOWNLOADER_TABS.map(tab => {
          const active = tab === activeDownloaderTab;
          const isQueueTab = tab === 'Queue';
          return (
            <TouchableOpacity
              key={tab}
              style={styles.downloaderTabButton}
              onPress={() => setActiveDownloaderTab(tab)}>
              <View style={styles.downloaderTabLabelWrap}>
                <Text
                  style={[
                    styles.downloaderTabText,
                    active && styles.downloaderTabTextActive,
                  ]}>
                  {tab}
                </Text>
                {isQueueTab && activeQueueCount > 0 ? (
                  <View style={styles.queueBadge}>
                    <Text style={styles.queueBadgeText}>
                      {activeQueueCount}
                    </Text>
                  </View>
                ) : null}
              </View>
              {active ? <View style={styles.downloaderTabUnderline} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {activeDownloaderTab === 'Search' ? (
        <View style={styles.searchPanel}>
          <View style={styles.searchControlsSection}>
            <View style={styles.searchTop}>
              <View style={styles.searchInputWrap}>
                <Icon name="magnify" size={16} color={C.textMute} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search tracks or albums..."
                  placeholderTextColor={C.textMute}
                  value={query}
                  onChangeText={setQuery}
                  onSubmitEditing={searchSongs}
                  returnKeyType="search"
                />
                <TouchableOpacity
                  style={[
                    styles.searchActionButton,
                    (!query.trim() || loading) &&
                      styles.searchActionButtonDisabled,
                  ]}
                  onPress={searchSongs}
                  disabled={!query.trim() || loading}>
                  {loading ? (
                    <ActivityIndicator size="small" color={C.accentFg} />
                  ) : (
                    <Icon name="arrow-right" size={14} color={C.accentFg} />
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.searchTypeRow}>
                {SEARCH_TYPES.map((tab, index) => {
                  const active = tab === activeSearchType;
                  return (
                    <TouchableOpacity
                      key={tab}
                      style={[
                        styles.searchTypeButton,
                        index < SEARCH_TYPES.length - 1 &&
                          styles.searchTypeButtonGap,
                        active && styles.searchTypeButtonActive,
                      ]}
                      onPress={() => {
                        setActiveSearchType(tab);
                        setResults([]);
                        closeAlbumView();
                      }}>
                      <Text
                        style={[
                          styles.searchTypeText,
                          active && styles.searchTypeTextActive,
                        ]}>
                        {tab}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <View style={styles.searchControlsDivider} />
          </View>

          {activeAlbum ? (
            <ScrollView
              style={styles.searchResultsList}
              contentContainerStyle={styles.searchListContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}>
              {renderAlbumTracksHeader()}
              {albumTracks.length > 0
                ? albumTracks.map((item, index) => (
                    <View key={getSearchResultKey(item, index)}>
                      {renderAlbumTrack({item, index})}
                    </View>
                  ))
                : renderAlbumTracksEmpty()}
            </ScrollView>
          ) : (
            <ScrollView
              style={styles.searchResultsList}
              contentContainerStyle={styles.searchListContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}>
              {results.length > 0
                ? results.map((item, index) => (
                    <View key={getSearchResultKey(item, index)}>
                      {renderSearchResult({item, index})}
                    </View>
                  ))
                : renderSearchEmpty()}
            </ScrollView>
          )}
        </View>
      ) : (
        <FlatList
          data={orderedQueue}
          renderItem={renderQueueItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.queueListContent}
          ListEmptyComponent={renderQueueEmpty}
        />
      )}

      <Modal
        transparent
        visible={settingsOpen}
        animationType="fade"
        onRequestClose={() => setSettingsOpen(false)}>
        <TouchableOpacity
          activeOpacity={1}
          style={styles.modalBackdrop}
          onPress={() => setSettingsOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Download quality</Text>
            {DOWNLOAD_OPTIONS.map(option => {
              const selected = option.label === downloadSetting;
              return (
                <TouchableOpacity
                  key={option.label}
                  style={[
                    styles.optionRow,
                    selected && styles.optionRowSelected,
                  ]}
                  onPress={async () => {
                    await persistDownloadSetting(option.label);
                    setSettingsOpen(false);
                  }}>
                  <View style={styles.optionTextWrap}>
                    <Text style={styles.optionTitle}>{option.label}</Text>
                    <Text style={styles.optionSubtitle}>
                      {option.description}
                    </Text>
                  </View>
                  {selected ? (
                    <Icon name="check" size={13} color={C.accentFg} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      <WebView
        ref={webViewRef}
        {...webViewProps}
        style={styles.hiddenWebView}
      />
    </View>
  );
};

export default SearchScreen;
