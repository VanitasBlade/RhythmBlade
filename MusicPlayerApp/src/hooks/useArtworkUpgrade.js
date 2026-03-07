import {useCallback, useState} from 'react';

import {
  ensureSpotidownCover,
  isSpotidownArtworkUrl,
} from '../services/SpotidownArtworkService';
import {replaceMp3ApicPreserveFrames} from '../services/ArtworkEmbedService';
import storageService from '../services/storage/StorageService';
import {toFileUriFromPath} from '../services/storage/storage.helpers';

const LOG_PREFIX = '[useArtworkUpgrade]';

function log(message, context = null) {
  if (context === null || typeof context === 'undefined') {
    console.log(`${LOG_PREFIX} ${message}`);
    return;
  }
  console.log(`${LOG_PREFIX} ${message}`, context);
}

export default function useArtworkUpgrade() {
  const [artworkUpgradeStatus, setArtworkUpgradeStatus] = useState('idle');

  const upgradeArtwork = useCallback(
    async (songPath, artworkUrl, artist, title, options = {}) => {
      const normalizedSongPath = String(songPath || '').trim();
      const normalizedArtworkUrl = String(artworkUrl || '').trim();
      const normalizedArtist = String(artist || '').trim();
      const normalizedTitle = String(title || '').trim();
      const source = String(options?.source || '')
        .trim()
        .toLowerCase();

      if (!normalizedSongPath) {
        return {
          upgraded: false,
          reason: 'missing-song-path',
          songPath: null,
        };
      }

      if (!isSpotidownArtworkUrl(normalizedArtworkUrl)) {
        log('Skipping artwork upgrade because URL is not Spotidown artwork.', {
          artworkUrl: normalizedArtworkUrl || null,
          title: normalizedTitle || null,
          artist: normalizedArtist || null,
        });
        setArtworkUpgradeStatus('idle');
        return {
          upgraded: false,
          reason: 'non-spotidown-artwork-url',
          songPath: normalizedSongPath,
          artworkUrl: normalizedArtworkUrl || null,
        };
      }

      if (source && source !== 'spotdown') {
        log('Skipping artwork upgrade because source is not Spotdown.', {
          source,
          title: normalizedTitle || null,
          artist: normalizedArtist || null,
        });
        setArtworkUpgradeStatus('idle');
        return {
          upgraded: false,
          reason: 'non-spotdown-source',
          source,
          songPath: normalizedSongPath,
        };
      }

      try {
        setArtworkUpgradeStatus('downloading');
        const coverResult = await ensureSpotidownCover({
          artworkUrl: normalizedArtworkUrl,
          artist: normalizedArtist,
          title: normalizedTitle,
        });
        if (!coverResult?.ok || !coverResult?.coverPath) {
          setArtworkUpgradeStatus('done');
          return {
            upgraded: false,
            reason: coverResult?.reason || 'cover-unavailable',
            songPath: normalizedSongPath,
            artworkUrl: normalizedArtworkUrl,
            coverResult,
          };
        }

        setArtworkUpgradeStatus('embedding');
        const embedResult = await replaceMp3ApicPreserveFrames({
          songPath: normalizedSongPath,
          imagePath: coverResult.coverPath,
        });

        const coverUri = toFileUriFromPath(coverResult.coverPath);
        if (embedResult?.updated) {
          const fileName = normalizedSongPath.split('/').pop() || '';
          const persisted = await storageService
            .persistArtworkForSong(
              {
                title: normalizedTitle || null,
                artist: normalizedArtist || null,
                localPath: normalizedSongPath,
                url: toFileUriFromPath(normalizedSongPath),
                filename: fileName || null,
                sourceFilename: fileName || null,
                isLocal: true,
              },
              coverUri,
            )
            .catch(() => false);
          log('Persisted upgraded artwork URI to library.', {
            songPath: normalizedSongPath,
            persisted,
            coverUri,
          });
        }

        const result = {
          upgraded: Boolean(embedResult?.updated),
          reason:
            embedResult?.reason ||
            (embedResult?.updated ? null : 'embed-skipped'),
          songPath: normalizedSongPath,
          artworkUrl: normalizedArtworkUrl,
          coverPath: coverResult.coverPath,
          coverUri,
          coverResult,
          embedResult,
        };
        setArtworkUpgradeStatus('done');
        return result;
      } catch (error) {
        log('Artwork upgrade failed; falling back to normal download flow.', {
          songPath: normalizedSongPath || null,
          artworkUrl: normalizedArtworkUrl || null,
          error: error?.message || String(error),
        });
        setArtworkUpgradeStatus('error');
        return {
          upgraded: false,
          reason: error?.message || 'artwork-upgrade-failed',
          songPath: normalizedSongPath || null,
          artworkUrl: normalizedArtworkUrl || null,
        };
      }
    },
    [],
  );

  return {
    upgradeArtwork,
    artworkUpgradeStatus,
  };
}
