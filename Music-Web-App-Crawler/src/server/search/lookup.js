import {extractTrackIdFromValue, normalizeText, normalizeUrlForCompare} from "../helpers.js";

const SEP = "\u0001";
const LOOKUP_EMPTY = {
  byTrackId: new Map(),
  byUrl: new Map(),
  byMeta: new Map(),
  byTitleArtist: new Map(),
};

const key2 = (a, b) => `${a}${SEP}${b}`;
const key3 = (a, b, c) => `${a}${SEP}${b}${SEP}${c}`;

export function createLookupStore(state) {
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

  function isIndexedCandidateMatch(candidate, song) {
    if (!candidate || !song) {
      return false;
    }

    const candidateTrackId = extractTrackIdFromValue(candidate?.tidalId || candidate?.url);
    const requestTrackId = extractTrackIdFromValue(song?.tidalId || song?.url);
    if (candidateTrackId && requestTrackId) {
      return candidateTrackId === requestTrackId;
    }

    const candidateTitle = normalizeText(candidate?.title);
    const requestTitle = normalizeText(song?.title);
    if (!candidateTitle || !requestTitle || candidateTitle !== requestTitle) {
      return false;
    }

    const candidateArtist = normalizeText(candidate?.artist);
    const requestArtist = normalizeText(song?.artist);
    if (requestArtist && candidateArtist && candidateArtist !== requestArtist) {
      return false;
    }

    const candidateAlbum = normalizeText(candidate?.album);
    const requestAlbum = normalizeText(song?.album);
    if (requestAlbum && candidateAlbum && candidateAlbum !== requestAlbum) {
      return false;
    }

    return true;
  }

  function getSongFromRequest(index, song) {
    if (Number.isInteger(index)) {
      const byIndex = state.lastSearchSongs[index] || null;
      if (!song) {
        return byIndex;
      }
      if (isIndexedCandidateMatch(byIndex, song)) {
        return byIndex;
      }
      return findSongByIdentity(song) || null;
    }
    if (song && typeof song.index === "number") {
      const bySongIndex = state.lastSearchSongs[song.index] || null;
      if (isIndexedCandidateMatch(bySongIndex, song)) {
        return bySongIndex;
      }
      return findSongByIdentity(song) || null;
    }
    return findSongByIdentity(song);
  }

  return {
    setLastSearchSongs,
    getSongFromRequest,
  };
}
