import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import apiService from '../../services/api/ApiService';
import storageService from '../../services/storage/StorageService';
import {MUSIC_HOME_THEME as C} from '../../theme/musicHomeTheme';
import QueueItemCard from './components/QueueItemCard';
import SearchResultCard from './components/SearchResultCard';
import styles from './search.styles';
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

  const mountedRef = useRef(true);
  const pollInFlightRef = useRef(false);
  const persistedJobsRef = useRef(new Set());

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
      const jobs = await apiService.getDownloadJobs(100);
      if (mountedRef.current) {
        setQueue(jobs);
      }
    } catch (error) {
      // Queue polling is best-effort.
    } finally {
      pollInFlightRef.current = false;
    }
  }, []);

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
          await storageService.saveRemoteSongToDevice(job.song);
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

  const searchSongs = useCallback(async () => {
    if (!query.trim()) {
      return;
    }

    try {
      setLoading(true);
      setResults([]);
      const songs = await apiService.searchSongs(
        query.trim(),
        activeSearchType.toLowerCase(),
      );
      setResults(songs);

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
  }, [activeSearchType, query]);

  const queueDownload = useCallback(
    async (item, index) => {
      if (!item.downloadable) {
        return;
      }

      const resolvedIndex = Number.isInteger(item?.index)
        ? item.index
        : Number.isInteger(index)
        ? index
        : null;

      const key = toTrackKey(item);
      const existingJob = queueByTrackKey.get(key);
      if (existingJob && existingJob.status !== 'failed') {
        setActiveDownloaderTab('Queue');
        return;
      }

      try {
        setQueuingKeys(prev => ({...prev, [key]: true}));
        const job = await apiService.startDownload(
          item,
          resolvedIndex,
          downloadSetting,
        );
        if (mountedRef.current) {
          setQueue(prev => {
            const withoutDup = prev.filter(existing => existing.id !== job.id);
            return [...withoutDup, job];
          });
          setActiveDownloaderTab('Queue');
        }
      } catch (error) {
        Alert.alert(
          'Download Failed',
          error.message || 'Failed to queue download. Please try again.',
        );
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
    [downloadSetting, queueByTrackKey],
  );

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
        const retriedJob = await apiService.retryDownload(
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
    [downloadSetting, retryingJobs],
  );

  const cancelQueueItem = useCallback(
    async job => {
      if (!job?.id || cancelingJobs[job.id]) {
        return;
      }

      try {
        setCancelingJobs(prev => ({...prev, [job.id]: true}));
        await apiService.cancelDownload(job.id);
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
    [cancelingJobs],
  );

  const renderSearchResult = useCallback(
    ({item, index}) => {
      const key = toTrackKey(item);
      return (
        <SearchResultCard
          item={item}
          index={index}
          activeSearchType={activeSearchType}
          linkedJob={queueByTrackKey.get(key)}
          isQueuing={Boolean(queuingKeys[key])}
          onQueueDownload={queueDownload}
        />
      );
    },
    [activeSearchType, queueByTrackKey, queuingKeys, queueDownload],
  );

  const renderQueueItem = useCallback(
    ({item}) => (
      <QueueItemCard
        item={item}
        retrying={Boolean(retryingJobs[item.id])}
        canceling={Boolean(cancelingJobs[item.id])}
        onRetry={retryQueueItem}
        onCancel={cancelQueueItem}
      />
    ),
    [cancelQueueItem, cancelingJobs, retryQueueItem, retryingJobs],
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
          Find tracks, albums, artists, or playlists.
        </Text>
      </View>
    );
  }, [activeSearchType, loading, query]);

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
                  placeholder="Search songs, albums, artists..."
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

          <FlatList
            style={styles.searchResultsList}
            data={results}
            renderItem={renderSearchResult}
            keyExtractor={(item, index) =>
              `${item.type || activeSearchType}-${item.title}-${index}`
            }
            contentContainerStyle={styles.searchListContent}
            ListEmptyComponent={renderSearchEmpty}
          />
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
    </View>
  );
};

export default SearchScreen;
