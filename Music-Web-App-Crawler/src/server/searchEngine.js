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
const LOOKUP_EMPTY = {
  byTrackId: new Map(),
  byUrl: new Map(),
  byMeta: new Map(),
  byTitleArtist: new Map(),
};
const TIMEOUTS = {
  fastTrack: 12_000,
  browserInit: 10_000,
  trackFallback: 12_000,
  trackFallbackPipeline: 20_000,
  search: 18_000,
  searchPipeline: 30_000,
  resolve: 9_000,
};
const ARTIST_BROWSER_SEARCH_TIMEOUT_MS = 6_000;
const ARTIST_BROWSER_PIPELINE_TIMEOUT_MS = 9_000;
const RESOLVE_MAX_TRACK_RESULTS = 24;
const STRONG_MATCH_SCORE = 140;
const EXACT_MATCH_SCORE = 1000;

const key2 = (a, b) => `${a}${SEP}${b}`;
const key3 = (a, b, c) => `${a}${SEP}${b}${SEP}${c}`;

function addUniqueText(list, seen, value) {
  const display = normalizeDisplayText(value);
  if (!display) {
    return;
  }
  const key = normalizeText(display);
  if (!key || seen.has(key)) {
    return;
  }
  seen.add(key);
  list.push(display);
}

function scoreText(candidate, target, exact, partial) {
  if (!candidate || !target) {
    return 0;
  }
  if (candidate === target) {
    return exact;
  }
  return candidate.includes(target) || target.includes(candidate) ? partial : 0;
}

function buildTargetProfile(song) {
  const title = normalizeDisplayText(song?.title);
  const artist = normalizeDisplayText(song?.artist);
  const album = normalizeDisplayText(song?.album);
  return {
    trackId: extractTrackIdFromValue(song?.tidalId || song?.url),
    url: normalizeUrlForCompare(song?.url),
    titleNorm: normalizeText(title),
    artistNorm: normalizeText(artist),
    albumNorm: normalizeText(album),
    titleTokens: tokenizeForSimilarity(title),
    albumTokens: tokenizeForSimilarity(album),
    duration: Number(song?.duration) || 0,
  };
}

export function createSearchEngine(state, browserController) {
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

  async function runBrowserSearch(query, type, searchTimeout, pipelineTimeout, label) {
    return withTimeout(
      browserController.runBrowserTask(async () => {
        const {page} = await withTimeout(
          browserController.initBrowser(),
          TIMEOUTS.browserInit,
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
        TIMEOUTS.fastTrack,
        "Fast track search"
      );
      setCachedTrackSearch(query, songs);
      return songs;
    } catch (fastSearchError) {
      const songs = await runBrowserSearch(
        query,
        "tracks",
        TIMEOUTS.trackFallback,
        TIMEOUTS.trackFallbackPipeline,
        "Track fallback search"
      );
      if (!songs.length) {
        throw fastSearchError;
      }
      setCachedTrackSearch(query, songs);
      return songs;
    }
  }

  async function searchArtistsFromTracksFallback(query) {
    const tracks = await searchTracksWithFallback(query);
    const artistsByKey = new Map();
    const queryNorm = normalizeText(query);
    const queryTokens = tokenizeForSimilarity(query);

    function shouldIncludeArtist(artistName, strict = true) {
      const artistNorm = normalizeText(artistName);
      if (!artistNorm) {
        return false;
      }
      if (!strict) {
        return true;
      }
      if (queryNorm && (artistNorm.includes(queryNorm) || queryNorm.includes(artistNorm))) {
        return true;
      }
      if (!queryTokens.length) {
        return true;
      }
      const overlap = getTokenOverlapScore(
        tokenizeForSimilarity(artistName),
        queryTokens,
        1
      );
      return overlap > 0;
    }

    function collectArtists(strictMatch) {
      for (const track of tracks) {
        const artistName = normalizeDisplayText(track?.artist);
        if (!artistName || !shouldIncludeArtist(artistName, strictMatch)) {
          continue;
        }

        const artistKey = normalizeText(artistName);
        if (!artistKey || artistsByKey.has(artistKey)) {
          continue;
        }

        artistsByKey.set(artistKey, {
          index: artistsByKey.size,
          type: "artist",
          title: artistName,
          artist: artistName,
          album: "",
          subtitle: "Artist",
          duration: 0,
          artwork: upscaleArtworkUrl(track?.artwork),
          url: null,
          downloadable: false,
          element: null,
        });
      }
    }

    collectArtists(true);
    if (artistsByKey.size === 0) {
      collectArtists(false);
    }

    return [...artistsByKey.values()];
  }

  async function searchByType(query, type = "tracks") {
    const normalizedType = String(type || "tracks").trim();
    const normalizedTypeKey = normalizedType.toLowerCase();
    if (normalizedTypeKey.startsWith("track")) {
      return searchTracksWithFallback(query);
    }

    if (normalizedTypeKey.startsWith("artist")) {
      let browserError = null;
      try {
        const artists = await runBrowserSearch(
          query,
          normalizedType,
          ARTIST_BROWSER_SEARCH_TIMEOUT_MS,
          ARTIST_BROWSER_PIPELINE_TIMEOUT_MS,
          "Search request"
        );
        if (artists.length > 0) {
          return artists;
        }
      } catch (error) {
        browserError = error;
      }

      const fallbackArtists = await searchArtistsFromTracksFallback(query);
      if (fallbackArtists.length > 0 || !browserError) {
        return fallbackArtists;
      }
      throw browserError;
    }

    return runBrowserSearch(
      query,
      normalizedType,
      TIMEOUTS.search,
      TIMEOUTS.searchPipeline,
      "Search request"
    );
  }

  function setLastSearchSongs(songs = []) {
    state.lastSearchSongs = Array.isArray(songs) ? songs : [];
    const lookup = {
      byTrackId: new Map(),
      byUrl: new Map(),
      byMeta: new Map(),
      byTitleArtist: new Map(),
    };

    for (const song of state.lastSearchSongs) {
      const trackId = extractTrackIdFromValue(song?.tidalId || song?.url);
      if (trackId && !lookup.byTrackId.has(trackId)) {
        lookup.byTrackId.set(trackId, song);
      }

      const url = normalizeUrlForCompare(song?.url);
      if (url && !lookup.byUrl.has(url)) {
        lookup.byUrl.set(url, song);
      }

      const title = normalizeText(song?.title);
      if (!title) {
        continue;
      }
      const artist = normalizeText(song?.artist);
      const album = normalizeText(song?.album);
      const duration = Number(song?.duration) || 0;

      const titleArtistKey = key2(title, artist);
      if (!lookup.byTitleArtist.has(titleArtistKey)) {
        lookup.byTitleArtist.set(titleArtistKey, song);
      }

      const metaKey = key3(title, artist, album);
      const metaList = lookup.byMeta.get(metaKey);
      if (metaList) {
        metaList.push([song, duration]);
      } else {
        lookup.byMeta.set(metaKey, [[song, duration]]);
      }
    }

    state.lastSearchLookup = lookup;
  }

  function findSongByIdentity(song) {
    if (!song) {
      return null;
    }

    const lookup = state.lastSearchLookup || LOOKUP_EMPTY;
    const trackId = extractTrackIdFromValue(song.tidalId || song.url);
    if (trackId) {
      const byTrackId = lookup.byTrackId.get(trackId);
      if (byTrackId) {
        return byTrackId;
      }
    }

    const url = normalizeUrlForCompare(song.url);
    if (url) {
      const byUrl = lookup.byUrl.get(url);
      if (byUrl) {
        return byUrl;
      }
    }

    const title = normalizeText(song.title);
    if (!title) {
      return null;
    }

    const artist = normalizeText(song.artist);
    const album = normalizeText(song.album);
    const duration = Number(song.duration) || 0;
    const metaMatches = lookup.byMeta.get(key3(title, artist, album));
    if (metaMatches?.length) {
      if (!duration) {
        return metaMatches[0][0];
      }
      for (const [matchedSong, matchedDuration] of metaMatches) {
        if (!matchedDuration || Math.abs(matchedDuration - duration) <= 2) {
          return matchedSong;
        }
      }
    }

    return lookup.byTitleArtist.get(key2(title, artist)) || null;
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

  function buildResolveQueries(song) {
    const title = normalizeDisplayText(song?.title);
    const artist = normalizeDisplayText(song?.artist);
    const album = normalizeDisplayText(song?.album);
    const variants = [];
    const variantSeen = new Set();

    addUniqueText(variants, variantSeen, title);
    addUniqueText(variants, variantSeen, cleanSearchQueryPart(title));

    const fromMatch = title.match(/\(\s*from\s+["']?([^"')]+)["']?\s*\)/i);
    const fromLabel = fromMatch ? normalizeDisplayText(fromMatch[1]) : "";
    if (fromMatch) {
      const withoutFrom = normalizeDisplayText(title.replace(fromMatch[0], " "));
      addUniqueText(variants, variantSeen, withoutFrom);
      addUniqueText(variants, variantSeen, cleanSearchQueryPart(withoutFrom));
      addUniqueText(variants, variantSeen, fromLabel);
    }

    const dashParts = title
      .split(/\s+-\s+/)
      .map(part => normalizeDisplayText(part))
      .filter(Boolean);
    if (dashParts.length >= 2) {
      const left = dashParts[0];
      const right = normalizeDisplayText(dashParts.slice(1).join(" "));
      addUniqueText(variants, variantSeen, `${right} ${left}`);
      addUniqueText(variants, variantSeen, `${left} ${right}`);
      addUniqueText(
        variants,
        variantSeen,
        `${cleanSearchQueryPart(right)} ${cleanSearchQueryPart(left)}`
      );
      if (fromLabel) {
        addUniqueText(variants, variantSeen, `${right} ${fromLabel}`);
      }
    }

    const queries = [];
    const querySeen = new Set();
    for (const variant of variants) {
      addUniqueText(queries, querySeen, `${variant} ${artist}`);
      addUniqueText(queries, querySeen, `${artist} ${variant}`);
      addUniqueText(queries, querySeen, `${variant} ${album}`);
      addUniqueText(queries, querySeen, `${album} ${variant}`);
      addUniqueText(queries, querySeen, variant);
    }

    addUniqueText(queries, querySeen, `${title} ${artist} ${album}`);
    addUniqueText(queries, querySeen, `${artist} ${title} ${album}`);
    addUniqueText(queries, querySeen, `${album} ${title} ${artist}`);
    addUniqueText(queries, querySeen, `${artist} ${album}`);
    addUniqueText(queries, querySeen, `${album} ${artist}`);

    const maxQueries = extractTrackIdFromValue(song?.tidalId || song?.url) ? 3 : 5;
    return queries.slice(0, maxQueries);
  }

  function scoreCandidateMatch(candidate, target) {
    const candidateTrackId = extractTrackIdFromValue(candidate?.tidalId || candidate?.url);
    if (candidateTrackId && target.trackId && candidateTrackId === target.trackId) {
      return 1200;
    }

    const candidateUrl = normalizeUrlForCompare(candidate?.url);
    if (candidateUrl && target.url) {
      if (candidateUrl === target.url) {
        return EXACT_MATCH_SCORE;
      }
      if (candidateUrl.endsWith(target.url) || target.url.endsWith(candidateUrl)) {
        return 700;
      }
    }

    const titleNorm = normalizeText(candidate?.title);
    const artistNorm = normalizeText(candidate?.artist);
    const albumNorm = normalizeText(candidate?.album);
    const duration = Number(candidate?.duration) || 0;

    let score = candidateTrackId && target.trackId ? -35 : 0;
    score += scoreText(titleNorm, target.titleNorm, 140, 90);
    score += getTokenOverlapScore(tokenizeForSimilarity(candidate?.title), target.titleTokens, 80);
    score += scoreText(artistNorm, target.artistNorm, 45, 20);
    score += scoreText(albumNorm, target.albumNorm, 65, 30);
    score += getTokenOverlapScore(tokenizeForSimilarity(candidate?.album), target.albumTokens, 30);

    if (duration > 0 && target.duration > 0) {
      const delta = Math.abs(duration - target.duration);
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
    if (!query) {
      return [];
    }
    return withTimeout(
      searchSongs(page, query, "tracks", {
        fastResolve: true,
        maxTrackResults: RESOLVE_MAX_TRACK_RESULTS,
      }),
      TIMEOUTS.resolve,
      `Resolve query "${query}"`
    );
  }

  function emitResolveProgress(onProgress, selectedSong, phase, progress) {
    onProgress({status: "preparing", phase, progress, ...toSongMeta(selectedSong)});
  }

  async function resolveDownloadableSong(index, song, onProgress = () => {}) {
    let selectedSong = getSongFromRequest(index, song);
    if (!selectedSong && song?.title) {
      selectedSong = {...song, downloadable: song.downloadable !== false, element: null};
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
    const target = buildTargetProfile(selectedSong);
    const {page} = browserController.getBrowserInstance();
    const resolveQueries = buildResolveQueries(selectedSong);

    emitResolveProgress(onProgress, selectedSong, "resolving", 22);

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

      let foundExact = false;
      for (const candidate of candidates) {
        const score = scoreCandidateMatch(candidate, target);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
        if (score >= EXACT_MATCH_SCORE) {
          foundExact = true;
          break;
        }
      }

      if (foundExact || bestScore >= STRONG_MATCH_SCORE) {
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
