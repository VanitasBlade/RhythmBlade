const SEARCH_ENDPOINTS = [
  "https://tidal-api.binimum.org/search/?s=",
  "https://tidal.kinoplus.online/search/?s=",
];
const BULLET = "\u2022";
const FAST_SEARCH_TIMEOUT_MS = 5000;

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function parseCoverImage(cover, size = 640) {
  const normalized = normalizeText(cover);
  if (!normalized) {
    return null;
  }
  return `https://resources.tidal.com/images/${normalized.replace(/-/g, "/")}/${size}x${size}.jpg`;
}

function deriveQuality(item) {
  const tags = item?.mediaMetadata?.tags || [];
  if (Array.isArray(tags) && tags.includes("HIRES_LOSSLESS")) {
    return "Hi-Res";
  }
  return "CD";
}

async function fetchJson(url, timeoutMs = FAST_SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFirstPopulatedPayload(normalizedQuery) {
  const encodedQuery = encodeURIComponent(normalizedQuery);
  const attempts = SEARCH_ENDPOINTS.map(async (baseUrl) => {
    const payload = await fetchJson(`${baseUrl}${encodedQuery}`);
    const items = payload?.data?.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("No items");
    }
    return payload;
  });

  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

export async function searchTracksFast(query, maxResults = 25) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return [];
  }

  const payload = await fetchFirstPopulatedPayload(normalizedQuery);

  const items = payload?.data?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items.slice(0, maxResults).map((item, index) => {
    const title = normalizeText(item?.title) || "Unknown";
    const artist = normalizeText(item?.artist?.name) || "Unknown";
    const album = normalizeText(item?.album?.title) || "";
    const quality = deriveQuality(item);
    const subtitle = [album, quality, "16-bit/44.1 kHz FLAC"]
      .filter(Boolean)
      .join(` ${BULLET} `);

    return {
      index,
      type: "track",
      title,
      artist,
      album,
      subtitle,
      duration: Number(item?.duration || 0),
      artwork: parseCoverImage(item?.album?.cover),
      downloadable: true,
      // Track fast path has no DOM element; download route resolves it lazily.
      element: null,
      tidalId: item?.id || null,
      url: item?.url || null,
    };
  });
}
