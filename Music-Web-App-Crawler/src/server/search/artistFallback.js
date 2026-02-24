import {
  getTokenOverlapScore,
  normalizeDisplayText,
  normalizeText,
  tokenizeForSimilarity,
  upscaleArtworkUrl,
} from "../helpers.js";

export function buildArtistsFromTracks(query, tracks = []) {
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
