import path from "path";

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeDisplayText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeUrlForCompare(value) {
  const input = String(value || "").trim();
  if (!input) {
    return "";
  }

  return input
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

export function extractTrackIdFromValue(value) {
  const input = normalizeDisplayText(value);
  if (!input) {
    return "";
  }

  const direct = input.match(/^\d+$/);
  if (direct) {
    return direct[0];
  }

  const fromPath =
    input.match(/\/track\/(\d+)/i) || input.match(/\/tracks\/(\d+)/i);
  return fromPath?.[1] || "";
}

export function isUnknownValue(value) {
  const normalized = normalizeText(value);
  return (
    !normalized || normalized === "unknown" || normalized === "unknown artist"
  );
}

export function parseMetadataFromFilename(filename) {
  const stem = path.parse(String(filename || "")).name;
  if (!stem) {
    return {artist: "", title: ""};
  }

  const parts = stem
    .split(" - ")
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return {
      artist: parts[0],
      title: parts.slice(1).join(" - "),
    };
  }

  return {
    artist: "",
    title: stem,
  };
}

export function mergeSongMetadata(primary = {}, fallback = {}) {
  const merged = {...primary};
  const fields = ["title", "artist", "album"];
  for (const field of fields) {
    const primaryValue = normalizeDisplayText(merged[field]);
    const fallbackValue = normalizeDisplayText(fallback[field]);
    if (isUnknownValue(primaryValue) && fallbackValue) {
      merged[field] = fallbackValue;
    }
  }

  if (!merged.artwork && fallback.artwork) {
    merged.artwork = fallback.artwork;
  }
  if (
    (!Number(merged.duration) || Number(merged.duration) <= 0) &&
    Number(fallback.duration) > 0
  ) {
    merged.duration = Number(fallback.duration);
  }

  return merged;
}

export function applyFilenameMetadataFallback(song, filename) {
  const fromFilename = parseMetadataFromFilename(filename);
  return mergeSongMetadata(song, fromFilename);
}

export function upscaleArtworkUrl(url, size = 640) {
  const input = String(url || "").trim();
  if (!input) {
    return null;
  }

  if (input.includes("resources.tidal.com/images/")) {
    return input.replace(
      /\/\d+x\d+(\.(jpg|jpeg|png|webp))$/i,
      `/${size}x${size}$1`
    );
  }

  return input;
}

export function clampProgress(value, fallback = 0) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function cleanSearchQueryPart(value) {
  return normalizeDisplayText(value)
    .replace(/["'`]/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[|/\\,:;!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeForSimilarity(value) {
  const normalized = normalizeText(value)
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized ? normalized.split(/\s+/) : [];
}

export function getTokenOverlapScore(sourceTokens, targetTokens, weight = 60) {
  if (!sourceTokens.length || !targetTokens.length) {
    return 0;
  }

  const targetSet = new Set(targetTokens);
  let matched = 0;
  for (const token of sourceTokens) {
    if (targetSet.has(token)) {
      matched += 1;
    }
  }

  const ratio = matched / Math.max(sourceTokens.length, targetTokens.length);
  return Math.round(ratio * weight);
}
