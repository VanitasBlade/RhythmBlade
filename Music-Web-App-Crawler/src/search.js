import {ensureAlbumReady, ensureSearchReady, switchToTypeTab} from "./search/navigation.js";
import {SELECTORS} from "./config.js";
import {
  parseAlbumResults,
  parseAlbumTrackResults,
  parsePlaylistResults,
  parseTrackResults,
} from "./search/parsers.js";
import {
  parsePlaylistsWithRetry,
  parseTrackResultsWithRetry,
} from "./search/retry.js";
import {resolveSearchType} from "./search/utils.js";

export async function searchSongs(page, query, searchType = "tracks", options = {}) {
  if (!query || !query.trim()) {
    return [];
  }

  const fastResolve = Boolean(options?.fastResolve);
  const maxTrackResults = Math.max(
    8,
    Math.min(Number(options?.maxTrackResults) || 60, 100)
  );
  const trackParseAttempts = fastResolve ? 1 : 2;
  const type = resolveSearchType(searchType);
  await page.waitForLoadState("domcontentloaded");

  const searchInput = await ensureSearchReady(page);

  await switchToTypeTab(page, type);
  await searchInput.fill("");
  await searchInput.fill(query.trim());

  const button = page.locator(SELECTORS.searchButton).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click({timeout: 3000}).catch(async () => {
      await searchInput.press("Enter");
    });
  } else {
    await searchInput.press("Enter");
  }

  const settleMs = type === "tracks" ? (fastResolve ? 900 : 1500) : 2600;
  const postTabMs = type === "tracks" ? (fastResolve ? 220 : 400) : 900;
  await page.waitForTimeout(settleMs);
  await switchToTypeTab(page, type);
  await page.waitForTimeout(postTabMs);

  if (type === "albums") {
    return parseAlbumResults(page);
  }
  if (type === "playlists") {
    return parsePlaylistsWithRetry(page, switchToTypeTab, parsePlaylistResults);
  }

  return parseTrackResultsWithRetry(
    page,
    switchToTypeTab,
    parseTrackResults,
    trackParseAttempts,
    maxTrackResults
  );
}

export async function getAlbumTracks(page, albumPath, options = {}) {
  const normalizedAlbumPath = await ensureAlbumReady(page, albumPath);
  const maxResults = Math.max(
    1,
    Math.min(Number(options?.maxTrackResults) || 220, 400)
  );
  return parseAlbumTrackResults(page, normalizedAlbumPath, maxResults, options);
}
