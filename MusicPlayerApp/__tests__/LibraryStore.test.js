import LibraryStore from '../src/services/storage/LibraryStore';

function buildSong(id, overrides = {}) {
  return {
    id,
    title: `Song ${id}`,
    mediaStoreId: '',
    localPath: `/music/${id}.mp3`,
    ...overrides,
  };
}

describe('LibraryStore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('collapses rapid upserts into one flush write', async () => {
    const onFlush = jest.fn(async () => {});
    const store = new LibraryStore({
      flushDebounceMs: 50,
      flushMaxWaitMs: 200,
      onFlush,
      getMediaStoreId: song => String(song?.mediaStoreId || '').trim(),
      getPathKey: song => String(song?.localPath || '').trim().toLowerCase(),
      getContentUri: song => String(song?.contentUri || song?.url || '').trim(),
    });

    store.upsertBatch([buildSong('1')]);
    store.upsertBatch([buildSong('2')]);
    store.upsertBatch([buildSong('3')]);

    expect(onFlush).toHaveBeenCalledTimes(0);
    jest.advanceTimersByTime(55);
    await Promise.resolve();
    await Promise.resolve();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(store.hasPendingFlush()).toBe(false);
  });

  test('secondary indexes stay correct on update and remove', () => {
    const store = new LibraryStore({
      flushDebounceMs: 1000,
      flushMaxWaitMs: 2000,
      onFlush: async () => {},
      getMediaStoreId: song => String(song?.mediaStoreId || '').trim(),
      getPathKey: song => String(song?.localPath || '').trim().toLowerCase(),
      getContentUri: song => String(song?.contentUri || song?.url || '').trim(),
    });

    store.upsertBatch([
      buildSong('a', {
        mediaStoreId: '101',
        localPath: '/music/a.mp3',
        contentUri: 'content://media/a',
      }),
      buildSong('b', {
        mediaStoreId: '102',
        localPath: '/music/b.mp3',
      }),
    ], {markDirty: false});

    expect(store.getById('a')?.id).toBe('a');
    expect(store.getByMediaStoreId('101')?.id).toBe('a');
    expect(store.getByPathKey('/music/a.mp3')?.id).toBe('a');
    expect(store.getByContentUri('content://media/a')?.id).toBe('a');

    store.upsertBatch([
      buildSong('a', {
        mediaStoreId: '999',
        localPath: '/music/new-a.mp3',
        contentUri: 'content://media/new-a',
      }),
    ], {markDirty: false});

    expect(store.getByMediaStoreId('101')).toBeNull();
    expect(store.getByPathKey('/music/a.mp3')).toBeNull();
    expect(store.getByContentUri('content://media/a')).toBeNull();
    expect(store.getByMediaStoreId('999')?.id).toBe('a');
    expect(store.getByPathKey('/music/new-a.mp3')?.id).toBe('a');
    expect(store.getByContentUri('content://media/new-a')?.id).toBe('a');

    store.removeBatch(['a'], {markDirty: false});
    expect(store.getById('a')).toBeNull();
    expect(store.getByMediaStoreId('999')).toBeNull();
    expect(store.getByPathKey('/music/new-a.mp3')).toBeNull();
  });
});
