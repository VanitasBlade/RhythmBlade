import {MAX_TRACK_CACHE_ENTRIES, TRACK_CACHE_TTL_MS} from "../constants.js";
import {normalizeText} from "../helpers.js";

export function createTrackSearchCache(state) {
  function pruneTrackSearchCache() {
    const now = Date.now();
    for (const [key, entry] of state.trackSearchCache) {
      if (entry.expiresAt < now) {
        state.trackSearchCache.delete(key);
      }
    }

    while (state.trackSearchCache.size > MAX_TRACK_CACHE_ENTRIES) {
      const oldestKey = state.trackSearchCache.keys().next().value;
      if (typeof oldestKey === "undefined") {
        break;
      }
      state.trackSearchCache.delete(oldestKey);
    }
  }

  function getCachedTrackSearch(query) {
    const key = normalizeText(query);
    const entry = state.trackSearchCache.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt < Date.now()) {
      state.trackSearchCache.delete(key);
      return null;
    }
    return entry.songs;
  }

  function setCachedTrackSearch(query, songs) {
    const key = normalizeText(query);
    if (state.trackSearchCache.has(key)) {
      state.trackSearchCache.delete(key);
    }
    state.trackSearchCache.set(key, {
      songs,
      expiresAt: Date.now() + TRACK_CACHE_TTL_MS,
    });
    pruneTrackSearchCache();
  }

  return {
    getCachedTrackSearch,
    setCachedTrackSearch,
  };
}
