export const BASE_URL = "https://tidal.squid.wtf/";
export const SESSION_FILE = "./.session/squid-state.json";

export const SELECTORS = {
  searchInput: 'input[placeholder^="Search for"]',
  searchButton: 'button:has-text("Search")',
  tracksTab: 'button:has-text("Tracks")',
  albumsTab: 'button:has-text("Albums")',
  playlistsTab: 'button:has-text("Playlists")',
  title: "h1, h2, h3",
  artist: "p, div",
  downloadButton: 'button[aria-label^="Download "]',
  settingsButton: 'button[aria-label^="Settings menu"]',
  settingsPanel: 'div:has-text("STREAMING & DOWNLOADS")',
};

export const SEARCH_TYPES = ["tracks", "albums", "playlists"];

export const DOWNLOAD_SETTINGS = [
  "Hi-Res",
  "CD Lossless",
  "320kbps AAC",
  "96kbps AAC",
];
