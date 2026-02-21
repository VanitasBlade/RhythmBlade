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
import {
  MUSIC_HOME_ART_COLORS,
  MUSIC_HOME_THEME as C,
} from '../theme/musicHomeTheme';

const DOWNLOAD_OPTIONS = [
  {label: 'Hi-Res', description: '24-bit FLAC (DASH) up to 192 kHz'},
  {label: 'CD Lossless', description: '16-bit / 44.1 kHz FLAC'},
  {label: '320kbps AAC', description: 'High quality AAC streaming'},
  {label: '96kbps AAC', description: 'Data saver AAC streaming'},
];

const SEARCH_TYPES = ['Tracks', 'Albums', 'Artists', 'Playlists'];
const DOWNLOADER_TABS = ['Search', 'Queue'];
const ACTIVE_QUEUE_STATUSES = new Set(['queued', 'preparing', 'downloading']);
const ART_FALLBACK_COLORS = Object.values(MUSIC_HOME_ART_COLORS);

const getFallbackArtColor = item => {
  const key = `${item?.title || ''}|${item?.artist || item?.subtitle || ''}`;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return (
    ART_FALLBACK_COLORS[Math.abs(hash) % ART_FALLBACK_COLORS.length] || C.bgCard
  );
};

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

  const cancelQueueItem = async job => {
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
    const fallbackColor = getFallbackArtColor(item);

    return (
      <View style={styles.resultCard}>
        <View style={[styles.resultArtworkShell, {backgroundColor: fallbackColor}]}>
          {item.artwork ? (
            <Image source={{uri: item.artwork}} style={styles.resultArtworkImage} />
          ) : (
            <Icon name="music-note" size={22} color={C.accentFg} />
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

        <View style={styles.resultRight}>
          <Text style={styles.resultDuration}>{durationText || '--:--'}</Text>
          {item.downloadable ? (
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
                <ActivityIndicator size="small" color={C.bg} />
              ) : (
                <Icon
                  name={isDone ? 'check' : 'download-outline'}
                  size={16}
                  color={C.bg}
                />
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  const renderQueueItem = ({item}) => {
    const progress = Number.isFinite(item.progress)
      ? Math.max(0, Math.min(100, Math.round(item.progress)))
      : 0;
    const active = ACTIVE_QUEUE_STATUSES.has(item.status || 'queued');
    const done = item.status === 'done';
    const failed = item.status === 'failed';
    const retrying = Boolean(retryingJobs[item.id]);
    const canceling = Boolean(cancelingJobs[item.id]);
    const fallbackColor = getFallbackArtColor(item);
    const barColor = failed ? '#9b1c1c' : done ? C.textDeep : C.accent;
    const statusColor = failed ? '#f87171' : done ? C.accentFg : C.accent;

    return (
      <View style={styles.queueCardShell}>
        <View style={[styles.queueCard, failed && styles.queueCardFailed]}>
          <View style={[styles.queueAccent, {backgroundColor: barColor}]} />
          <View style={[styles.queueArtworkWrap, {backgroundColor: fallbackColor}]}>
            {item.artwork ? (
              <Image source={{uri: item.artwork}} style={styles.queueArtwork} />
            ) : (
              <Icon name="music-note" size={22} color={C.accentFg} />
            )}
          </View>
          <View style={styles.queueInfo}>
            <View style={styles.queueHeader}>
              <Text style={styles.queueTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[styles.queueStatus, {color: statusColor}]}>
                {getQueueStatusLabel(item)}
              </Text>
            </View>
            <View style={styles.queueProgressTrack}>
              <View
                style={[
                  styles.queueProgressFill,
                  {width: `${progress}%`, backgroundColor: barColor},
                ]}
              />
            </View>
            <Text style={styles.queueMeta} numberOfLines={1}>
              {getQueueSubtitle(item)}
            </Text>
          </View>
          <View style={styles.queueActionWrap}>
            {failed ? (
              <TouchableOpacity
                style={[
                  styles.retrySquareButton,
                  retrying && styles.retrySquareButtonBusy,
                ]}
                onPress={() => retryQueueItem(item)}
                disabled={retrying}>
                {retrying ? (
                  <ActivityIndicator size="small" color={C.accentFg} />
                ) : (
                  <Icon name="refresh" size={15} color={C.accentFg} />
                )}
              </TouchableOpacity>
            ) : active ? (
              <TouchableOpacity
                style={[
                  styles.cancelSquareButton,
                  canceling && styles.cancelSquareButtonBusy,
                ]}
                onPress={() => cancelQueueItem(item)}
                disabled={canceling}>
                {canceling ? (
                  <ActivityIndicator size="small" color={C.textDim} />
                ) : (
                  <Icon name="close" size={15} color={C.textDim} />
                )}
              </TouchableOpacity>
            ) : done ? (
              <View style={styles.queueDoneState}>
                <Icon name="check-all" size={18} color={C.accentFg} />
              </View>
            ) : (
              <View style={styles.queueActionSpacer} />
            )}
          </View>
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
        <Icon name="magnify" size={22} color={C.textDeep} style={styles.emptyIcon} />
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
                    (!query.trim() || loading) && styles.searchActionButtonDisabled,
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  topBar: {
    paddingTop: 40,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: C.borderDim,
    backgroundColor: C.bg,
  },
  brand: {
    fontSize: 40,
    color: '#e8e2f8',
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1e1445',
  },
  settingsValue: {
    color: C.accentFg,
    fontWeight: '600',
    fontSize: 13,
    marginHorizontal: 6,
  },
  downloaderTabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: C.borderDim,
    paddingHorizontal: 16,
    backgroundColor: C.bg,
  },
  downloaderTabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    position: 'relative',
  },
  downloaderTabLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  downloaderTabText: {
    color: C.textMute,
    fontSize: 18,
    fontWeight: '500',
  },
  downloaderTabTextActive: {
    color: C.text,
    fontWeight: '700',
  },
  downloaderTabUnderline: {
    position: 'absolute',
    bottom: -1,
    left: '20%',
    right: '20%',
    height: 2,
    backgroundColor: C.accent,
  },
  queueBadge: {
    marginLeft: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.accent,
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
  searchControlsSection: {
    paddingBottom: 10,
  },
  searchTop: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  searchControlsDivider: {
    marginHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.borderDim,
  },
  searchInputWrap: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    paddingVertical: 0,
    paddingHorizontal: 8,
  },
  searchActionButton: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#1e1445',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchActionButtonDisabled: {
    opacity: 0.6,
  },
  searchTypeRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  searchTypeButton: {
    flex: 1,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 8,
    backgroundColor: C.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchTypeButtonGap: {
    marginRight: 6,
  },
  searchTypeButtonActive: {
    borderColor: C.accent,
    backgroundColor: C.accent,
  },
  searchTypeText: {
    color: C.textMute,
    fontSize: 13,
    fontWeight: '600',
  },
  searchTypeTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  searchResultsList: {
    flex: 1,
  },
  searchListContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 180,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    overflow: 'hidden',
    marginBottom: 8,
  },
  resultArtworkShell: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultArtworkImage: {
    width: 64,
    height: 64,
  },
  resultInfo: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  resultTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
  },
  resultArtist: {
    color: C.textMute,
    fontSize: 12,
    marginTop: 2,
  },
  resultMeta: {
    color: C.textDeep,
    fontSize: 11,
    marginTop: 2,
  },
  resultRight: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 10,
  },
  resultDuration: {
    color: C.textDeep,
    fontSize: 11,
    marginRight: 8,
    minWidth: 40,
    textAlign: 'right',
  },
  downloadButton: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },
  downloadButtonBusy: {
    opacity: 0.7,
  },
  downloadButtonDone: {
    backgroundColor: C.border,
    borderColor: C.textDeep,
  },
  downloadButtonRetry: {
    borderColor: '#7b3146',
    backgroundColor: '#2a1430',
  },
  queueListContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 180,
  },
  queueCardShell: {
    marginBottom: 8,
  },
  queueCard: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    overflow: 'hidden',
  },
  queueCardFailed: {
    borderColor: '#4a1a1a',
  },
  queueAccent: {
    width: 4,
  },
  queueArtworkWrap: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueArtwork: {
    width: 64,
    height: 64,
  },
  queueInfo: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  queueTitle: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    fontWeight: '700',
    marginRight: 6,
  },
  queueStatus: {
    fontSize: 11,
    fontWeight: '700',
  },
  queueProgressTrack: {
    height: 3,
    borderRadius: 1,
    backgroundColor: C.border,
    overflow: 'hidden',
  },
  queueProgressFill: {
    height: '100%',
    borderRadius: 1,
  },
  queueMeta: {
    color: C.textDeep,
    fontSize: 11,
    marginTop: 4,
  },
  queueActionWrap: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: 10,
  },
  queueActionSpacer: {
    width: 30,
  },
  retrySquareButton: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#1e0d3a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retrySquareButtonBusy: {
    opacity: 0.8,
  },
  cancelSquareButton: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.borderDim,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelSquareButtonBusy: {
    opacity: 0.75,
  },
  queueDoneState: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    paddingTop: 90,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  emptyIcon: {
    marginBottom: 8,
  },
  emptyTitle: {
    color: C.textDeep,
    fontSize: 20,
    fontWeight: '700',
  },
  emptySubtitle: {
    marginTop: 8,
    color: C.textMute,
    fontSize: 13,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 5, 18, 0.45)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 94,
    paddingHorizontal: 16,
  },
  modalCard: {
    minWidth: 170,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bgCard,
    paddingVertical: 6,
    paddingHorizontal: 0,
  },
  modalTitle: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 12,
    paddingBottom: 5,
  },
  optionRow: {
    backgroundColor: C.bgCard,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionRowSelected: {
    backgroundColor: '#211840',
  },
  optionTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  optionTitle: {
    color: C.text,
    fontSize: 11,
    fontWeight: '600',
  },
  optionSubtitle: {
    color: C.textMute,
    fontSize: 10,
    marginTop: 1,
  },
});

export default SearchScreen;
