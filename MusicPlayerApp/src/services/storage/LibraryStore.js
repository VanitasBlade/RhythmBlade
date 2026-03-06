function safeString(value) {
  return String(value || '').trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class LibraryStore {
  constructor(options = {}) {
    this.byId = new Map();
    this.byMediaStoreId = new Map();
    this.byPathKey = new Map();
    this.byContentUri = new Map();
    this.listeners = new Set();

    this.flushDebounceMs = Math.max(0, Number(options.flushDebounceMs) || 0);
    this.flushMaxWaitMs = Math.max(
      this.flushDebounceMs,
      Number(options.flushMaxWaitMs) || this.flushDebounceMs,
    );
    this.onFlush =
      typeof options.onFlush === 'function' ? options.onFlush : async () => {};
    this.onError =
      typeof options.onError === 'function' ? options.onError : () => {};
    this.getMediaStoreId =
      typeof options.getMediaStoreId === 'function'
        ? options.getMediaStoreId
        : song => safeString(song?.mediaStoreId);
    this.getPathKey =
      typeof options.getPathKey === 'function' ? options.getPathKey : () => '';
    this.getContentUri =
      typeof options.getContentUri === 'function'
        ? options.getContentUri
        : song => safeString(song?.contentUri || song?.url);

    this.dirty = false;
    this.flushTimer = null;
    this.maxFlushTimer = null;
    this.flushInFlight = null;
    this.retryAttempt = 0;
    this.recentSnapshot = [];
  }

  isHydrated() {
    return this.byId.size > 0 || this.recentSnapshot.length > 0;
  }

  clearFlushTimers() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.maxFlushTimer) {
      clearTimeout(this.maxFlushTimer);
      this.maxFlushTimer = null;
    }
  }

  getAll() {
    return Array.from(this.byId.values());
  }

  getById(id) {
    const normalizedId = safeString(id);
    if (!normalizedId) {
      return null;
    }
    return this.byId.get(normalizedId) || null;
  }

  getByMediaStoreId(mediaStoreId) {
    const normalized = safeString(mediaStoreId);
    if (!normalized) {
      return null;
    }
    const id = this.byMediaStoreId.get(normalized);
    if (!id) {
      return null;
    }
    return this.byId.get(id) || null;
  }

  getByPathKey(pathKey) {
    const normalized = safeString(pathKey).toLowerCase();
    if (!normalized) {
      return null;
    }
    const id = this.byPathKey.get(normalized);
    if (!id) {
      return null;
    }
    return this.byId.get(id) || null;
  }

  getByContentUri(contentUri) {
    const normalized = safeString(contentUri).toLowerCase();
    if (!normalized) {
      return null;
    }
    const id = this.byContentUri.get(normalized);
    if (!id) {
      return null;
    }
    return this.byId.get(id) || null;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    this.listeners.add(listener);
    try {
      listener(this.getAll());
    } catch (error) {
      // Ignore listener errors.
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit() {
    const snapshot = this.getAll();
    this.listeners.forEach(listener => {
      try {
        listener(snapshot);
      } catch (error) {
        // Ignore listener errors.
      }
    });
  }

  normalizeSong(song) {
    if (!song || typeof song !== 'object') {
      return null;
    }
    const id = safeString(song.id);
    if (!id) {
      return null;
    }
    return {
      ...song,
      id,
    };
  }

  clearIndexesForSong(song) {
    const id = safeString(song?.id);
    if (!id) {
      return;
    }

    const mediaStoreId = safeString(this.getMediaStoreId(song));
    if (mediaStoreId && this.byMediaStoreId.get(mediaStoreId) === id) {
      this.byMediaStoreId.delete(mediaStoreId);
    }

    const pathKey = safeString(this.getPathKey(song)).toLowerCase();
    if (pathKey && this.byPathKey.get(pathKey) === id) {
      this.byPathKey.delete(pathKey);
    }

    const contentUri = safeString(this.getContentUri(song)).toLowerCase();
    if (contentUri && this.byContentUri.get(contentUri) === id) {
      this.byContentUri.delete(contentUri);
    }
  }

  indexSong(song) {
    const id = safeString(song?.id);
    if (!id) {
      return;
    }

    const mediaStoreId = safeString(this.getMediaStoreId(song));
    if (mediaStoreId) {
      this.byMediaStoreId.set(mediaStoreId, id);
    }

    const pathKey = safeString(this.getPathKey(song)).toLowerCase();
    if (pathKey) {
      this.byPathKey.set(pathKey, id);
    }

    const contentUri = safeString(this.getContentUri(song)).toLowerCase();
    if (contentUri) {
      this.byContentUri.set(contentUri, id);
    }
  }

  applyUpsert(song) {
    const normalized = this.normalizeSong(song);
    if (!normalized) {
      return false;
    }

    const id = normalized.id;
    const previous = this.byId.get(id);
    if (previous) {
      this.clearIndexesForSong(previous);
    }
    this.byId.set(id, normalized);
    this.indexSong(normalized);
    return true;
  }

  markDirtyAndSchedule() {
    this.dirty = true;
    this.scheduleFlush();
  }

  scheduleFlush() {
    if (!this.dirty) {
      return;
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushNow('debounce').catch(() => {});
      }, this.flushDebounceMs);
    }

    if (!this.maxFlushTimer) {
      this.maxFlushTimer = setTimeout(() => {
        this.maxFlushTimer = null;
        this.flushNow('max-wait').catch(() => {});
      }, this.flushMaxWaitMs);
    }
  }

  hasPendingFlush() {
    return Boolean(this.dirty || this.flushTimer || this.maxFlushTimer);
  }

  hydrateFromSnapshot(songs = [], options = {}) {
    this.replaceAll(songs, {
      markDirty: false,
      emit: options.emit !== false,
    });
  }

  replaceAll(songs = [], options = {}) {
    const markDirty = options.markDirty === true;
    const emit = options.emit !== false;
    this.byId.clear();
    this.byMediaStoreId.clear();
    this.byPathKey.clear();
    this.byContentUri.clear();

    const list = Array.isArray(songs) ? songs : [];
    list.forEach(song => {
      this.applyUpsert(song);
    });
    this.recentSnapshot = this.getAll();
    if (markDirty) {
      this.markDirtyAndSchedule();
    }
    if (emit) {
      this.emit();
    }
  }

  upsertBatch(songs = [], options = {}) {
    const markDirty = options.markDirty !== false;
    const emit = options.emit !== false;
    const list = Array.isArray(songs) ? songs : [];
    let changed = false;
    for (const song of list) {
      const applied = this.applyUpsert(song);
      if (applied) {
        changed = true;
      }
    }

    if (!changed) {
      return {
        changed: false,
        songs: this.getAll(),
      };
    }

    this.recentSnapshot = this.getAll();
    if (markDirty) {
      this.markDirtyAndSchedule();
    }
    if (emit) {
      this.emit();
    }

    return {
      changed: true,
      songs: this.recentSnapshot,
    };
  }

  removeBatch(ids = [], options = {}) {
    const markDirty = options.markDirty !== false;
    const emit = options.emit !== false;
    const normalizedIds = Array.isArray(ids)
      ? ids.map(id => safeString(id)).filter(Boolean)
      : [];
    if (normalizedIds.length === 0) {
      return {
        changed: false,
        songs: this.getAll(),
      };
    }

    let changed = false;
    for (const id of normalizedIds) {
      const existing = this.byId.get(id);
      if (!existing) {
        continue;
      }
      this.clearIndexesForSong(existing);
      this.byId.delete(id);
      changed = true;
    }

    if (!changed) {
      return {
        changed: false,
        songs: this.getAll(),
      };
    }

    this.recentSnapshot = this.getAll();
    if (markDirty) {
      this.markDirtyAndSchedule();
    }
    if (emit) {
      this.emit();
    }

    return {
      changed: true,
      songs: this.recentSnapshot,
    };
  }

  async flushNow(reason = 'manual') {
    this.clearFlushTimers();

    if (this.flushInFlight) {
      return this.flushInFlight;
    }

    if (!this.dirty) {
      return false;
    }

    const snapshot = this.getAll();
    const task = (async () => {
      try {
        await this.onFlush(snapshot, {reason});
        this.retryAttempt = 0;
        this.dirty = false;
        this.recentSnapshot = snapshot;
        return true;
      } catch (error) {
        this.retryAttempt += 1;
        this.dirty = true;
        try {
          this.onError(error, {
            reason,
            retryAttempt: this.retryAttempt,
          });
        } catch (listenerError) {
          // Ignore callback errors.
        }
        const backoffMs = Math.min(12000, 500 * this.retryAttempt);
        await sleep(backoffMs);
        this.scheduleFlush();
        return false;
      } finally {
        this.flushInFlight = null;
      }
    })();

    this.flushInFlight = task;
    return task;
  }
}

export default LibraryStore;
