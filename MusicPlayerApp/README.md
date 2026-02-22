# MusicPlayerApp

This README documents the current explicit-file structure (no `index.js` entry files inside `src/screens` or `src/services`).

## Project Structure

```text
MusicPlayerApp/
  App.js
  index.js
  src/
    components/
      MiniPlayer.js
    screens/
      home/
        HomeScreen.js
        home.styles.js
      library/
        LibraryScreen.js
        library.styles.js
        library.constants.js
        library.utils.js
      nowPlaying/
        NowPlayingScreen.js
        nowPlaying.styles.js
      playlistDetail/
        PlaylistDetailScreen.js
        playlistDetail.styles.js
      playlists/
        PlaylistsScreen.js
        playlists.styles.js
      search/
        SearchScreen.js
        search.styles.js
        search.constants.js
        search.utils.js
        components/
          SearchResultCard.js
          QueueItemCard.js
      settings/
        SettingsScreen.js
        settings.styles.js
    services/
      api/
        ApiService.js
      artwork/
        ArtworkService.js
      network/
        NetworkService.js
      playback/
        PlaybackService.js
      storage/
        StorageService.js
        storage.constants.js
        storage.helpers.js
        modules/
          artwork.methods.js
          filesystem.methods.js
          library.methods.js
          playlist.methods.js
          settings.methods.js
    theme/
      musicHomeTheme.js
```

## Folder Responsibilities

### `App.js`
- App bootstrap and navigation setup.
- Imports screen files directly (no screen barrel).

### `src/screens/`
- Feature-first screen organization.
- Each screen folder contains:
  - `*Screen.js` (screen component)
  - `*.styles.js` (screen-local styles)
  - optional `*.constants.js` and `*.utils.js`

### `src/services/`
- Domain-first service organization.
- Explicit entry files:
  - `ApiService.js`
  - `ArtworkService.js`
  - `NetworkService.js`
  - `PlaybackService.js`
  - `StorageService.js`
- Storage is intentionally modularized under `storage/modules/*`.

### `src/components/`
- Reusable shared UI components.

### `src/theme/`
- App theme tokens and color palette.

## Screen Routing Map

- `home/HomeScreen.js` -> Home tab
- `library/LibraryScreen.js` -> Library tab
- `search/SearchScreen.js` -> Downloader tab
- `settings/SettingsScreen.js` -> Settings tab
- `nowPlaying/NowPlayingScreen.js` -> Stack modal screen
- `playlistDetail/PlaylistDetailScreen.js` -> Stack detail screen

## Conventions

1. Do not add `index.js` entry files under `src/screens` or `src/services`.
2. Use explicit filenames for discoverability (`HomeScreen.js`, `ApiService.js`).
3. Keep styles/constants/utils next to their owning feature.
4. Put shared UI in `src/components` and shared domain logic in `src/services`.
