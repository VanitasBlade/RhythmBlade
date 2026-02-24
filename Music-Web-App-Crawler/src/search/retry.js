import {SELECTORS} from "../config.js";

function getNonTrackCardLocator(page, searchType) {
  if (searchType === "playlists") {
    return page.locator('a[href^="/playlist/"], a[href*="/playlist/"]');
  }
  return null;
}

async function waitForNonTrackCards(page, searchType, timeoutMs = 6000) {
  const cards = getNonTrackCardLocator(page, searchType);
  if (!cards) {
    return false;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const count = await cards.count().catch(() => 0);
    if (count > 0) {
      return true;
    }

    const stillSearching = await page
      .locator("text=/Searching/i")
      .first()
      .isVisible()
      .catch(() => false);
    if (!stillSearching) {
      await page.waitForTimeout(180);
      return (await cards.count().catch(() => 0)) > 0;
    }

    await page.waitForTimeout(260);
  }

  return (await cards.count().catch(() => 0)) > 0;
}

export async function parsePlaylistsWithRetry(
  page,
  switchToTypeTab,
  parsePlaylistResults,
  attempts = 2,
  maxResults = 60
) {
  let results = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await waitForNonTrackCards(page, "playlists", 1800 + attempt * 1200);
    results = await parsePlaylistResults(page, maxResults);
    if (results.length > 0) {
      return results;
    }

    if (attempt === attempts - 1) {
      return results;
    }

    await page.waitForTimeout(320 + attempt * 180);
    await switchToTypeTab(page, "playlists");
  }

  return results;
}

export async function parseTrackResultsWithRetry(
  page,
  switchToTypeTab,
  parseTrackResults,
  attempts = 2,
  maxResults = 60
) {
  const buttons = page.locator(SELECTORS.downloadButton);

  const waitForButtons = async timeoutMs => {
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

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await waitForButtons(2000 + attempt * 1200);
    results = await parseTrackResults(page, maxResults);
    if (results.length > 0) {
      return results;
    }

    if (attempt === attempts - 1) {
      return results;
    }

    await page.waitForTimeout(400 + attempt * 300);
    await switchToTypeTab(page, "tracks");
  }

  return results;
}
