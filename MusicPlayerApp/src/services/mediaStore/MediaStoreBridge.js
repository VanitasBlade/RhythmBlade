import {
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';

const MODULE_NAME = 'MediaStoreLibraryModule';
const CHANGED_EVENT = 'mediaStoreChanged';

const nativeModule = NativeModules?.[MODULE_NAME] || null;
const eventEmitter =
  Platform.OS === 'android' && nativeModule
    ? new NativeEventEmitter(nativeModule)
    : null;

function isAndroid() {
  return Platform.OS === 'android';
}

function ensureModule() {
  return Boolean(isAndroid() && nativeModule);
}

async function isSupported() {
  if (!ensureModule()) {
    return false;
  }
  try {
    const supported = await nativeModule.isSupported();
    return supported === true;
  } catch (error) {
    return false;
  }
}

async function queryAudioSnapshot(options = {}) {
  if (!ensureModule()) {
    return {
      rows: [],
      total: 0,
      queriedAt: Date.now(),
      unsupported: true,
    };
  }
  return nativeModule.queryAudioSnapshot(options || {});
}

async function queryByPath(path = '') {
  if (!ensureModule()) {
    return null;
  }
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath) {
    return null;
  }
  return nativeModule.queryByPath(normalizedPath);
}

async function scanPaths(paths = []) {
  if (!ensureModule()) {
    return {
      requested: 0,
      accepted: 0,
      results: [],
      unsupported: true,
    };
  }
  const normalizedPaths = Array.isArray(paths)
    ? paths
        .map(path => String(path || '').trim())
        .filter(Boolean)
    : [];
  return nativeModule.scanPaths(normalizedPaths);
}

function startObserver() {
  if (!ensureModule()) {
    return;
  }
  nativeModule.startObserver();
}

function stopObserver() {
  if (!ensureModule()) {
    return;
  }
  nativeModule.stopObserver();
}

function subscribeToChanges(listener) {
  if (!eventEmitter || typeof listener !== 'function') {
    return () => {};
  }
  const subscription = eventEmitter.addListener(CHANGED_EVENT, payload => {
    try {
      listener(payload || {});
    } catch (error) {
      // Ignore listener errors.
    }
  });
  return () => {
    try {
      subscription.remove();
    } catch (error) {
      // Ignore.
    }
  };
}

export default {
  CHANGED_EVENT,
  isSupported,
  queryAudioSnapshot,
  queryByPath,
  scanPaths,
  startObserver,
  stopObserver,
  subscribeToChanges,
};
