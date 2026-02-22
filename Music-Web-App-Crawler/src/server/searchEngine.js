import {searchTracksFast} from "../fastSearch.js";
import {searchSongs} from "../search.js";
import {MAX_TRACK_CACHE_ENTRIES, TRACK_CACHE_TTL_MS} from "./constants.js";
import {
  cleanSearchQueryPart,
  extractTrackIdFromValue,
  getTokenOverlapScore,
  mergeSongMetadata,
  normalizeDisplayText,
  normalizeText,
  normalizeUrlForCompare,
  tokenizeForSimilarity,
  upscaleArtworkUrl,
  withTimeout,
} from "./helpers.js";

const SEP = "\u0001";

const FAST_TRACK_TIMEOUT_MS = 12_000;
const BROWSER_INIT_TIMEOUT_MS = 10_000;
const TRACK_FALLBACK_TIMEOUT_MS = 12_000;
const TRACK_FALLBACK_PIPELINE_TIMEOUT_MS = 20_000;
const SEARCH_REQUEST_TIMEOUT_MS = 18_000;
const SEARCH_PIPELINE_TIMEOUT_MS = 30_000;
const RESOLVE_QUERY_TIMEOUT_MS = 9_000;
const RESOLVE_MAX_TRACK_RESULTS = 24;
const STRONG_MATCH_SCORE = 140;

function createEmptyLookup() {
  return {
    byTrackId: new Map(),
    byUrl: new Map(),
    byMeta: new Map(),
    byTitleArtist: new Map(),
  };
}

function toLookupEntry(song) {
  const title = normalizeText(song?.title);
  const artist = normalizeText(song?.artist);
  const album = normalizeText(song?.album);
  return {
    song,
    trackId: extractTrackIdFromValue(song?.tidalId || song?.url),
    url: normalizeUrlForCompare(song?.url),
    title,
    artist,
    album,
    duration: Number(song?.duration) || 0,
    titleArtistKey: `${title}${SEP}${artist}`,
    metaKey: `${title}${SEP}${artist}${SEP}${album}`,
  };
}

function addLookupList(map, key, entry) {
  if (!key) {
    return;
  }
  const current = map.get(key);
  if (current) {
    current.push(entry);
    return;
  }
  map.set(key, [entry]);
}

function addUniqueText(target, seen, value) {
  const text = normalizeDisplayText(value);
  if (!text) {
    return;
  }
  const key = normalizeText(text);
  if (!key || seen.has(key)) {
    return;
  }
  seen.add(key);
  target.push(text);
}

function textMatchScore(candidate, target, exactScore, containsScore) {
  if (!candidate || !target) {
    return 0;
  }
  if (candidate === target) {
    return exactScore;
  }
  if (candidate.includes(target) || target.includes(candidate)) {
    return containsScore;
  }
  return 0;
}

function buildMatchProfile(song) {
  const title = normalizeDisplayText(song?.title);
  const artist = normalizeDisplayText(song?.artist);
  const album = normalizeDisplayText(song?.album);
  return {
    trackId: extractTrackIdFromValue(song?.tidalId || song?.url),
    url: normalizeUrlForCompare(song?.url),
    title,
    artist,
    album,
    duration: Number(song?.duration) || 0,
    titleNorm: normalizeText(title),
    artistNorm: normalizeText(artist),
    albumNorm: normalizeText(album),
    titleTokens: tokenizeForSimilarity(title),
    albumTokens: tokenizeForSimilarity(album),
  };
}

export function createSearchEngine(state, browserController) {
  const getTrackCacheKey = normalizeText;

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
    const key = getTrackCacheKey(query);
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
    const key = getTrackCacheKey(query);
    if (state.trackSearchCache.has(key)) {
      state.trackSearchCache.delete(key);
    }
    state.trackSearchCache.set(key, {
      songs,
      expiresAt: Date.now() + TRACK_CACHE_TTL_MS,
    });
    pruneTrackSearchCache();
  }

  async function runBrowserSearch(query, type, searchTimeout, pipelineTimeout, label) {
    return withTimeout(
      browserController.runBrowserTask(async () => {
        const {page} = await withTimeout(
          browserController.initBrowser(),
          BROWSER_INIT_TIMEOUT_MS,
          "Browser initialization"
        );
        return withTimeout(searchSongs(page, query, type), searchTimeout, label);
      }),
      pipelineTimeout,
      `${label} pipeline`
    );
  }

  async function searchTracksWithFallback(query) {
    const cached = getCachedTrackSearch(query);
    if (cached) {
      return cached;
    }

    try {
      const songs = await withTimeout(
        searchTracksFast(query, 25),
        FAST_TRACK_TIMEOUT_MS,
        "Fast track search"
      );
      setCachedTrackSearch(query, songs);
      return songs;
    } catch (fastSearchError) {
      const songs = await runBrowserSearch(
        query,
        "tracks",
        TRACK_FALLBACK_TIMEOUT_MS,
        TRACK_FALLBACK_PIPELINE_TIMEOUT_MS,
        "Track fallback search"
      );
      if (!songs.length) {
        throw fastSearchError;
      }
      setCachedTrackSearch(query, songs);
      return songs;
    }
  }

  async function searchByType(query, type = "tracks") {
    const normalizedType = String(type || "tracks").trim();
    if (normalizedType.toLowerCase().startsWith("track")) {
      return searchTracksWithFallback(query);
    }

    return runBrowserSearch(
      query,
      normalizedType,
      SEARCH_REQUEST_TIMEOUT_MS,
      SEARCH_PIPELINE_TIMEOUT_MS,
      "Search request"
    );
  }

  function setLastSearchSongs(songs = []) {
    state.lastSearchSongs = Array.isArray(songs) ? songs : [];

    const lookup = createEmptyLookup();
    for (const song of state.lastSearchSongs) {
      const entry = toLookupEntry(song);
      if (entry.trackId && !lookup.byTrackId.has(entry.trackId)) {
        lookup.byTrackId.set(entry.trackId, entry.song);
      }
      if (entry.url && !lookup.byUrl.has(entry.url)) {
        lookup.byUrl.set(entry.url, entry.song);
      }
      if (entry.title) {
        addLookupList(lookup.byTitleArtist, entry.titleArtistKey, entry);
        addLookupList(lookup.byMeta, entry.metaKey, entry);
      }
    }

    state.lastSearchLookup = lookup;
  }

  function findSongByIdentity(song) {
    if (!song) {
      return null;
    }

    const lookup = state.lastSearchLookup || createEmptyLookup();
    const trackId = extractTrackIdFromValue(song.tidalId || song.url);
    if (trackId && lookup.byTrackId.has(trackId)) {
      return lookup.byTrackId.get(trackId);
    }

    const url = normalizeUrlForCompare(song.url);
    if (url && lookup.byUrl.has(url)) {
      return lookup.byUrl.get(url);
    }

    const title = normalizeText(song.title);
    if (!title) {
      return null;
    }

    const artist = normalizeText(song.artist);
    const album = normalizeText(song.album);
    const duration = Number(song.duration) || 0;

    const metaCandidates = lookup.byMeta.get(`${title}${SEP}${artist}${SEP}${album}`);
    if (metaCandidates?.length) {
      if (!duration) {
        return metaCandidates[0].song;
      }
      const closeDuration = metaCandidates.find(item =>
        !item.duration || Math.abs(item.duration - duration) <= 2
      );
      if (closeDuration) {
        return closeDuration.song;
      }
    }

    const titleArtistCandidates = lookup.byTitleArtist.get(`${title}${SEP}${artist}`);
    return titleArtistCandidates?.[0]?.song || null;
  }

  function getSongFromRequest(index, song) {
    if (Number.isInteger(index)) {
      return state.lastSearchSongs[index] || findSongByIdentity(song) || null;
    }
    if (song && typeof song.index === "number") {
      return state.lastSearchSongs[song.index] || findSongByIdentity(song) || null;
    }
    return findSongByIdentity(song);
  }

  function toSongMeta(song) {
    return {
      title: song?.title || "Unknown",
      artist: song?.artist || "",
      album: song?.album || "",
      artwork: upscaleArtworkUrl(song?.artwork),
      duration: song?.duration || 0,
    };
  }

  function extractTitleQueryVariants(title) {
    const raw = normalizeDisplayText(title);
    if (!raw) {
      return [];
    }

    const variants = [];
    const seen = new Set();
    addUniqueText(variants, seen, raw);
    addUniqueText(variants, seen, cleanSearchQueryPart(raw));

    const fromMatch = raw.match(/\(\s*from\s+["']?([^"')]+)["']?\s*\)/i);
    const fromLabel = fromMatch ? normalizeDisplayText(fromMatch[1]) : "";
    if (fromMatch) {
      const withoutFrom = normalizeDisplayText(raw.replace(fromMatch[0], " "));
      addUniqueText(variants, seen, withoutFrom);
      addUniqueText(variants, seen, cleanSearchQueryPart(withoutFrom));
      addUniqueText(variants, seen, fromLabel);
    }

    const dashParts = raw
      .split(/\s+-\s+/)
      .map(part => normalizeDisplayText(part))
      .filter(Boolean);
    if (dashParts.length >= 2) {
      const left = dashParts[0];
      const right = normalizeDisplayText(dashParts.slice(1).join(" "));
      addUniqueText(variants, seen, `${right} ${left}`);
      addUniqueText(variants, seen, `${left} ${right}`);
      addUniqueText(
        variants,
        seen,
        `${cleanSearchQueryPart(right)} ${cleanSearchQueryPart(left)}`
      );
      addUniqueText(variants, seen, fromLabel ? `${right} ${fromLabel}` : "");
    }

    return variants;
  }

  function buildResolveQueries(song) {
    const title = normalizeDisplayText(song?.title);
    const artist = normalizeDisplayText(song?.artist);
    const album = normalizeDisplayText(song?.album);
    const strongIdentity = Boolean(extractTrackIdFromValue(song?.tidalId || song?.url));

    const queries = [];
    const seen = new Set();
    for (const variant of extractTitleQueryVariants(title)) {
      addUniqueText(queries, seen, `${variant} ${artist}`);
      addUniqueText(queries, seen, `${artist} ${variant}`);
      addUniqueText(queries, seen, `${variant} ${album}`);
      addUniqueText(queries, seen, `${album} ${variant}`);
      addUniqueText(queries, seen, variant);
    }

    addUniqueText(queries, seen, `${title} ${artist} ${album}`);
    addUniqueText(queries, seen, `${artist} ${title} ${album}`);
    addUniqueText(queries, seen, `${album} ${title} ${artist}`);
    addUniqueText(queries, seen, `${artist} ${album}`);
    addUniqueText(queries, seen, `${album} ${artist}`);

    return queries.slice(0, strongIdentity ? 3 : 5);
  }

  function scoreCandidateMatch(candidate, target) {
    const candidateTrackId = extractTrackIdFromValue(candidate?.tidalId || candidate?.url);
    if (candidateTrackId && target.trackId) {
      if (candidateTrackId === target.trackId) {
        return 1200;
      }
    }

    const candidateUrl = normalizeUrlForCompare(candidate?.url);
    if (candidateUrl && target.url) {
      if (candidateUrl === target.url) {
        return 1000;
      }
      if (candidateUrl.endsWith(target.url) || target.url.endsWith(candidateUrl)) {
        return 700;
      }
    }

    const candidateTitle = normalizeDisplayText(candidate?.title);
    const candidateArtist = normalizeDisplayText(candidate?.artist);
    const candidateAlbum = normalizeDisplayText(candidate?.album);
    const candidateDuration = Number(candidate?.duration) || 0;

    let score = candidateTrackId && target.trackId ? -35 : 0;
    score += textMatchScore(normalizeText(candidateTitle), target.titleNorm, 140, 90);
    score += getTokenOverlapScore(
      tokenizeForSimilarity(candidateTitle),
      target.titleTokens,
      80
    );
    score += textMatchScore(normalizeText(candidateArtist), target.artistNorm, 45, 20);
    score += textMatchScore(normalizeText(candidateAlbum), target.albumNorm, 65, 30);
    score += getTokenOverlapScore(
      tokenizeForSimilarity(candidateAlbum),
      target.albumTokens,
      30
    );

    if (candidateDuration > 0 && target.duration > 0) {
      const delta = Math.abs(candidateDuration - target.duration);
      if (delta === 0) {
        score += 55;
      } else if (delta <= 2) {
        score += 40;
      } else if (delta <= 5) {
        score += 22;
      } else if (delta >= 20) {
        score -= 15;
      }
    }

    return score;
  }

  async function searchTrackCandidates(page, query) {
    return withTimeout(
      searchSongs(page, query, "tracks", {
        fastResolve: true,
        maxTrackResults: RESOLVE_MAX_TRACK_RESULTS,
      }),
      RESOLVE_QUERY_TIMEOUT_MS,
      `Resolve query "${query}"`
    );
  }

  function emitResolveProgress(onProgress, selectedSong, phase, progress) {
    onProgress({
      status: "preparing",
      phase,
      progress,
      ...toSongMeta(selectedSong),
    });
  }

  async function resolveDownloadableSong(index, song, onProgress = () => {}) {
    let selectedSong = getSongFromRequest(index, song);
    if (!selectedSong && song?.title) {
      selectedSong = {
        ...song,
        downloadable: song.downloadable !== false,
        element: null,
      };
    }

    if (!selectedSong) {
      throw new Error(
        "Song not found in current search context. Search first, then download by index."
      );
    }
    if (!selectedSong.downloadable) {
      throw new Error("Selected item is not downloadable.");
    }

    emitResolveProgress(onProgress, selectedSong, "preparing", 10);
    if (selectedSong.element) {
      return selectedSong;
    }

    const originalMeta = {
      title: selectedSong.title,
      artist: selectedSong.artist,
      album: selectedSong.album,
      artwork: selectedSong.artwork,
      duration: selectedSong.duration,
    };
    const target = buildMatchProfile(selectedSong);

    emitResolveProgress(onProgress, selectedSong, "resolving", 22);
    const {page} = browserController.getBrowserInstance();
    const resolveQueries = buildResolveQueries(selectedSong);

    let bestCandidate = null;
    let bestScore = -1;
    let resolveError = null;

    for (let i = 0; i < resolveQueries.length; i += 1) {
      emitResolveProgress(
        onProgress,
        selectedSong,
        "resolving",
        Math.min(34, 22 + Math.round(((i + 1) / resolveQueries.length) * 12))
      );

      let candidates = [];
      try {
        candidates = await searchTrackCandidates(page, resolveQueries[i]);
      } catch (error) {
        resolveError = error;
        continue;
      }
      if (!candidates.length) {
        continue;
      }

      for (const candidate of candidates) {
        const score = scoreCandidateMatch(candidate, target);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }

      if (bestScore >= STRONG_MATCH_SCORE) {
        break;
      }
    }

    if (!bestCandidate?.element) {
      if (resolveError) {
        throw resolveError;
      }
      throw new Error(
        `Could not resolve downloadable track element for "${originalMeta.title}".`
      );
    }

    selectedSong = mergeSongMetadata(bestCandidate, originalMeta);
    emitResolveProgress(onProgress, selectedSong, "resolved", 36);
    return selectedSong;
  }

  return {
    searchByType,
    searchTracksWithFallback,
    setLastSearchSongs,
    getSongFromRequest,
    resolveDownloadableSong,
    toSongMeta,
  };
}
