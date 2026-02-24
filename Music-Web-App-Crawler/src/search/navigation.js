import {BASE_URL, SELECTORS} from "../config.js";
import {resolveAlbumPath} from "./utils.js";

const TYPE_TO_SELECTOR = {
  tracks: SELECTORS.tracksTab,
  albums: SELECTORS.albumsTab,
  playlists: SELECTORS.playlistsTab,
};

export async function switchToTypeTab(page, searchType) {
  const selector = TYPE_TO_SELECTOR[searchType] || TYPE_TO_SELECTOR.tracks;
  const tab = page.locator(selector).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click({timeout: 2000}).catch(() => {});
  }
}

export async function ensureSearchReady(page) {
  const searchInput = page.locator(SELECTORS.searchInput).first();
  const alreadyVisible = await searchInput.isVisible().catch(() => false);
  if (alreadyVisible) {
    return searchInput;
  }

  await page.goto(BASE_URL, {waitUntil: "domcontentloaded"});
  await searchInput.waitFor({state: "visible", timeout: 15000});
  return searchInput;
}

export async function ensureAlbumReady(page, albumPath) {
  const normalizedPath = resolveAlbumPath(albumPath);
  if (!normalizedPath) {
    throw new Error("Album path is missing or invalid.");
  }

  const absoluteUrl = normalizedPath.startsWith("http")
    ? normalizedPath
    : `${BASE_URL.replace(/\/$/, "")}${normalizedPath}`;

  await page.goto(absoluteUrl, {waitUntil: "domcontentloaded"});

  const albumRoot = page.locator(".album-page").first();
  await albumRoot.waitFor({state: "visible", timeout: 15000});

  const downloadButtons = page.locator('button[aria-label="Download track"]');
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    const count = await downloadButtons.count().catch(() => 0);
    if (count > 0) {
      return normalizedPath;
    }
    await page.waitForTimeout(250);
  }

  return normalizedPath;
}
