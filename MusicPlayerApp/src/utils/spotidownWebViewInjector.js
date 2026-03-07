function toSafeNumber(value, fallback = null) {
  return Number.isInteger(value) ? value : fallback;
}

export function buildSpotidownArtworkSnapshotScript(context = {}) {
  const payload = {
    jobId: String(context?.jobId || '').trim() || null,
    index: toSafeNumber(context?.index, null),
    title: String(context?.title || '').trim() || null,
    artist: String(context?.artist || '').trim() || null,
  };

  return `
    (function () {
      try {
        var ctx = ${JSON.stringify(payload)};
        var rn = window.ReactNativeWebView;
        if (!rn || typeof rn.postMessage !== 'function') {
          return true;
        }

        var toText = function (value) {
          if (typeof value === 'string') {
            return value.trim();
          }
          if (value === null || typeof value === 'undefined') {
            return '';
          }
          return String(value).trim();
        };

        var normalize = function (value) {
          var raw = toText(value);
          if (!raw) {
            return '';
          }
          try {
            return new URL(raw, window.location.origin).toString();
          } catch (_) {
            return raw;
          }
        };

        var normalizeKey = function (value) {
          return toText(value).toLowerCase();
        };

        var readTitle = function (node) {
          if (!node || !node.querySelector) {
            return '';
          }
          var titleNode = node.querySelector('.title');
          return toText((titleNode && (titleNode.innerText || titleNode.textContent)) || '');
        };

        var readArtist = function (node) {
          if (!node || !node.querySelector) {
            return '';
          }
          var artistNode = node.querySelector('.artist');
          return toText((artistNode && (artistNode.innerText || artistNode.textContent)) || '');
        };

        var readArtwork = function (node) {
          if (!node || !node.querySelector) {
            return '';
          }
          var img = node.querySelector('img[src]');
          return normalize((img && (img.getAttribute('src') || img.src)) || '');
        };

        var songs = Array.prototype.slice.call(
          document.querySelectorAll('.song-list .song'),
        );

        var selected = null;
        if (Number.isInteger(ctx.index) && songs[ctx.index]) {
          selected = songs[ctx.index];
        }

        if (!selected && (ctx.title || ctx.artist)) {
          var wantedTitle = normalizeKey(ctx.title || '');
          var wantedArtist = normalizeKey(ctx.artist || '');
          selected =
            songs.find(function (node) {
              var nodeTitle = normalizeKey(readTitle(node));
              var nodeArtist = normalizeKey(readArtist(node));
              if (wantedTitle && wantedArtist) {
                return nodeTitle === wantedTitle && nodeArtist === wantedArtist;
              }
              if (wantedTitle) {
                return nodeTitle === wantedTitle;
              }
              if (wantedArtist) {
                return nodeArtist === wantedArtist;
              }
              return false;
            }) || null;
        }

        if (!selected) {
          rn.postMessage(
            JSON.stringify({
              type: 'SPOTIDOWN_ARTWORK_SNAPSHOT',
              jobId: ctx.jobId || null,
              index: Number.isInteger(ctx.index) ? ctx.index : null,
              title: ctx.title || null,
              artist: ctx.artist || null,
              artworkUrl: null,
              timestamp: Date.now(),
              reason: 'song-row-not-found',
            }),
          );
          return true;
        }

        var snapshot = {
          type: 'SPOTIDOWN_ARTWORK_SNAPSHOT',
          jobId: ctx.jobId || null,
          index: Number.isInteger(ctx.index) ? ctx.index : songs.indexOf(selected),
          title: readTitle(selected) || ctx.title || null,
          artist: readArtist(selected) || ctx.artist || null,
          artworkUrl: readArtwork(selected) || null,
          timestamp: Date.now(),
        };

        rn.postMessage(JSON.stringify(snapshot));
      } catch (error) {
        try {
          var bridge = window.ReactNativeWebView;
          if (bridge && typeof bridge.postMessage === 'function') {
            bridge.postMessage(
              JSON.stringify({
                type: 'SPOTIDOWN_ARTWORK_SNAPSHOT',
                artworkUrl: null,
                reason: String((error && error.message) || error || 'snapshot-failed'),
                timestamp: Date.now(),
              }),
            );
          }
        } catch (_) {}
      }
      return true;
    })();
    true;
  `;
}

export default buildSpotidownArtworkSnapshotScript;
