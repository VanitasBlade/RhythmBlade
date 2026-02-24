import {SEARCH_TYPES} from "../config.js";

export const BULLET = "\u2022";

export function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

export function resolveSearchType(value) {
  const normalized = normalizeText(String(value || "")).toLowerCase();
  if (!normalized) {
    return "tracks";
  }

  if (normalized.startsWith("track")) return "tracks";
  if (normalized.startsWith("album")) return "albums";
  if (normalized.startsWith("playlist")) return "playlists";

  return SEARCH_TYPES.includes(normalized) ? normalized : "tracks";
}

export function parseDuration(value) {
  const match = String(value || "").match(/\b(\d{1,2}):(\d{2})\b/);
  if (!match) {
    return 0;
  }
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

export function resolveAlbumPath(value) {
  const input = normalizeText(String(value || ""));
  if (!input) {
    return "";
  }

  if (input.startsWith("http://") || input.startsWith("https://")) {
    try {
      const parsed = new URL(input);
      const match = parsed.pathname.match(/\/album\/(\d+)/i);
      if (match?.[1]) {
        return `/album/${match[1]}`;
      }
      return parsed.pathname || "";
    } catch {
      return "";
    }
  }

  if (input.startsWith("/album/")) {
    const match = input.match(/\/album\/(\d+)/i);
    return match?.[1] ? `/album/${match[1]}` : input;
  }

  const directMatch = input.match(/^(\d+)$/);
  if (directMatch?.[1]) {
    return `/album/${directMatch[1]}`;
  }

  const fromPath = input.match(/\/album\/(\d+)/i);
  if (fromPath?.[1]) {
    return `/album/${fromPath[1]}`;
  }

  return "";
}

export function extractTrackIdFromUrl(value) {
  const input = normalizeText(value);
  if (!input) {
    return null;
  }

  const match = input.match(/\/track\/(\d+)/i) || input.match(/\/tracks\/(\d+)/i);
  return match?.[1] || null;
}

export function getSubtitleFromLines(lines) {
  return lines.map(normalizeText).filter(Boolean).join(" - ");
}
