function createEmptySearchLookup() {
  return {
    byTrackId: new Map(),
    byUrl: new Map(),
    byMeta: new Map(),
    byTitleArtist: new Map(),
  };
}

export function createServerState() {
  return {
    browserInstance: null,
    browserQueue: Promise.resolve(),
    browserInitialized: false,
    lastSearchSongs: [],
    lastSearchLookup: createEmptySearchLookup(),
    downloadedSongs: new Map(),
    downloadJobs: new Map(),
    trackSearchCache: new Map(),
  };
}
