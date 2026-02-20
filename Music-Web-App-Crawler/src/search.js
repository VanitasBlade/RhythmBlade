import { BASE_URL, SEARCH_TYPES, SELECTORS } from "./config.js";

const BULLET = "\u2022";

const TYPE_TO_SELECTOR = {
  tracks: SELECTORS.tracksTab,
  albums: SELECTORS.albumsTab,
  artists: SELECTORS.artistsTab,
  playlists: SELECTORS.playlistsTab,
};

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function resolveSearchType(value) {
  const normalized = normalizeText(String(value || "")).toLowerCase();
  if (!normalized) {
    return "tracks";
  }

  if (normalized.startsWith("track")) return "tracks";
  if (normalized.startsWith("album")) return "albums";
  if (normalized.startsWith("artist")) return "artists";
  if (normalized.startsWith("playlist")) return "playlists";

  return SEARCH_TYPES.includes(normalized) ? normalized : "tracks";
}

function parseDuration(value) {
  const match = String(value || "").match(/\b(\d{1,2}):(\d{2})\b/);
  if (!match) {
    return 0;
  }
  return (parseInt(match[1], 10) * 60) + parseInt(match[2], 10);
}

async function switchToTypeTab(page, searchType) {
  const selector = TYPE_TO_SELECTOR[searchType] || TYPE_TO_SELECTOR.tracks;
  const tab = page.locator(selector).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click({ timeout: 2000 }).catch(() => {});
  }
}

async function ensureSearchReady(page) {
  const searchInput = page.locator(SELECTORS.searchInput).first();
  const alreadyVisible = await searchInput.isVisible().catch(() => false);
  if (alreadyVisible) {
    return searchInput;
  }

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await searchInput.waitFor({ state: "visible", timeout: 15000 });
  return searchInput;
}

function getSubtitleFromLines(lines) {
  return lines.map(normalizeText).filter(Boolean).join(" - ");
}

async function parseTrackResults(page, maxResults = 60) {
  const downloadButtons = page.locator(SELECTORS.downloadButton);
  const buttonCount = await downloadButtons.count();
  const limit = Math.min(buttonCount, maxResults);
  const results = [];

  for (let i = 0; i < limit; i++) {
    const button = downloadButtons.nth(i);
    const card = button.locator("xpath=ancestor::*[@role='button'][1]");

    const ariaLabel = normalizeText(await button.getAttribute("aria-label").catch(() => ""));
    const titleFromAria = ariaLabel.replace(/^Download\s+/i, "").trim();
    const titleRaw = await card.locator("h3").first().textContent().catch(() => "");
    const title = titleFromAria || normalizeText(titleRaw) || "Unknown";

    const lines = (await card.locator("p").allTextContents().catch(() => []))
      .map(normalizeText)
      .filter(Boolean);

    const meta = lines.find((line) => line.includes(BULLET)) || "";
    const artist = lines.find((line) => line !== meta) || "Unknown";
    const album = meta ? normalizeText(meta.split(BULLET)[0]) : "";
    const duration = parseDuration(meta);
    const artwork = await card.locator("img").first().getAttribute("src").catch(() => null);

    results.push({
      index: results.length,
      type: "track",
      title,
      artist,
      album,
      subtitle: meta || artist,
      duration,
      artwork: artwork || null,
      downloadable: true,
      element: card,
    });
  }

  return results;
}

async function parseAlbumResults(page, maxResults = 60) {
  const downloadButtons = page.locator(SELECTORS.downloadButton);
  const buttonCount = await downloadButtons.count();
  const limit = Math.min(buttonCount, maxResults);
  const results = [];

  for (let i = 0; i < limit; i++) {
    const button = downloadButtons.nth(i);
    const card = button.locator("xpath=ancestor::*[.//a[starts-with(@href,'/album/')]][1]");

    const ariaLabel = normalizeText(await button.getAttribute("aria-label").catch(() => ""));
    const titleFromAria = ariaLabel.replace(/^Download\s+/i, "").trim();
    const titleRaw = await card.locator("h3").first().textContent().catch(() => "");
    const title = titleFromAria || normalizeText(titleRaw) || "Unknown";

    const lines = (await card.locator("p").allTextContents().catch(() => []))
      .map(normalizeText)
      .filter(Boolean);
    const subtitle = getSubtitleFromLines(lines);

    const artwork = await card.locator("img").first().getAttribute("src").catch(() => null);
    const href = await card.locator('a[href^="/album/"]').first().getAttribute("href").catch(() => null);
    const artist = lines[0] || "Unknown";

    results.push({
      index: results.length,
      type: "album",
      title,
      artist,
      album: title,
      subtitle,
      duration: 0,
      artwork: artwork || null,
      url: href || null,
      downloadable: true,
      element: card,
    });
  }

  return results;
}

async function parseArtistResults(page, maxResults = 60) {
  const cards = page.locator('a[href^="/artist/"]');
  const count = await cards.count();
  const limit = Math.min(count, maxResults);
  const results = [];

  for (let i = 0; i < limit; i++) {
    const card = cards.nth(i);
    const title = normalizeText(await card.locator("h3").first().textContent().catch(() => "")) || "Unknown";
    const lines = (await card.locator("p").allTextContents().catch(() => []))
      .map(normalizeText)
      .filter(Boolean);
    const subtitle = getSubtitleFromLines(lines);
    const artwork = await card.locator("img").first().getAttribute("src").catch(() => null);
    const href = await card.getAttribute("href").catch(() => null);

    results.push({
      index: results.length,
      type: "artist",
      title,
      artist: title,
      album: "",
      subtitle,
      duration: 0,
      artwork: artwork || null,
      url: href || null,
      downloadable: false,
      element: null,
    });
  }

  return results;
}

async function parsePlaylistResults(page, maxResults = 60) {
  const cards = page.locator('a[href^="/playlist/"]');
  const count = await cards.count();
  const limit = Math.min(count, maxResults);
  const results = [];

  for (let i = 0; i < limit; i++) {
    const card = cards.nth(i);
    const title = normalizeText(await card.locator("h3").first().textContent().catch(() => "")) || "Unknown";
    const lines = (await card.locator("p").allTextContents().catch(() => []))
      .map(normalizeText)
      .filter(Boolean);
    const subtitle = getSubtitleFromLines(lines);
    const artwork = await card.locator("img").first().getAttribute("src").catch(() => null);
    const href = await card.getAttribute("href").catch(() => null);

    results.push({
      index: results.length,
      type: "playlist",
      title,
      artist: "",
      album: "",
      subtitle,
      duration: 0,
      artwork: artwork || null,
      url: href || null,
      downloadable: false,
      element: null,
    });
  }

  return results;
}

async function parseTrackResultsWithRetry(page, attempts = 2) {
  const buttons = page.locator(SELECTORS.downloadButton);

  const waitForButtons = async (timeoutMs) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const count = await buttons.count().catch(() => 0);
      if (count > 0) {
        return true;
      }
      await page.waitForTimeout(300);
    }
    return false;
  };

  let results = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    await waitForButtons(2000 + (attempt * 1200));
    results = await parseTrackResults(page);
    if (results.length > 0) {
      return results;
    }

    if (attempt === attempts - 1) {
      return results;
    }

    // Track results can occasionally render late; retry after a short settle.
    await page.waitForTimeout(400 + (attempt * 300));
    await switchToTypeTab(page, "tracks");
  }

  return results;
}

export async function searchSongs(page, query, searchType = "tracks") {
  if (!query || !query.trim()) {
    return [];
  }

  const type = resolveSearchType(searchType);
  await page.waitForLoadState("domcontentloaded");

  const searchInput = await ensureSearchReady(page);

  await switchToTypeTab(page, type);

  await searchInput.fill("");
  await searchInput.fill(query.trim());

  const button = page.locator(SELECTORS.searchButton).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click({ timeout: 3000 }).catch(async () => {
      await searchInput.press("Enter");
    });
  } else {
    await searchInput.press("Enter");
  }

  const settleMs = type === "tracks" ? 1500 : 2600;
  const postTabMs = type === "tracks" ? 400 : 900;
  await page.waitForTimeout(settleMs);
  await switchToTypeTab(page, type);
  await page.waitForTimeout(postTabMs);

  if (type === "albums") {
    return parseAlbumResults(page);
  }
  if (type === "artists") {
    return parseArtistResults(page);
  }
  if (type === "playlists") {
    return parsePlaylistResults(page);
  }

  return parseTrackResultsWithRetry(page);
}
