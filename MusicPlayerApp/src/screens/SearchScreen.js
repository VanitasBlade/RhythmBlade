import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import apiService from '../services/api';
import storageService from '../services/storage';

const DOWNLOAD_OPTIONS = [
  {label: 'Hi-Res', description: '24-bit FLAC (DASH) up to 192 kHz'},
  {label: 'CD Lossless', description: '16-bit / 44.1 kHz FLAC'},
  {label: '320kbps AAC', description: 'High quality AAC streaming'},
  {label: '96kbps AAC', description: 'Data saver AAC streaming'},
];

const SEARCH_TYPES = ['Tracks', 'Albums', 'Artists', 'Playlists'];
const DOWNLOADER_TABS = ['Search', 'Queue'];
const ACTIVE_QUEUE_STATUSES = new Set(['queued', 'preparing', 'downloading']);

const normalizeText = value =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const toTrackKey = item =>
  `${normalizeText(item?.title)}|${normalizeText(
    item?.artist || item?.subtitle || '',
  )}`;

const formatDuration = value => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  const totalSeconds = Math.floor(Number(value));
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '';
  }
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

const formatBytes = bytes => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
};

const getQueueStatusLabel = job => {
  if (job.status === 'done') {
    return 'Done';
  }
  if (job.status === 'failed') {
    return 'Failed';
  }
  if (job.status === 'queued') {
    return 'Queued';
  }
  const pct = Number.isFinite(job.progress) ? Math.round(job.progress) : 0;
  return `${Math.max(0, Math.min(100, pct))}%`;
};

const getQueueSubtitle = job => {
  if (job.status === 'failed') {
    return job.error || 'Download failed.';
  }

  const downloaded = formatBytes(job.downloadedBytes);
  const total = formatBytes(job.totalBytes);
  if (job.status === 'done') {
    return total || downloaded || 'Completed';
  }
  if (downloaded && total) {
    return `${downloaded} / ${total}`;
  }
  if (job.status === 'queued') {
    return 'Waiting in queue...';
  }
  if (job.phase === 'resolving') {
    return 'Resolving track...';
  }
  if (job.phase === 'saving') {
    return 'Finalizing file...';
  }
  return 'Downloading...';
};

const SearchScreen = () => {
  const [query, setQuery] = useState('');
  const [activeSearchType, setActiveSearchType] = useState('Tracks');
  const [activeDownloaderTab, setActiveDownloaderTab] = useState('Search');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [queue, setQueue] = useState([]);
  const [queuingKeys, setQueuingKeys] = useState({});
  const [retryingJobs, setRetryingJobs] = useState({});
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

  useEffect(() => {
    const loadInitialData = async () => {
      const settings = await storageService.getSettings();
      if (mountedRef.current && settings?.downloadSetting) {
        setDownloadSetting(settings.downloadSetting);
      }
      await refreshQueue();
    };

    loadInitialData();
    const timer = setInterval(() => {
      refreshQueue();
    }, 1200);

    return () => {
      clearInterval(timer);
      mountedRef.current = false;
    };
  }, [refreshQueue]);

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

  const persistDownloadSetting = async nextSetting => {
    setDownloadSetting(nextSetting);
    const settings = await storageService.getSettings();
    await storageService.saveSettings({
      ...settings,
      downloadSetting: nextSetting,
    });
  };

  const searchSongs = async () => {
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
  };

  const queueDownload = async (item, index) => {
    if (!item.downloadable) {
      return;
    }

    const key = toTrackKey(item);
    const existingJob = queueByTrackKey.get(key);
    if (existingJob && existingJob.status !== 'failed') {
      setActiveDownloaderTab('Queue');
      return;
    }

    try {
      setQueuingKeys(prev => ({...prev, [key]: true}));
      const job = await apiService.startDownload(item, index, downloadSetting);
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
  };

  const retryQueueItem = async job => {
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
            existing => existing.id !== job.id && existing.id !== retriedJob.id,
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
  };

  const renderSearchResult = ({item, index}) => {
    const key = toTrackKey(item);
    const linkedJob = queueByTrackKey.get(key);
    const isQueuing = Boolean(queuingKeys[key]);
    const isActive = linkedJob
      ? ACTIVE_QUEUE_STATUSES.has(linkedJob.status)
      : false;
    const isDone = linkedJob?.status === 'done';
    const isFailed = linkedJob?.status === 'failed';
    const disabled = !item.downloadable || isQueuing || isActive || isDone;
    const durationText = formatDuration(item.duration);

    return (
      <View style={styles.resultCard}>
        <View style={styles.resultLeft}>
          {item.artwork ? (
            <Image source={{uri: item.artwork}} style={styles.artworkImage} />
          ) : (
            <View style={styles.artworkPlaceholder}>
              <Icon name="music-note" size={20} color="#b8aef5" />
            </View>
          )}
        </View>

        <View style={styles.resultInfo}>
          <Text style={styles.resultTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.resultArtist} numberOfLines={1}>
            {item.artist || item.subtitle || activeSearchType}
          </Text>
          {!!item.subtitle && (
            <Text style={styles.resultMeta} numberOfLines={1}>
              {item.subtitle}
            </Text>
          )}
        </View>

        {item.downloadable ? (
          <View style={styles.resultRight}>
            <Text style={styles.resultDuration}>{durationText || '--:--'}</Text>
            <TouchableOpacity
              style={[
                styles.downloadButton,
                isDone && styles.downloadButtonDone,
                isFailed && styles.downloadButtonRetry,
                (isQueuing || isActive) && styles.downloadButtonBusy,
              ]}
              onPress={() => queueDownload(item, index)}
              disabled={disabled}>
              {isQueuing || isActive ? (
                <ActivityIndicator size="small" color="#efe8ff" />
              ) : (
                <Icon
                  name={isDone ? 'check' : 'download-outline'}
                  size={18}
                  color="#efe8ff"
                />
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  const renderQueueItem = ({item}) => {
    const progress = Number.isFinite(item.progress)
      ? Math.max(0, Math.min(100, Math.round(item.progress)))
      : 0;
    const done = item.status === 'done';
    const failed = item.status === 'failed';
    const retrying = Boolean(retryingJobs[item.id]);

    return (
      <View style={styles.queueCard}>
        <View
          style={[
            styles.queueAccent,
            done && styles.queueAccentDone,
            failed && styles.queueAccentFailed,
          ]}
        />
        <View style={styles.queueArtworkWrap}>
          {item.artwork ? (
            <Image source={{uri: item.artwork}} style={styles.queueArtwork} />
          ) : (
            <View style={styles.queueArtworkFallback}>
              <Icon name="music-note" size={22} color="#c5baf5" />
            </View>
          )}
        </View>
        <View style={styles.queueInfo}>
          <View style={styles.queueHeader}>
            <Text style={styles.queueTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <View style={styles.queueHeaderRight}>
              <Text
                style={[
                  styles.queueStatus,
                  done && styles.queueStatusDone,
                  failed && styles.queueStatusFailed,
                ]}>
                {getQueueStatusLabel(item)}
              </Text>
              {failed ? (
                <TouchableOpacity
                  style={[
                    styles.retryCircleButton,
                    retrying && styles.retryCircleButtonBusy,
                  ]}
                  onPress={() => retryQueueItem(item)}
                  disabled={retrying}>
                  {retrying ? (
                    <ActivityIndicator size="small" color="#efe8ff" />
                  ) : (
                    <Icon name="refresh" size={14} color="#efe8ff" />
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          <View style={styles.queueProgressTrack}>
            <View
              style={[
                styles.queueProgressFill,
                {
                  width: `${progress}%`,
                },
                done && styles.queueProgressDone,
                failed && styles.queueProgressFailed,
              ]}
            />
          </View>
          <Text style={styles.queueMeta} numberOfLines={1}>
            {getQueueSubtitle(item)}
          </Text>
        </View>
      </View>
    );
  };

  const renderSearchEmpty = () => {
    if (loading) {
      return null;
    }

    return (
      <View style={styles.emptyContainer}>
        <Icon name="cloud-search-outline" size={62} color="#6f61a8" />
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
  };

  const renderQueueEmpty = () => (
    <View style={styles.emptyContainer}>
      <Icon name="download-outline" size={62} color="#6f61a8" />
      <Text style={styles.emptyTitle}>Queue is empty</Text>
      <Text style={styles.emptySubtitle}>
        Start downloads from the Search tab.
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>Downloader</Text>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => setSettingsOpen(true)}>
          <Icon name="cog-outline" size={17} color="#efe8ff" />
          <Text style={styles.settingsValue}>{currentOption.label}</Text>
          <Icon name="chevron-down" size={18} color="#b9aae8" />
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
          <View style={styles.searchRow}>
            <View style={styles.searchInputWrap}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search for tracks, albums, artists..."
                placeholderTextColor="#6f61a8"
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={searchSongs}
                returnKeyType="search"
              />
            </View>
            <TouchableOpacity
              style={[
                styles.searchButton,
                (!query.trim() || loading) && styles.searchButtonDisabled,
              ]}
              onPress={searchSongs}
              disabled={!query.trim() || loading}>
              {loading ? (
                <ActivityIndicator size="small" color="#efe8ff" />
              ) : (
                <>
                  <Icon name="magnify" size={20} color="#efe8ff" />
                  <Text style={styles.searchButtonText}>Search</Text>
                </>
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

          <FlatList
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
            <Text style={styles.modalTitle}>Streaming & Downloads</Text>
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
                    <Icon name="check" size={18} color="#efe8ff" />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0822',
  },
  topBar: {
    paddingTop: 54,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#261a45',
    backgroundColor: '#100928',
  },
  brand: {
    fontSize: 30,
    color: '#f0eaff',
    fontWeight: '800',
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#443470',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#1b1038',
  },
  settingsValue: {
    color: '#d7ccff',
    fontWeight: '700',
    fontSize: 13,
    marginHorizontal: 6,
  },
  downloaderTabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#261a45',
    paddingHorizontal: 16,
    backgroundColor: '#100928',
  },
  downloaderTabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  downloaderTabLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  downloaderTabText: {
    color: '#8172b8',
    fontSize: 17,
    fontWeight: '600',
  },
  downloaderTabTextActive: {
    color: '#efe8ff',
  },
  downloaderTabUnderline: {
    marginTop: 10,
    height: 2,
    alignSelf: 'stretch',
    backgroundColor: '#8f5dff',
  },
  queueBadge: {
    marginLeft: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#8f5dff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  queueBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  searchPanel: {
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  searchInputWrap: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3b2a62',
    backgroundColor: '#191033',
    paddingHorizontal: 12,
    justifyContent: 'center',
    minHeight: 48,
    marginRight: 10,
  },
  searchInput: {
    color: '#efe8ff',
    fontSize: 16,
  },
  searchButton: {
    minWidth: 98,
    borderRadius: 12,
    backgroundColor: '#8f5dff',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: 10,
  },
  searchButtonDisabled: {
    opacity: 0.65,
  },
  searchButtonText: {
    color: '#efe8ff',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 4,
  },
  searchTypeRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#261a45',
  },
  searchTypeButton: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#322456',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#171030',
    alignItems: 'center',
  },
  searchTypeButtonGap: {
    marginRight: 8,
  },
  searchTypeButtonActive: {
    borderColor: '#8f5dff',
    backgroundColor: '#2d1b54',
  },
  searchTypeText: {
    color: '#9f93c8',
    fontSize: 13,
    fontWeight: '600',
  },
  searchTypeTextActive: {
    color: '#f0eaff',
  },
  searchListContent: {
    padding: 16,
    paddingBottom: 110,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a1f49',
    backgroundColor: '#16102f',
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
    minHeight: 74,
  },
  resultLeft: {
    marginRight: 10,
  },
  artworkImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  artworkPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#291a4d',
  },
  resultInfo: {
    flex: 1,
    marginRight: 8,
  },
  resultTitle: {
    color: '#f0eaff',
    fontSize: 17,
    fontWeight: '700',
  },
  resultArtist: {
    color: '#c9bbf3',
    fontSize: 14,
    marginTop: 2,
  },
  resultMeta: {
    color: '#8f82b6',
    fontSize: 12,
    marginTop: 2,
  },
  resultRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minWidth: 84,
  },
  resultDuration: {
    color: '#8f82b6',
    fontSize: 12,
    marginRight: 10,
    minWidth: 34,
    textAlign: 'right',
  },
  downloadButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3f2e69',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#29184b',
  },
  downloadButtonBusy: {
    opacity: 0.75,
  },
  downloadButtonDone: {
    backgroundColor: '#3a2a64',
    borderColor: '#5f49a0',
  },
  downloadButtonRetry: {
    borderColor: '#ad5f72',
  },
  queueListContent: {
    padding: 16,
    paddingBottom: 110,
  },
  queueCard: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a1f49',
    backgroundColor: '#16102f',
    marginBottom: 10,
    overflow: 'hidden',
  },
  queueAccent: {
    width: 4,
    backgroundColor: '#8f5dff',
  },
  queueAccentDone: {
    backgroundColor: '#6f5cad',
  },
  queueAccentFailed: {
    backgroundColor: '#d8667b',
  },
  queueArtworkWrap: {
    width: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#251843',
  },
  queueArtwork: {
    width: 58,
    height: 58,
  },
  queueArtworkFallback: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueInfo: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  queueTitle: {
    flex: 1,
    color: '#f0eaff',
    fontSize: 16,
    fontWeight: '700',
    marginRight: 8,
  },
  queueHeaderRight: {
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  queueStatus: {
    color: '#8f5dff',
    fontSize: 13,
    fontWeight: '700',
  },
  queueStatusDone: {
    color: '#bca8ff',
  },
  queueStatusFailed: {
    color: '#ef7c93',
  },
  retryCircleButton: {
    marginLeft: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ad5f72',
    backgroundColor: '#3b1630',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryCircleButtonBusy: {
    opacity: 0.8,
  },
  queueProgressTrack: {
    height: 4,
    borderRadius: 3,
    backgroundColor: '#2b2146',
    overflow: 'hidden',
  },
  queueProgressFill: {
    height: '100%',
    backgroundColor: '#8f5dff',
  },
  queueProgressDone: {
    backgroundColor: '#9a83e2',
  },
  queueProgressFailed: {
    backgroundColor: '#d8667b',
  },
  queueMeta: {
    color: '#9f93c8',
    fontSize: 12,
    marginTop: 7,
  },
  emptyContainer: {
    paddingTop: 90,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    marginTop: 14,
    color: '#f0eaff',
    fontSize: 19,
    fontWeight: '700',
  },
  emptySubtitle: {
    marginTop: 8,
    color: '#9b8ec5',
    fontSize: 14,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 3, 16, 0.72)',
    justifyContent: 'flex-start',
    paddingTop: 120,
    paddingHorizontal: 18,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#4b3a7a',
    backgroundColor: '#150d2f',
    padding: 12,
  },
  modalTitle: {
    color: '#f0eaff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  optionRow: {
    borderWidth: 1,
    borderColor: '#35265e',
    borderRadius: 12,
    backgroundColor: '#150d2f',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionRowSelected: {
    borderColor: '#8f5dff',
    backgroundColor: '#281a4b',
  },
  optionTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  optionTitle: {
    color: '#efe8ff',
    fontSize: 17,
    fontWeight: '700',
  },
  optionSubtitle: {
    color: '#9f93c8',
    fontSize: 13,
    marginTop: 2,
  },
});

export default SearchScreen;
