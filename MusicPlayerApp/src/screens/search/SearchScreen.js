import {useFocusEffect} from '@react-navigation/native';
import {FlashList} from '@shopify/flash-list';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  Keyboard,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {WebView} from 'react-native-webview';

import storageService from '../../services/storage/StorageService';
import {MUSIC_HOME_THEME as C} from '../../theme/musicHomeTheme';
import QueueItemCard from './components/QueueItemCard';
import SearchResultCard from './components/SearchResultCard';
import {
  ACTIVE_QUEUE_STATUSES,
  DEFAULT_DOWNLOAD_SETTING,
  DOWNLOAD_OPTIONS,
  DOWNLOADER_TABS,
  getDownloadSettingShortLabel,
  normalizeDownloadSetting,
  SEARCH_TYPES,
} from './search.constants';
import styles from './search.styles';
import {toTrackKey} from './search.utils';
import useSpotdownWebViewDownloader from './useSpotdownWebViewDownloader';
import useSquidWebViewDownloader from './useSquidWebViewDownloader';

const queueKeyExtractor = item =>
  `${String(item?.source || 'tidal')}:${item.id}`;
const AGGRESSIVE_QUEUE_POLL_MS = 450;
const IDLE_QUEUE_POLL_MS = 4200;
const SEARCH_RESULT_ESTIMATED_ITEM_SIZE = 88;
const QUEUE_ESTIMATED_ITEM_SIZE = 90;
const IDLE_TIMEOUT_MS = 30000;
const BACKGROUND_TIMEOUT_MS = 120000;
const WEBVIEW_DISPLAY_FLEX = {display: 'flex'};
const WEBVIEW_DISPLAY_NONE = {display: 'none'};
const SOURCE_OPTIONS = [
  {
    value: 'Tidal',
    borderColor: '#3b82f6',
  },
  {
    value: 'Spotdown',
    borderColor: '#22c55e',
  },
];
const SPOTDOWN_LOCKED_QUALITY_LABEL = 'MP3';
const SPOTDOWN_IDLE_ACTIVITY_TYPES = new Set([
  'SPOTDOWN_DOWNLOAD_STARTED',
  'SPOTDOWN_DOWNLOAD_CHUNK',
  'SPOTDOWN_DOWNLOAD_URL',
  'SPOTDOWN_DOWNLOAD_ERROR',
  'SPOTDOWN_SESSION_TOKEN',
]);

const toComparableNumber = value => Number(value) || 0;
const resolveAutoConvertAacToMp3Default = settings => {
  if (typeof settings?.autoConvertAacToMp3 === 'boolean') {
    return settings.autoConvertAacToMp3;
  }
  return settings?.convertAacToMp3 === true;
};

const areQueueItemsEquivalent = (left, right) => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    String(left.source || 'tidal') === String(right.source || 'tidal') &&
    String(left.id || '') === String(right.id || '') &&
    String(left.status || '') === String(right.status || '') &&
    toComparableNumber(left.progress) === toComparableNumber(right.progress) &&
    toComparableNumber(left.updatedAt) ===
      toComparableNumber(right.updatedAt) &&
    toComparableNumber(left.createdAt) === toComparableNumber(right.createdAt)
  );
};

const areQueueListsEquivalent = (left = [], right = []) => {
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
    if (!areQueueItemsEquivalent(left[index], right[index])) {
      return false;
    }
  }
  return true;
};

const getSourceKey = value =>
  String(value || '')
    .trim()
    .toLowerCase() === 'spotdown'
    ? 'spotdown'
    : 'tidal';
const getTrackKeyForSource = (item, source) =>
  `${getSourceKey(source)}:${toTrackKey(item)}`;
const toJobScopeKey = job =>
  `${getSourceKey(job?.source || 'tidal')}:${String(job?.id || '')}`;
const isSpotifyUrlInput = value =>
  /^https?:\/\/open\.spotify\.com\//i.test(String(value || '').trim());

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
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [downloadSetting, setDownloadSetting] = useState(
    DEFAULT_DOWNLOAD_SETTING,
  );
  const [downloadSource, setDownloadSource] = useState('Tidal');
  const [sourceActiveCounts, setSourceActiveCounts] = useState({
    tidal: 0,
    spotdown: 0,
  });
  const [bridgeReadyBySource, setBridgeReadyBySource] = useState({
    tidal: false,
    spotdown: false,
  });
  const [spotdownLastSubmission, setSpotdownLastSubmission] = useState({
    query: '',
    isSpotifyUrl: false,
  });
  const [spotdownBatchJobIds, setSpotdownBatchJobIds] = useState([]);
  const [bridgeEnabled, setBridgeEnabled] = useState(true);
  const [activeAlbum, setActiveAlbum] = useState(null);
  const [albumTracks, setAlbumTracks] = useState([]);
  const [albumTracksLoading, setAlbumTracksLoading] = useState(false);
  const [albumQueueingAll, setAlbumQueueingAll] = useState(false);
  const [convertAacToMp3, setConvertAacToMp3] = useState(false);
  const [
    autoDisableBridgeAfterInactivity,
    setAutoDisableBridgeAfterInactivity,
  ] = useState(false);

  const mountedRef = useRef(true);
  const isMountedRef = useRef(true);
  const isFocusedRef = useRef(false);
  const loadingRef = useRef(false);
  const albumTracksLoadingRef = useRef(false);
  const bridgeEnabledRef = useRef(true);
  const autoDisableBridgeRef = useRef(false);
  const idleTimerRef = useRef(null);
  const backgroundTimerRef = useRef(null);
  const isDownloadingRef = useRef(false);
  const hasInteractedSinceEnableRef = useRef(false);
  const pendingBackgroundAfterDownloadRef = useRef(false);
  const previousBridgeEnabledRef = useRef(true);
  const downloadSettingRef = useRef(DEFAULT_DOWNLOAD_SETTING);
  const pollInFlightRef = useRef(false);
  const persistedJobsRef = useRef(new Set());
  const dismissedDoneJobsRef = useRef(new Set());
  const downloadDefaultsAppliedRef = useRef(false);
  const activeDownloaderTabRef = useRef('Search');
  const activeQueueCountRef = useRef(0);
  const sourceActiveCountsRef = useRef({tidal: 0, spotdown: 0});
  const activeSourceRef = useRef('tidal');
  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const clearBackgroundTimer = useCallback(() => {
    if (backgroundTimerRef.current) {
      clearTimeout(backgroundTimerRef.current);
      backgroundTimerRef.current = null;
    }
  }, []);

  const clearAllBridgeTimers = useCallback(() => {
    clearIdleTimer();
    clearBackgroundTimer();
    pendingBackgroundAfterDownloadRef.current = false;
  }, [clearBackgroundTimer, clearIdleTimer]);

  const tearDownIfSafe = useCallback(
    reason => {
      if (!isMountedRef.current) {
        return false;
      }
      if (!bridgeEnabledRef.current) {
        return false;
      }
      if (isDownloadingRef.current || activeQueueCountRef.current > 0) {
        return false;
      }
      if (loadingRef.current || albumTracksLoadingRef.current) {
        return false;
      }
      clearAllBridgeTimers();
      hasInteractedSinceEnableRef.current = false;
      if (__DEV__) {
        console.log('[DownloaderBridge] Auto-disabled bridge.', {reason});
      }
      setBridgeEnabled(false);
      return true;
    },
    [clearAllBridgeTimers],
  );

  const armIdleTimer = useCallback(
    reason => {
      if (!isMountedRef.current) {
        return;
      }
      if (!isFocusedRef.current) {
        return;
      }
      if (!autoDisableBridgeRef.current || !bridgeEnabledRef.current) {
        return;
      }
      clearIdleTimer();
      idleTimerRef.current = setTimeout(() => {
        tearDownIfSafe(`idle:${reason || 'timer'}`);
      }, IDLE_TIMEOUT_MS);
    },
    [clearIdleTimer, tearDownIfSafe],
  );

  const startBackgroundTimer = useCallback(
    reason => {
      if (!isMountedRef.current) {
        return;
      }
      if (!autoDisableBridgeRef.current || !bridgeEnabledRef.current) {
        return;
      }
      if (isDownloadingRef.current || activeQueueCountRef.current > 0) {
        return;
      }
      clearBackgroundTimer();
      backgroundTimerRef.current = setTimeout(() => {
        tearDownIfSafe(`background:${reason || 'timer'}`);
      }, BACKGROUND_TIMEOUT_MS);
    },
    [clearBackgroundTimer, tearDownIfSafe],
  );

  const resetIdleTimerFromInteraction = useCallback(
    source => {
      hasInteractedSinceEnableRef.current = true;
      if (!isFocusedRef.current) {
        return;
      }
      if (!autoDisableBridgeRef.current || !bridgeEnabledRef.current) {
        return;
      }
      armIdleTimer(source || 'interaction');
    },
    [armIdleTimer],
  );

  const handleBridgeActivity = useCallback(
    event => {
      const type = String(event?.type || 'bridge').trim() || 'bridge';
      const source = getSourceKey(event?.source || activeSourceRef.current);
      if (source === 'spotdown' && !SPOTDOWN_IDLE_ACTIVITY_TYPES.has(type)) {
        return;
      }
      resetIdleTimerFromInteraction(`bridge:${source}:${type}`);
    },
    [resetIdleTimerFromInteraction],
  );

  const handleSourceActiveDownloadCountChange = useCallback(
    (source, count) => {
      const sourceKey = getSourceKey(source);
      const nextCount = Math.max(0, Number(count) || 0);
      const prevCounts = sourceActiveCountsRef.current;
      const nextCounts = {
        ...prevCounts,
        [sourceKey]: nextCount,
      };
      sourceActiveCountsRef.current = nextCounts;
      setSourceActiveCounts(current => {
        if (
          Number(current?.tidal) === Number(nextCounts.tidal) &&
          Number(current?.spotdown) === Number(nextCounts.spotdown)
        ) {
          return current;
        }
        return nextCounts;
      });

      const totalActive =
        (Number(nextCounts.tidal) || 0) + (Number(nextCounts.spotdown) || 0);
      isDownloadingRef.current = totalActive > 0;
      if (totalActive > 0) {
        clearBackgroundTimer();
        return;
      }
      if (isFocusedRef.current) {
        return;
      }
      if (pendingBackgroundAfterDownloadRef.current) {
        pendingBackgroundAfterDownloadRef.current = false;
        startBackgroundTimer('downloads-inactive');
      }
    },
    [clearBackgroundTimer, startBackgroundTimer],
  );

  const handleBridgeReadyChange = useCallback((source, ready) => {
    const sourceKey = getSourceKey(source);
    const nextReady = ready === true;
    setBridgeReadyBySource(current => {
      if (Boolean(current?.[sourceKey]) === nextReady) {
        return current;
      }
      return {
        ...current,
        [sourceKey]: nextReady,
      };
    });
  }, []);

  const onTidalBridgeActivity = useCallback(
    event => {
      if (activeSourceRef.current === 'tidal') {
        handleBridgeActivity({...event, source: 'tidal'});
      }
    },
    [handleBridgeActivity],
  );

  const onSpotdownBridgeActivity = useCallback(
    event => {
      if (activeSourceRef.current === 'spotdown') {
        handleBridgeActivity({...event, source: 'spotdown'});
      }
    },
    [handleBridgeActivity],
  );

  const onTidalActiveDownloadCountChange = useCallback(
    count => handleSourceActiveDownloadCountChange('tidal', count),
    [handleSourceActiveDownloadCountChange],
  );

  const onSpotdownActiveDownloadCountChange = useCallback(
    count => handleSourceActiveDownloadCountChange('spotdown', count),
    [handleSourceActiveDownloadCountChange],
  );

  const onTidalBridgeReadyChange = useCallback(
    ready => handleBridgeReadyChange('tidal', ready),
    [handleBridgeReadyChange],
  );

  const onSpotdownBridgeReadyChange = useCallback(
    ready => handleBridgeReadyChange('spotdown', ready),
    [handleBridgeReadyChange],
  );

  const {
    webViewRef: tidalWebViewRef,
    webViewProps: tidalWebViewProps,
    searchSongs: searchSongsFromTidalWebView,
    getAlbumTracks: getAlbumTracksFromTidalWebView,
    startDownload: startDownloadFromTidalWebView,
    getDownloadJobs: getDownloadJobsFromTidalWebView,
    retryDownload: retryDownloadFromTidalWebView,
    cancelDownload: cancelDownloadFromTidalWebView,
    syncConvertToMp3: syncConvertToMp3FromTidalWebView,
  } = useSquidWebViewDownloader({
    onBridgeActivity: onTidalBridgeActivity,
    onActiveDownloadCountChange: onTidalActiveDownloadCountChange,
    onBridgeReadyChange: onTidalBridgeReadyChange,
  });

  const {
    webViewRef: spotdownWebViewRef,
    webViewProps: spotdownWebViewProps,
    searchSongs: searchSongsFromSpotdownWebView,
    getAlbumTracks: getAlbumTracksFromSpotdownWebView,
    startDownload: startDownloadFromSpotdownWebView,
    getDownloadJobs: getDownloadJobsFromSpotdownWebView,
    retryDownload: retryDownloadFromSpotdownWebView,
    cancelDownload: cancelDownloadFromSpotdownWebView,
    syncConvertToMp3: syncConvertToMp3FromSpotdownWebView,
  } = useSpotdownWebViewDownloader({
    onBridgeActivity: onSpotdownBridgeActivity,
    onActiveDownloadCountChange: onSpotdownActiveDownloadCountChange,
    onBridgeReadyChange: onSpotdownBridgeReadyChange,
  });

  const currentOptionShortLabel = useMemo(
    () =>
      downloadSource === 'Spotdown'
        ? SPOTDOWN_LOCKED_QUALITY_LABEL
        : getDownloadSettingShortLabel(downloadSetting),
    [downloadSource, downloadSetting],
  );
  const qualityOutlineColor = useMemo(() => {
    if (downloadSource === 'Spotdown') {
      return '#22c55e';
    }
    if (downloadSetting === 'Hi-Res') {
      return '#eab308';
    }
    if (downloadSetting === 'CD Lossless') {
      return '#6366f1';
    }
    if (downloadSetting === '320kbps AAC') {
      return '#06b6d4';
    }
    if (downloadSetting === '96kbps AAC') {
      return '#ec4899';
    }
    return C.border;
  }, [downloadSource, downloadSetting]);
  const sourceOutlineColor = useMemo(
    () => (downloadSource === 'Spotdown' ? '#22c55e' : '#3b82f6'),
    [downloadSource],
  );
  const activeSource = useMemo(
    () => (downloadSource === 'Spotdown' ? 'spotdown' : 'tidal'),
    [downloadSource],
  );
  const activeBridgeReady = useMemo(
    () => bridgeReadyBySource?.[activeSource] === true,
    [activeSource, bridgeReadyBySource],
  );
  const activeBridgeLabel = activeSource === 'spotdown' ? 'Spotdown' : 'Tidal';
  const showBridgeLoadingModal = bridgeEnabled && !activeBridgeReady;
  const isSpotdownSource = activeSource === 'spotdown';
  const activeSearchSongsFromWebView = useMemo(
    () =>
      activeSource === 'spotdown'
        ? searchSongsFromSpotdownWebView
        : searchSongsFromTidalWebView,
    [activeSource, searchSongsFromSpotdownWebView, searchSongsFromTidalWebView],
  );
  const activeGetAlbumTracksFromWebView = useMemo(
    () =>
      activeSource === 'spotdown'
        ? getAlbumTracksFromSpotdownWebView
        : getAlbumTracksFromTidalWebView,
    [
      activeSource,
      getAlbumTracksFromSpotdownWebView,
      getAlbumTracksFromTidalWebView,
    ],
  );
  const activeStartDownloadFromWebView = useMemo(
    () =>
      activeSource === 'spotdown'
        ? startDownloadFromSpotdownWebView
        : startDownloadFromTidalWebView,
    [
      activeSource,
      startDownloadFromSpotdownWebView,
      startDownloadFromTidalWebView,
    ],
  );
  const activeSyncConvertToMp3FromWebView = useMemo(
    () =>
      activeSource === 'spotdown'
        ? syncConvertToMp3FromSpotdownWebView
        : syncConvertToMp3FromTidalWebView,
    [
      activeSource,
      syncConvertToMp3FromSpotdownWebView,
      syncConvertToMp3FromTidalWebView,
    ],
  );

  const getRetryHandlerForSource = useCallback(
    source =>
      getSourceKey(source) === 'spotdown'
        ? retryDownloadFromSpotdownWebView
        : retryDownloadFromTidalWebView,
    [retryDownloadFromSpotdownWebView, retryDownloadFromTidalWebView],
  );

  const getCancelHandlerForSource = useCallback(
    source =>
      getSourceKey(source) === 'spotdown'
        ? cancelDownloadFromSpotdownWebView
        : cancelDownloadFromTidalWebView,
    [cancelDownloadFromSpotdownWebView, cancelDownloadFromTidalWebView],
  );

  const applyDownloadSetting = useCallback(nextSetting => {
    const normalized = normalizeDownloadSetting(nextSetting);
    downloadSettingRef.current = normalized;
    setDownloadSetting(normalized);
    return normalized;
  }, []);

  const activeQueueCount = useMemo(
    () =>
      queue.filter(job => ACTIVE_QUEUE_STATUSES.has(job.status || 'queued'))
        .length,
    [queue],
  );
  const showSpotdownDownloadAll = useMemo(
    () =>
      activeSource === 'spotdown' &&
      !activeAlbum &&
      Array.isArray(results) &&
      results.length > 1 &&
      spotdownLastSubmission?.isSpotifyUrl === true,
    [activeAlbum, activeSource, results, spotdownLastSubmission],
  );
  const spotdownBatchActiveJobs = useMemo(() => {
    if (!spotdownBatchJobIds.length) {
      return [];
    }
    const activeStatuses = new Set(['queued', 'preparing', 'downloading']);
    const batchSet = new Set(spotdownBatchJobIds.map(id => String(id)));
    return queue.filter(
      job =>
        getSourceKey(job?.source || 'tidal') === 'spotdown' &&
        batchSet.has(String(job?.id || '')) &&
        activeStatuses.has(String(job?.status || '')),
    );
  }, [queue, spotdownBatchJobIds]);

  useEffect(() => {
    activeDownloaderTabRef.current = activeDownloaderTab;
  }, [activeDownloaderTab]);

  useEffect(() => {
    activeSourceRef.current = activeSource;
  }, [activeSource]);

  useEffect(() => {
    activeQueueCountRef.current = activeQueueCount;
    const totalActiveFromHooks =
      (Number(sourceActiveCountsRef.current?.tidal) || 0) +
      (Number(sourceActiveCountsRef.current?.spotdown) || 0);
    isDownloadingRef.current = totalActiveFromHooks > 0 || activeQueueCount > 0;
  }, [activeQueueCount]);

  useEffect(() => {
    sourceActiveCountsRef.current = {
      tidal: Number(sourceActiveCounts?.tidal) || 0,
      spotdown: Number(sourceActiveCounts?.spotdown) || 0,
    };
  }, [sourceActiveCounts]);

  useEffect(() => {
    if (!spotdownBatchJobIds.length) {
      return;
    }
    const activeIds = new Set(
      queue
        .filter(
          job =>
            getSourceKey(job?.source || 'tidal') === 'spotdown' &&
            ['queued', 'preparing', 'downloading'].includes(job?.status),
        )
        .map(job => String(job?.id || '')),
    );
    setSpotdownBatchJobIds(prev => {
      const next = prev.filter(id => activeIds.has(String(id)));
      if (next.length === prev.length) {
        return prev;
      }
      return next;
    });
  }, [queue, spotdownBatchJobIds.length]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    albumTracksLoadingRef.current = albumTracksLoading;
  }, [albumTracksLoading]);

  useEffect(() => {
    autoDisableBridgeRef.current = autoDisableBridgeAfterInactivity === true;
    if (!autoDisableBridgeRef.current) {
      clearAllBridgeTimers();
      return;
    }
    if (
      isFocusedRef.current &&
      bridgeEnabledRef.current &&
      hasInteractedSinceEnableRef.current
    ) {
      armIdleTimer('setting-enabled');
    }
  }, [armIdleTimer, autoDisableBridgeAfterInactivity, clearAllBridgeTimers]);

  useEffect(() => {
    const wasEnabled = previousBridgeEnabledRef.current;
    previousBridgeEnabledRef.current = bridgeEnabled;
    bridgeEnabledRef.current = bridgeEnabled;

    if (!bridgeEnabled) {
      clearAllBridgeTimers();
      hasInteractedSinceEnableRef.current = false;
      setBridgeReadyBySource(current => {
        if (!current?.tidal && !current?.spotdown) {
          return current;
        }
        return {tidal: false, spotdown: false};
      });
      return;
    }

    if (!wasEnabled) {
      clearBackgroundTimer();
      hasInteractedSinceEnableRef.current = false;
    }
  }, [bridgeEnabled, clearAllBridgeTimers, clearBackgroundTimer]);

  useEffect(
    () => () => {
      isMountedRef.current = false;
      clearIdleTimer();
      clearBackgroundTimer();
    },
    [clearBackgroundTimer, clearIdleTimer],
  );

  const orderedQueue = useMemo(
    () => [...queue].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    [queue],
  );

  const queueByTrackKey = useMemo(() => {
    const map = new Map();

    queue.forEach(job => {
      const source = getSourceKey(job?.source || 'tidal');
      const key = getTrackKeyForSource(job, source);
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
      const [tidalJobsRaw, spotdownJobsRaw] = await Promise.all([
        getDownloadJobsFromTidalWebView(100).catch(() => []),
        getDownloadJobsFromSpotdownWebView(220).catch(() => []),
      ]);
      const tidalJobs = Array.isArray(tidalJobsRaw)
        ? tidalJobsRaw.map(job => ({...job, source: 'tidal'}))
        : [];
      const spotdownJobs = Array.isArray(spotdownJobsRaw)
        ? spotdownJobsRaw.map(job => ({...job, source: 'spotdown'}))
        : [];
      const merged = [...tidalJobs, ...spotdownJobs];
      const dedupedMap = new Map();
      merged.forEach(job => {
        const key = toJobScopeKey(job);
        const existing = dedupedMap.get(key);
        if (
          !existing ||
          (Number(job?.updatedAt) || 0) >= (Number(existing?.updatedAt) || 0)
        ) {
          dedupedMap.set(key, job);
        }
      });
      const jobs = Array.from(dedupedMap.values()).sort(
        (left, right) => (left?.createdAt || 0) - (right?.createdAt || 0),
      );
      if (mountedRef.current) {
        jobs.forEach(job => {
          if (job.status !== 'done') {
            dismissedDoneJobsRef.current.delete(toJobScopeKey(job));
          }
        });
        const filtered = jobs.filter(
          job =>
            !(
              job.status === 'done' &&
              dismissedDoneJobsRef.current.has(toJobScopeKey(job))
            ),
        );
        setQueue(prev =>
          areQueueListsEquivalent(prev, filtered) ? prev : filtered,
        );
      }
    } catch (error) {
      // Queue polling is best-effort.
    } finally {
      pollInFlightRef.current = false;
    }
  }, [getDownloadJobsFromSpotdownWebView, getDownloadJobsFromTidalWebView]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let timer = null;
      mountedRef.current = true;
      isFocusedRef.current = true;
      pendingBackgroundAfterDownloadRef.current = false;
      clearBackgroundTimer();
      if (
        autoDisableBridgeRef.current &&
        bridgeEnabledRef.current &&
        hasInteractedSinceEnableRef.current
      ) {
        armIdleTimer('focus');
      }

      const loadFocusedData = async () => {
        const settings = await storageService.getSettings();
        if (active) {
          applyDownloadSetting(
            settings?.downloadSetting || DEFAULT_DOWNLOAD_SETTING,
          );
          setAutoDisableBridgeAfterInactivity(
            settings?.autoDisableBridgeAfterInactivity === true,
          );
          if (!downloadDefaultsAppliedRef.current) {
            const autoBridgeEnabled = settings?.autoEnableBridge !== false;
            const autoConvertEnabled =
              resolveAutoConvertAacToMp3Default(settings);
            setBridgeEnabled(currentValue => {
              if (!autoBridgeEnabled && activeQueueCountRef.current > 0) {
                return currentValue;
              }
              return autoBridgeEnabled;
            });
            setConvertAacToMp3(autoConvertEnabled);
            downloadDefaultsAppliedRef.current = true;
          }
        }
        await refreshQueue();
      };

      const scheduleNextPoll = () => {
        if (!active) {
          return;
        }
        const aggressivePolling =
          activeDownloaderTabRef.current === 'Queue' ||
          activeQueueCountRef.current > 0;
        const delay = aggressivePolling
          ? AGGRESSIVE_QUEUE_POLL_MS
          : IDLE_QUEUE_POLL_MS;

        timer = setTimeout(async () => {
          if (!active) {
            return;
          }
          await refreshQueue();
          scheduleNextPoll();
        }, delay);
      };

      const task = InteractionManager.runAfterInteractions(() => {
        if (!active) {
          return;
        }

        loadFocusedData();
        scheduleNextPoll();
      });

      return () => {
        active = false;
        mountedRef.current = false;
        isFocusedRef.current = false;
        task.cancel();
        if (timer) {
          clearTimeout(timer);
        }
        clearIdleTimer();
        if (autoDisableBridgeRef.current && bridgeEnabledRef.current) {
          if (isDownloadingRef.current || activeQueueCountRef.current > 0) {
            pendingBackgroundAfterDownloadRef.current = true;
          } else {
            startBackgroundTimer('blur');
          }
        }
      };
    }, [
      applyDownloadSetting,
      armIdleTimer,
      clearBackgroundTimer,
      clearIdleTimer,
      refreshQueue,
      startBackgroundTimer,
    ]),
  );

  useEffect(() => {
    if (!mountedRef.current) {
      return;
    }
    if (activeDownloaderTab === 'Queue') {
      refreshQueue();
    }
  }, [activeDownloaderTab, refreshQueue]);

  useEffect(() => {
    const isBusy =
      activeQueueCount > 0 ||
      loadingRef.current ||
      albumTracksLoadingRef.current;
    if (isBusy) {
      return;
    }
    if (!isFocusedRef.current) {
      return;
    }
    if (!autoDisableBridgeRef.current || !bridgeEnabledRef.current) {
      return;
    }
    if (!hasInteractedSinceEnableRef.current) {
      return;
    }
    armIdleTimer('busy-cleared');
  }, [activeQueueCount, albumTracksLoading, armIdleTimer, loading]);

  const doneJobIds = useMemo(
    () =>
      queue
        .filter(
          job =>
            job.status === 'done' &&
            job.song?.id &&
            !persistedJobsRef.current.has(toJobScopeKey(job)),
        )
        .map(job => toJobScopeKey(job))
        .join(','),
    [queue],
  );

  useEffect(() => {
    if (!doneJobIds) {
      return;
    }
    const persistCompletedDownloads = async () => {
      const completedJobs = queue.filter(
        job =>
          job.status === 'done' &&
          job.song?.id &&
          !persistedJobsRef.current.has(toJobScopeKey(job)),
      );

      for (const job of completedJobs) {
        const scopedKey = toJobScopeKey(job);
        persistedJobsRef.current.add(scopedKey);
        try {
          const isAlreadyLocalFile =
            job?.song?.isLocal &&
            String(job?.song?.url || '').startsWith('file://');
          if (!isAlreadyLocalFile) {
            await storageService.saveRemoteSongToDevice(job.song);
          }
        } catch (error) {
          persistedJobsRef.current.delete(scopedKey);
          // Do not block queue rendering for storage failures.
        }
      }
    };

    persistCompletedDownloads();
  }, [doneJobIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistDownloadSetting = useCallback(
    async nextSetting => {
      const normalized = applyDownloadSetting(nextSetting);
      const settings = await storageService.getSettings();
      await storageService.saveSettings({
        ...settings,
        downloadSetting: normalized,
      });
    },
    [applyDownloadSetting],
  );

  const openSourceMenu = useCallback(() => {
    resetIdleTimerFromInteraction('source-open');
    setSourceMenuOpen(true);
  }, [resetIdleTimerFromInteraction]);

  const cancelPendingJobsForSource = useCallback(
    async source => {
      const sourceKey = getSourceKey(source);
      const pendingJobs = queue.filter(
        job =>
          getSourceKey(job?.source || 'tidal') === sourceKey &&
          (job.status === 'queued' || job.spotdownStatus === 'pending'),
      );
      if (!pendingJobs.length) {
        return;
      }
      const cancelHandler = getCancelHandlerForSource(sourceKey);
      await Promise.allSettled(pendingJobs.map(job => cancelHandler(job.id)));
      if (mountedRef.current) {
        const canceledIds = new Set(
          pendingJobs.map(job => `${sourceKey}:${String(job?.id || '')}`),
        );
        setQueue(prev =>
          prev.filter(job => !canceledIds.has(toJobScopeKey(job))),
        );
      }
    },
    [getCancelHandlerForSource, queue],
  );

  const selectDownloadSource = useCallback(
    nextSource => {
      resetIdleTimerFromInteraction('source-select');
      const normalizedLabel = nextSource === 'Spotdown' ? 'Spotdown' : 'Tidal';
      const nextSourceKey =
        normalizedLabel === 'Spotdown' ? 'spotdown' : 'tidal';
      const previousSourceKey = activeSourceRef.current;
      if (previousSourceKey !== nextSourceKey) {
        cancelPendingJobsForSource(previousSourceKey).catch(() => {});
      }
      setDownloadSource(normalizedLabel);
      setResults([]);
      setActiveAlbum(null);
      setAlbumTracks([]);
      setAlbumTracksLoading(false);
      setAlbumQueueingAll(false);
      setSettingsOpen(false);
      setSourceMenuOpen(false);
    },
    [cancelPendingJobsForSource, resetIdleTimerFromInteraction],
  );

  const isAacQuality = useMemo(
    () => downloadSetting === '320kbps AAC' || downloadSetting === '96kbps AAC',
    [downloadSetting],
  );

  const toggleConvertAacToMp3 = useCallback(
    nextValue => {
      resetIdleTimerFromInteraction('convert-toggle');
      const enabled = Boolean(nextValue);
      setConvertAacToMp3(enabled);
      activeSyncConvertToMp3FromWebView(enabled).catch(() => {});
    },
    [activeSyncConvertToMp3FromWebView, resetIdleTimerFromInteraction],
  );

  const toggleBridgeEnabled = useCallback(() => {
    if (!bridgeEnabled) {
      clearBackgroundTimer();
      pendingBackgroundAfterDownloadRef.current = false;
      hasInteractedSinceEnableRef.current = false;
      setBridgeReadyBySource({tidal: false, spotdown: false});
      setBridgeEnabled(true);
      return;
    }

    if (activeQueueCount > 0) {
      Alert.alert(
        'Bridge Busy',
        'Wait for active downloads to finish before turning the bridge off.',
      );
      return;
    }

    if (loading || albumTracksLoading) {
      Alert.alert(
        'Bridge Busy',
        'Wait for the current search task to finish before turning the bridge off.',
      );
      return;
    }

    clearAllBridgeTimers();
    hasInteractedSinceEnableRef.current = false;
    setBridgeEnabled(false);
  }, [
    activeQueueCount,
    albumTracksLoading,
    bridgeEnabled,
    clearAllBridgeTimers,
    clearBackgroundTimer,
    loading,
  ]);

  const closeAlbumView = useCallback(() => {
    setActiveAlbum(null);
    setAlbumTracks([]);
    setAlbumTracksLoading(false);
    setAlbumQueueingAll(false);
  }, []);

  const getSearchResultKey = useCallback(
    (item, index) => {
      const sourceKey = getSourceKey(item?.source || activeSource);
      const type = String(
        item?.type || activeSearchType || 'track',
      ).toLowerCase();
      const tidalId = String(item?.tidalId || '').trim();
      const url = String(item?.url || '').trim();
      const title = String(item?.title || 'unknown').trim();
      const artist = String(item?.artist || '').trim();
      const itemIndex = Number.isInteger(item?.index) ? item.index : index;
      const identity =
        tidalId || url || `${title}|${artist}|${item?.duration || 0}`;
      return `${sourceKey}-${type}-${identity}-${itemIndex}`;
    },
    [activeSearchType, activeSource],
  );

  const searchSongs = useCallback(async () => {
    if (!bridgeEnabled) {
      Alert.alert(
        'Bridge Disabled',
        `Enable the bridge button in the top bar to search from ${
          activeSource === 'spotdown' ? 'Spotdown' : 'Tidal'
        }.`,
      );
      return;
    }
    if (!activeBridgeReady) {
      Alert.alert(
        'Bridge Loading',
        `${activeBridgeLabel} bridge is still loading. Please wait a moment.`,
      );
      return;
    }

    if (!query.trim()) {
      return;
    }

    resetIdleTimerFromInteraction('search-submit');

    try {
      Keyboard.dismiss();
      setLoading(true);
      setResults([]);
      closeAlbumView();
      const submittedQuery = query.trim();
      const songs = await activeSearchSongsFromWebView(
        submittedQuery,
        activeSearchType.toLowerCase(),
      );
      const nextResults = Array.isArray(songs)
        ? songs.map(song => ({...song, source: activeSource}))
        : [];
      setResults(nextResults);

      if (activeSource === 'spotdown') {
        setSpotdownLastSubmission({
          query: submittedQuery,
          isSpotifyUrl: isSpotifyUrlInput(submittedQuery),
        });
      } else {
        setSpotdownLastSubmission({
          query: '',
          isSpotifyUrl: false,
        });
      }

      if (nextResults.length === 0) {
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
    activeSearchSongsFromWebView,
    activeBridgeLabel,
    activeBridgeReady,
    activeSource,
    activeSearchType,
    closeAlbumView,
    bridgeEnabled,
    query,
    resetIdleTimerFromInteraction,
  ]);

  const queueDownload = useCallback(
    async (item, index, options = {}) => {
      const suppressAlert = Boolean(options?.suppressAlert);
      const switchToQueue =
        typeof options?.switchToQueue === 'boolean'
          ? options.switchToQueue
          : true;

      if (!item.downloadable) {
        return {status: 'not-downloadable'};
      }

      resetIdleTimerFromInteraction('queue-download');

      if (!bridgeEnabled) {
        if (!suppressAlert) {
          Alert.alert(
            'Bridge Disabled',
            'Enable the bridge button in the top bar to start downloads.',
          );
        }
        return {status: 'bridge-disabled'};
      }

      const resolvedIndex = Number.isInteger(item?.requestIndex)
        ? item.requestIndex
        : Number.isInteger(item?.index)
        ? item.index
        : Number.isInteger(index)
        ? index
        : null;

      const key = getTrackKeyForSource(item, activeSource);
      const existingJob = queueByTrackKey.get(key);
      if (existingJob && existingJob.status !== 'failed') {
        if (switchToQueue) {
          setActiveDownloaderTab('Queue');
        }
        return {status: 'exists', job: existingJob};
      }

      try {
        setQueuingKeys(prev => ({...prev, [key]: true}));
        const selectedSetting = normalizeDownloadSetting(
          downloadSettingRef.current,
        );
        const job = await activeStartDownloadFromWebView(
          item,
          resolvedIndex,
          selectedSetting,
          convertAacToMp3,
        );
        if (mountedRef.current) {
          setQueue(prev => {
            const withoutDup = prev.filter(
              existing =>
                toJobScopeKey(existing) !==
                `${activeSource}:${String(job?.id || '')}`,
            );
            return [...withoutDup, {...job, source: activeSource}];
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
    [
      activeSource,
      activeStartDownloadFromWebView,
      bridgeEnabled,
      convertAacToMp3,
      queueByTrackKey,
      resetIdleTimerFromInteraction,
    ],
  );

  const openAlbum = useCallback(
    async album => {
      if (!bridgeEnabled) {
        Alert.alert(
          'Bridge Disabled',
          'Enable the bridge button in the top bar to load album tracks.',
        );
        return;
      }

      if (!album?.url) {
        Alert.alert(
          'Album Error',
          'Album details are unavailable for this item.',
        );
        return;
      }

      resetIdleTimerFromInteraction('open-album');
      setActiveAlbum(album);
      setAlbumTracks([]);
      setAlbumTracksLoading(true);
      setAlbumQueueingAll(false);

      try {
        const tracks = await activeGetAlbumTracksFromWebView(album);
        if (!mountedRef.current) {
          return;
        }
        const nextTracks = Array.isArray(tracks)
          ? tracks.map(track => ({...track, source: activeSource}))
          : [];
        setAlbumTracks(nextTracks);
        if (nextTracks.length === 0) {
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
    },
    [
      activeGetAlbumTracksFromWebView,
      activeSource,
      bridgeEnabled,
      resetIdleTimerFromInteraction,
    ],
  );

  const queueAlbumTracksAll = useCallback(async () => {
    if (!activeAlbum || albumQueueingAll || albumTracks.length === 0) {
      return;
    }

    resetIdleTimerFromInteraction('queue-album-all');
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
  }, [
    activeAlbum,
    albumQueueingAll,
    albumTracks,
    queueDownload,
    resetIdleTimerFromInteraction,
  ]);

  const queueSpotdownResultsAllInternal = useCallback(async () => {
    if (!showSpotdownDownloadAll || loading || results.length <= 1) {
      return;
    }

    resetIdleTimerFromInteraction('queue-spotdown-all');
    let queued = 0;
    let skipped = 0;
    let failed = 0;
    const queuedIds = [];

    for (const item of results) {
      const result = await queueDownload(item, item?.index, {
        suppressAlert: true,
        switchToQueue: false,
      });
      if (result?.status === 'queued') {
        queued += 1;
        if (result?.job?.id) {
          queuedIds.push(result.job.id);
        }
      } else if (
        result?.status === 'exists' ||
        result?.status === 'not-downloadable'
      ) {
        skipped += 1;
      } else {
        failed += 1;
      }
    }

    setSpotdownBatchJobIds(queuedIds);

    Alert.alert(
      'Batch Queued',
      `Queued ${queued} tracks${skipped > 0 ? `, skipped ${skipped}` : ''}${
        failed > 0 ? `, failed ${failed}` : ''
      }.`,
      [
        {text: 'Stay', style: 'cancel'},
        {
          text: 'View Queue',
          onPress: () => {
            setActiveDownloaderTab('Queue');
          },
        },
      ],
    );
  }, [
    loading,
    queueDownload,
    resetIdleTimerFromInteraction,
    results,
    showSpotdownDownloadAll,
  ]);

  const queueSpotdownResultsAll = useCallback(() => {
    if (!showSpotdownDownloadAll || loading || results.length <= 1) {
      return;
    }
    if (results.length > 50) {
      Alert.alert(
        'Large Batch',
        `Downloading ${results.length} tracks. This may take a while.`,
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Continue',
            onPress: () => {
              queueSpotdownResultsAllInternal().catch(() => {});
            },
          },
        ],
      );
      return;
    }
    queueSpotdownResultsAllInternal().catch(() => {});
  }, [
    loading,
    queueSpotdownResultsAllInternal,
    results.length,
    showSpotdownDownloadAll,
  ]);

  const cancelSpotdownBatch = useCallback(async () => {
    if (!spotdownBatchActiveJobs.length) {
      return;
    }
    resetIdleTimerFromInteraction('cancel-spotdown-batch');
    const cancelHandler = getCancelHandlerForSource('spotdown');
    const targetIds = new Set(
      spotdownBatchActiveJobs.map(job => String(job?.id || '')),
    );
    await Promise.allSettled(
      spotdownBatchActiveJobs.map(job => cancelHandler(job.id)),
    );
    if (mountedRef.current) {
      setQueue(prev =>
        prev.filter(job => {
          const isSpotdown =
            getSourceKey(job?.source || 'tidal') === 'spotdown';
          if (!isSpotdown) {
            return true;
          }
          return !targetIds.has(String(job?.id || ''));
        }),
      );
      setSpotdownBatchJobIds(prev =>
        prev.filter(id => !targetIds.has(String(id))),
      );
    }
  }, [
    getCancelHandlerForSource,
    resetIdleTimerFromInteraction,
    spotdownBatchActiveJobs,
  ]);

  const retryQueueItem = useCallback(
    async job => {
      const scopedKey = toJobScopeKey(job);
      if (!job?.id || retryingJobs[scopedKey]) {
        return;
      }

      if (!bridgeEnabled) {
        Alert.alert(
          'Bridge Disabled',
          'Enable the bridge button in the top bar to retry downloads.',
        );
        return;
      }

      resetIdleTimerFromInteraction('retry-download');
      try {
        setRetryingJobs(prev => ({...prev, [scopedKey]: true}));
        const sourceKey = getSourceKey(job?.source || activeSource);
        const retryHandler = getRetryHandlerForSource(sourceKey);
        const fallbackSong = {
          title: job.title,
          artist: job.artist || 'Unknown Artist',
          album: job.album || '',
          artwork: job.artwork || null,
          duration: job.duration || 0,
          downloadable: true,
        };
        const retriedJob = await retryHandler(
          job.id,
          fallbackSong,
          normalizeDownloadSetting(
            job.downloadSetting || downloadSettingRef.current,
          ),
          typeof job?.request?.convertAacToMp3Enabled === 'boolean'
            ? job.request.convertAacToMp3Enabled
            : convertAacToMp3,
        );
        if (mountedRef.current && retriedJob) {
          setQueue(prev => {
            const filtered = prev.filter(existing => {
              const scoped = toJobScopeKey(existing);
              return (
                scoped !== `${sourceKey}:${String(job?.id || '')}` &&
                scoped !== `${sourceKey}:${String(retriedJob?.id || '')}`
              );
            });
            return [...filtered, {...retriedJob, source: sourceKey}];
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
            delete next[scopedKey];
            return next;
          });
        }
      }
    },
    [
      bridgeEnabled,
      convertAacToMp3,
      activeSource,
      getRetryHandlerForSource,
      resetIdleTimerFromInteraction,
      retryingJobs,
    ],
  );

  const cancelQueueItem = useCallback(
    async job => {
      const scopedKey = toJobScopeKey(job);
      if (!job?.id || cancelingJobs[scopedKey]) {
        return;
      }

      resetIdleTimerFromInteraction('cancel-download');
      try {
        setCancelingJobs(prev => ({...prev, [scopedKey]: true}));
        const sourceKey = getSourceKey(job?.source || activeSource);
        const cancelHandler = getCancelHandlerForSource(sourceKey);
        await cancelHandler(job.id);
        if (mountedRef.current) {
          setQueue(prev =>
            prev.filter(
              existing =>
                toJobScopeKey(existing) !==
                `${sourceKey}:${String(job?.id || '')}`,
            ),
          );
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
            delete next[scopedKey];
            return next;
          });
        }
      }
    },
    [
      activeSource,
      cancelingJobs,
      getCancelHandlerForSource,
      resetIdleTimerFromInteraction,
    ],
  );

  const dismissDoneQueueItem = useCallback((jobId, source = 'tidal') => {
    if (!jobId) {
      return;
    }
    const scopedKey = `${getSourceKey(source)}:${String(jobId)}`;
    dismissedDoneJobsRef.current.add(scopedKey);
    if (mountedRef.current) {
      setQueue(prev =>
        prev.filter(existing => toJobScopeKey(existing) !== scopedKey),
      );
    }
  }, []);

  const renderSearchResult = useCallback(
    ({item, index}) => {
      const sourceKey = getSourceKey(item?.source || activeSource);
      const key = getTrackKeyForSource(item, sourceKey);
      const canOpenAlbum =
        sourceKey === 'tidal' &&
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
    [
      activeSearchType,
      activeSource,
      openAlbum,
      queueByTrackKey,
      queuingKeys,
      queueDownload,
    ],
  );

  const renderAlbumTrack = useCallback(
    ({item, index}) => {
      const sourceKey = getSourceKey(item?.source || activeSource);
      const key = getTrackKeyForSource(item, sourceKey);
      return (
        <SearchResultCard
          item={item}
          index={index}
          activeSearchType="Tracks"
          linkedJob={queueByTrackKey.get(key)}
          isQueuing={Boolean(queuingKeys[key])}
          onQueueDownload={queueDownload}
          switchToQueue={false}
        />
      );
    },
    [activeSource, queueByTrackKey, queuingKeys, queueDownload],
  );

  const renderQueueItem = useCallback(
    ({item}) => (
      <QueueItemCard
        item={item}
        retrying={Boolean(retryingJobs[toJobScopeKey(item)])}
        canceling={Boolean(cancelingJobs[toJobScopeKey(item)])}
        onRetry={retryQueueItem}
        onCancel={cancelQueueItem}
        onDoneAnimationComplete={() =>
          dismissDoneQueueItem(item?.id, item?.source || 'tidal')
        }
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
        <Text style={styles.emptySubtitle}>Find tracks or albums.</Text>
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
              (albumQueueingAll ||
                albumTracksLoading ||
                albumTracks.length === 0) &&
                styles.albumQueueAllButtonDisabled,
            ]}
            onPress={queueAlbumTracksAll}
            disabled={
              albumQueueingAll || albumTracksLoading || albumTracks.length === 0
            }>
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
            <Text style={styles.albumTracksLoadingText}>
              Loading album tracks...
            </Text>
          </>
        ) : (
          <>
            <Icon
              name="music-note-off-outline"
              size={20}
              color={C.textDeep}
              style={styles.emptyIcon}
            />
            <Text style={styles.emptySubtitle}>
              No tracks found for this album.
            </Text>
          </>
        )}
      </View>
    ),
    [albumTracksLoading],
  );

  const renderSpotdownBatchHeader = useCallback(() => {
    if (!showSpotdownDownloadAll && !spotdownBatchActiveJobs.length) {
      return null;
    }
    const batchRunning = spotdownBatchActiveJobs.length > 0;
    return (
      <View style={styles.albumHeaderCard}>
        <View style={styles.albumHeaderTopRow}>
          <Text style={styles.albumHeaderTitle} numberOfLines={1}>
            Spotdown Collection
          </Text>
          <TouchableOpacity
            style={[
              styles.albumQueueAllButton,
              (loading || results.length === 0) &&
                styles.albumQueueAllButtonDisabled,
            ]}
            onPress={
              batchRunning ? cancelSpotdownBatch : queueSpotdownResultsAll
            }
            disabled={loading || results.length === 0}>
            <Icon
              name={batchRunning ? 'close' : 'download-multiple'}
              size={14}
              color={C.accentFg}
            />
            <Text style={styles.albumQueueAllText}>
              {batchRunning ? 'Cancel all' : 'Download all'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.albumHeaderMeta} numberOfLines={2}>
          {results.length} tracks from a Spotify URL result.
        </Text>
      </View>
    );
  }, [
    cancelSpotdownBatch,
    loading,
    queueSpotdownResultsAll,
    results.length,
    showSpotdownDownloadAll,
    spotdownBatchActiveJobs.length,
  ]);

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

  const searchListData = activeAlbum ? albumTracks : results;
  const searchListKey = useMemo(
    () =>
      activeAlbum
        ? `${activeSource}-album-${String(
            activeAlbum?.url || activeAlbum?.title || 'current',
          )}`
        : `${activeSource}-search-${activeSearchType.toLowerCase()}`,
    [activeAlbum, activeSearchType, activeSource],
  );
  const shouldMountTidalWebView =
    bridgeEnabled &&
    (activeSource === 'tidal' || (Number(sourceActiveCounts?.tidal) || 0) > 0);
  const shouldMountSpotdownWebView =
    bridgeEnabled &&
    (activeSource === 'spotdown' ||
      (Number(sourceActiveCounts?.spotdown) || 0) > 0);
  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>Downloader</Text>
        <View style={styles.topBarRightGroup}>
          <View style={styles.topBarSegmentedControl}>
            <TouchableOpacity
              style={[
                styles.bridgeToggleSegment,
                bridgeEnabled
                  ? styles.bridgeToggleSegmentActive
                  : styles.bridgeToggleSegmentInactive,
              ]}
              onPress={toggleBridgeEnabled}
              activeOpacity={0.85}>
              <Icon
                name="lan"
                size={15}
                color={bridgeEnabled ? C.accentFg : C.textMute}
              />
            </TouchableOpacity>
            <View style={styles.topBarSegmentDivider} />
            <TouchableOpacity
              style={[
                styles.qualitySelectorSegment,
                {borderColor: qualityOutlineColor},
                isSpotdownSource && styles.qualitySelectorSegmentLocked,
              ]}
              onPress={() => {
                if (isSpotdownSource) {
                  return;
                }
                setSettingsOpen(true);
              }}
              disabled={isSpotdownSource}>
              <Icon name="music-note-eighth" size={14} color={C.textDim} />
              <Text style={styles.settingsValue}>
                {currentOptionShortLabel}
              </Text>
              <Icon
                name={isSpotdownSource ? 'lock-outline' : 'chevron-down'}
                size={15}
                color={C.textMute}
              />
            </TouchableOpacity>
          </View>
        </View>
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
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[
                    styles.searchSourceButton,
                    {borderColor: sourceOutlineColor},
                  ]}
                  onPress={openSourceMenu}
                  activeOpacity={0.8}>
                  <Icon name="earth" size={13} color={C.textDim} />
                  <Icon name="chevron-down" size={12} color={C.textMute} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.searchActionButton,
                    (!query.trim() || loading || !activeBridgeReady) &&
                      styles.searchActionButtonDisabled,
                  ]}
                  onPress={searchSongs}
                  disabled={!query.trim() || loading || !activeBridgeReady}>
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

          <View style={styles.searchResultsList}>
            <FlashList
              key={searchListKey}
              data={searchListData}
              renderItem={activeAlbum ? renderAlbumTrack : renderSearchResult}
              keyExtractor={getSearchResultKey}
              estimatedItemSize={SEARCH_RESULT_ESTIMATED_ITEM_SIZE}
              contentContainerStyle={styles.searchListContent}
              ListHeaderComponent={
                activeAlbum
                  ? renderAlbumTracksHeader
                  : activeSource === 'spotdown' &&
                    (showSpotdownDownloadAll ||
                      spotdownBatchActiveJobs.length > 0)
                  ? renderSpotdownBatchHeader
                  : null
              }
              ListEmptyComponent={
                activeAlbum ? renderAlbumTracksEmpty : renderSearchEmpty
              }
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              drawDistance={560}
            />
          </View>
        </View>
      ) : (
        <View style={styles.searchResultsList}>
          <FlashList
            data={orderedQueue}
            renderItem={renderQueueItem}
            keyExtractor={queueKeyExtractor}
            estimatedItemSize={QUEUE_ESTIMATED_ITEM_SIZE}
            contentContainerStyle={styles.queueListContent}
            ListEmptyComponent={renderQueueEmpty}
            showsVerticalScrollIndicator={false}
            drawDistance={520}
          />
        </View>
      )}

      <Modal
        transparent
        visible={showBridgeLoadingModal}
        animationType="fade"
        onRequestClose={() => {}}>
        <View style={styles.bridgeLoadingBackdrop}>
          <View style={styles.bridgeLoadingCard}>
            <ActivityIndicator size="small" color={C.accentFg} />
            <Text style={styles.bridgeLoadingTitle}>
              Loading {activeBridgeLabel} bridge...
            </Text>
            <Text style={styles.bridgeLoadingSubtitle}>
              Search is disabled until the bridge is ready.
            </Text>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={sourceMenuOpen}
        animationType="fade"
        onRequestClose={() => setSourceMenuOpen(false)}>
        <TouchableOpacity
          activeOpacity={1}
          style={styles.sourceModalBackdrop}
          onPress={() => setSourceMenuOpen(false)}>
          <View style={styles.sourceModalCard}>
            <Text style={styles.modalTitle}>Download source</Text>
            {SOURCE_OPTIONS.map(option => {
              const selected = option.value === downloadSource;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.optionRow,
                    selected && styles.optionRowSelected,
                  ]}
                  onPress={() => selectDownloadSource(option.value)}>
                  <View style={styles.optionTextWrap}>
                    <Text style={styles.optionTitle}>{option.value}</Text>
                  </View>
                  <View
                    style={[
                      styles.sourceOptionIndicator,
                      {borderColor: option.borderColor},
                    ]}>
                    {selected ? (
                      <Icon name="check" size={11} color={option.borderColor} />
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

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
            <View style={styles.conversionDivider} />
            <Text style={styles.conversionSectionTitle}>Conversions</Text>
            <View
              style={[
                styles.conversionRow,
                !isAacQuality && styles.conversionRowDisabled,
              ]}>
              <View style={styles.optionTextWrap}>
                <Text style={styles.conversionLabel}>Convert AAC to MP3</Text>
                <Text style={styles.conversionDescription}>
                  Applies to 320kbps and 96kbps AAC downloads
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.conversionToggle,
                  convertAacToMp3 && styles.conversionToggleOn,
                ]}
                onPress={() =>
                  isAacQuality && toggleConvertAacToMp3(!convertAacToMp3)
                }
                disabled={!isAacQuality}
                activeOpacity={0.7}>
                <Text
                  style={[
                    styles.conversionToggleText,
                    convertAacToMp3 && styles.conversionToggleTextOn,
                  ]}>
                  {convertAacToMp3 ? 'ON' : 'OFF'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {shouldMountTidalWebView || shouldMountSpotdownWebView ? (
        <View
          style={styles.hiddenWebViewHost}
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants">
          {shouldMountTidalWebView ? (
            <WebView
              ref={tidalWebViewRef}
              {...tidalWebViewProps}
              pointerEvents="none"
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.hiddenWebView,
                activeSource === 'tidal'
                  ? WEBVIEW_DISPLAY_FLEX
                  : WEBVIEW_DISPLAY_NONE,
              ]}
            />
          ) : null}
          {shouldMountSpotdownWebView ? (
            <WebView
              ref={spotdownWebViewRef}
              {...spotdownWebViewProps}
              pointerEvents="none"
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.hiddenWebView,
                activeSource === 'spotdown'
                  ? WEBVIEW_DISPLAY_FLEX
                  : WEBVIEW_DISPLAY_NONE,
              ]}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

export default SearchScreen;
