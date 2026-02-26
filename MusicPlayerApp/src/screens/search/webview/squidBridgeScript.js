const SQUID_BRIDGE_SCRIPT = String.raw`
(function () {
  if (window.__RB_SQUID_BRIDGE__) {
    return;
  }
  window.__RB_SQUID_BRIDGE__ = true;

  var BASE_URL = "https://tidal.squid.wtf/";
  var RESP = "bridge-response";
  var READY = "bridge-ready";
  var CHUNK = "bridge-download-chunk";
  var captures = [];
  var blobArtifacts = [];
  var maxBlobArtifacts = 24;

  function send(payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    } catch (_) {}
  }

  function blog(message, extra) {
    send({
      type: "bridge-log",
      message: message || "bridge-log",
      extra: extra || null,
    });
  }

  function norm(v) {
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function lower(v) {
    return norm(v).toLowerCase();
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function visible(el) {
    if (!el) return false;
    if (el.offsetParent === null && window.getComputedStyle(el).position !== "fixed") {
      return false;
    }
    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  async function waitFor(fn, timeoutMs, stepMs) {
    var timeout = Number(timeoutMs) || 0;
    var step = Number(stepMs) || 140;
    var started = Date.now();
    while (Date.now() - started < timeout) {
      try {
        var out = fn();
        if (out) return out;
      } catch (_) {}
      await sleep(step);
    }
    return null;
  }

  function trackId(v) {
    var text = norm(v);
    var match =
      text.match(/\/track\/(\d+)/i) ||
      text.match(/\/tracks\/(\d+)/i) ||
      text.match(/^(\d+)$/);
    return (match && match[1]) || "";
  }

  function parseDur(v) {
    var match = String(v || "").match(/\b(\d{1,2}):(\d{2})\b/);
    return match ? parseInt(match[1], 10) * 60 + parseInt(match[2], 10) : 0;
  }

  function isLikelyMediaUrl(url) {
    var text = String(url || "").toLowerCase();
    return (
      /\.(mp4|m4a|mp3|flac|aac|wav|ogg|opus)(\?|$)/.test(text) ||
      (text.indexOf("token=") >= 0 && text.indexOf("/api/") < 0)
    );
  }

  function toInt(v) {
    var parsed = parseInt(String(v || "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeHeaderMap(headersLike) {
    var out = {};
    if (!headersLike) return out;

    if (typeof headersLike.forEach === "function") {
      headersLike.forEach(function (value, key) {
        var k = lower(key);
        if (!k) return;
        out[k] = norm(value);
      });
      return out;
    }

    if (typeof headersLike === "object") {
      var keys = Object.keys(headersLike);
      for (var i = 0; i < keys.length; i += 1) {
        var key = lower(keys[i]);
        if (!key) continue;
        out[key] = norm(headersLike[keys[i]]);
      }
    }
    return out;
  }

  function parseRawResponseHeaders(raw) {
    var out = {};
    var text = String(raw || "");
    if (!text) return out;
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      var idx = line.indexOf(":");
      if (idx <= 0) continue;
      var key = lower(line.slice(0, idx));
      var value = norm(line.slice(idx + 1));
      if (!key) continue;
      out[key] = value;
    }
    return out;
  }

  function toHeaderMapForFetch(req, init) {
    var out = {};
    var reqHeaders = req && req.headers ? normalizeHeaderMap(req.headers) : {};
    var initHeaders = init && init.headers ? normalizeHeaderMap(init.headers) : {};
    var reqKeys = Object.keys(reqHeaders);
    for (var i = 0; i < reqKeys.length; i += 1) {
      out[reqKeys[i]] = reqHeaders[reqKeys[i]];
    }
    var initKeys = Object.keys(initHeaders);
    for (var j = 0; j < initKeys.length; j += 1) {
      out[initKeys[j]] = initHeaders[initKeys[j]];
    }
    return out;
  }

  function isAudioMime(mimeType) {
    var text = lower(mimeType);
    return (
      text.indexOf("audio/") === 0 ||
      text.indexOf("flac") >= 0 ||
      text.indexOf("mpeg") >= 0 ||
      text.indexOf("mp4") >= 0
    );
  }

  function isAudioFilename(name) {
    return /\.(flac|mp3|m4a|aac|wav|ogg)(\?.*)?$/i.test(String(name || ""));
  }

  function toBase64FromBytes(bytes) {
    var chunkSize = 0x8000;
    var binary = "";
    for (var i = 0; i < bytes.length; i += chunkSize) {
      var segment = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, segment);
    }
    return btoa(binary);
  }

  function trimBlobArtifacts() {
    if (blobArtifacts.length <= maxBlobArtifacts) return;
    blobArtifacts = blobArtifacts
      .slice(blobArtifacts.length - maxBlobArtifacts)
      .filter(function (item) {
        return item && item.blob && item.blob.size > 0;
      });
  }

  function findBlobArtifactByUrl(url) {
    var target = String(url || "");
    for (var i = blobArtifacts.length - 1; i >= 0; i -= 1) {
      if (blobArtifacts[i] && blobArtifacts[i].url === target) {
        return blobArtifacts[i];
      }
    }
    return null;
  }

  function upsertBlobArtifact(item) {
    if (!item || !item.url || !item.blob) return;
    var existing = findBlobArtifactByUrl(item.url);
    if (existing) {
      if (item.filename) existing.filename = item.filename;
      if (item.clickedAt) existing.clickedAt = item.clickedAt;
      if (item.revokedAt) existing.revokedAt = item.revokedAt;
      return;
    }
    blobArtifacts.push(item);
    trimBlobArtifacts();
  }

  function bestBlobArtifact(startTs) {
    var best = null;
    for (var i = 0; i < blobArtifacts.length; i += 1) {
      var item = blobArtifacts[i];
      if (!item || !item.blob) continue;
      var ts = Number(item.clickedAt || item.createdAt) || 0;
      if (ts < startTs) continue;
      if (!item.filename && !isAudioMime(item.type || "")) continue;
      if (item.blob.size <= 0) continue;
      if (!best || item.blob.size > best.blob.size || ts > (best.clickedAt || best.createdAt)) {
        best = item;
      }
    }
    return best;
  }

  async function emitBlobChunks(commandId, artifact) {
    if (!artifact || !artifact.blob || !commandId) {
      throw new Error("Invalid blob artifact for chunk emit.");
    }

    var filename = norm(artifact.filename);
    if (!filename || !isAudioFilename(filename)) {
      var fallbackExt = "m4a";
      if (isAudioMime(artifact.type) && lower(artifact.type).indexOf("flac") >= 0) {
        fallbackExt = "flac";
      } else if (isAudioMime(artifact.type) && lower(artifact.type).indexOf("mpeg") >= 0) {
        fallbackExt = "mp3";
      }
      filename = "track." + fallbackExt;
    }

    var arrayBuffer = await artifact.blob.arrayBuffer();
    var bytes = new Uint8Array(arrayBuffer);
    var totalBytes = bytes.length;
    var chunkBytes = 128 * 1024;
    var chunkCount = Math.max(1, Math.ceil(totalBytes / chunkBytes));
    var mimeType = norm(artifact.type || artifact.blob.type || "audio/mp4");

    blog("Sending processed blob chunks to RN", {
      commandId: commandId,
      filename: filename,
      mimeType: mimeType,
      totalBytes: totalBytes,
      chunkCount: chunkCount,
    });

    for (var i = 0; i < chunkCount; i += 1) {
      var start = i * chunkBytes;
      var end = Math.min(totalBytes, start + chunkBytes);
      var chunk = bytes.subarray(start, end);
      var base64 = toBase64FromBytes(chunk);
      send({
        type: CHUNK,
        id: commandId,
        seq: i,
        total: chunkCount,
        totalBytes: totalBytes,
        mimeType: mimeType,
        filename: filename,
        data: base64,
      });

      if ((i + 1) % 6 === 0) {
        await sleep(0);
      }
    }

    return {
      delivery: "bridge-chunks",
      chunkCount: chunkCount,
      totalBytes: totalBytes,
      filename: filename,
      mimeType: mimeType,
    };
  }

  function capture(evt) {
    if (!evt) return;
    if (!evt.force && !isLikelyMediaUrl(evt.url)) return;
    var headers = normalizeHeaderMap(evt.headers);
    var contentType = norm(evt.contentType || headers["content-type"]);
    var contentLength =
      Number(evt.contentLength) || toInt(headers["content-length"]) || 0;
    var next = {
      url: evt.url,
      method: evt.method || "GET",
      contentType: contentType,
      contentLength: contentLength || 0,
      status: Number(evt.status) || 0,
      source: evt.source || "",
      headers: headers,
      requestHeaders: normalizeHeaderMap(evt.requestHeaders),
      referer: norm(evt.referer || window.location.href) || BASE_URL,
      userAgent: norm(evt.userAgent || navigator.userAgent),
      ts: Date.now(),
    };
    captures.push(next);
    if (captures.length > 180) captures.shift();
  }

  function installCapture() {
    if (window.__RB_CAPTURE_INSTALLED__) return;
    window.__RB_CAPTURE_INSTALLED__ = true;

    var originalCreateObjectURL =
      window.URL && window.URL.createObjectURL
        ? window.URL.createObjectURL.bind(window.URL)
        : null;
    if (originalCreateObjectURL) {
      window.URL.createObjectURL = function (obj) {
        var blobUrl = originalCreateObjectURL(obj);
        try {
          if (
            obj &&
            typeof obj.size === "number" &&
            obj.size > 0 &&
            (isAudioMime(obj.type) || obj.size >= 1024 * 1024)
          ) {
            upsertBlobArtifact({
              url: blobUrl,
              blob: obj,
              type: norm(obj.type || ""),
              size: Number(obj.size) || 0,
              filename: "",
              createdAt: Date.now(),
              clickedAt: 0,
              revokedAt: 0,
            });
            capture({
              url: blobUrl,
              method: "GET",
              contentType: obj.type || "",
              contentLength: Number(obj.size) || 0,
              status: 200,
              source: "blob-object-url",
              headers: {"content-type": obj.type || ""},
              force: true,
            });
          }
        } catch (_) {}
        return blobUrl;
      };
    }

    var originalRevokeObjectURL =
      window.URL && window.URL.revokeObjectURL
        ? window.URL.revokeObjectURL.bind(window.URL)
        : null;
    if (originalRevokeObjectURL) {
      window.URL.revokeObjectURL = function (url) {
        try {
          var existing = findBlobArtifactByUrl(url);
          if (existing) {
            existing.revokedAt = Date.now();
          }
        } catch (_) {}
        return originalRevokeObjectURL(url);
      };
    }

    var originalAnchorClick =
      window.HTMLAnchorElement &&
      window.HTMLAnchorElement.prototype &&
      window.HTMLAnchorElement.prototype.click
        ? window.HTMLAnchorElement.prototype.click
        : null;
    if (originalAnchorClick) {
      window.HTMLAnchorElement.prototype.click = function () {
        try {
          var href = norm(this && this.getAttribute && this.getAttribute("href")) ||
            norm(this && this.href);
          var downloadName =
            norm(this && this.getAttribute && this.getAttribute("download")) ||
            norm(this && this.download);
          if (href && href.indexOf("blob:") === 0) {
            var artifact = findBlobArtifactByUrl(href);
            if (artifact) {
              artifact.filename = downloadName || artifact.filename || "";
              artifact.clickedAt = Date.now();
              capture({
                url: href,
                method: "GET",
                contentType: artifact.type || "",
                contentLength: Number(artifact.size) || 0,
                status: 200,
                source: "blob-anchor-click",
                headers: {"content-type": artifact.type || ""},
                force: true,
              });
              blog("Captured blob anchor download", {
                filename: artifact.filename || null,
                size: artifact.size || 0,
                type: artifact.type || null,
              });
            }
          }
        } catch (_) {}
        return originalAnchorClick.apply(this, arguments);
      };
    }

    var originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function () {
        var req = arguments[0];
        var init = arguments[1];
        var requestUrl = typeof req === "string" ? req : req && req.url;
        var requestHeaders = toHeaderMapForFetch(req, init);
        if (isLikelyMediaUrl(requestUrl)) {
          capture({
            url: requestUrl,
            method: (init && init.method) || (req && req.method),
            source: "fetch-request",
            requestHeaders: requestHeaders,
            headers: requestHeaders,
          });
        }
        return originalFetch.apply(window, arguments).then(function (res) {
          if (!res) return res;
          var ct = "";
          var headers = {};
          try {
            ct = res.headers.get("content-type") || "";
            headers = normalizeHeaderMap(res.headers);
          } catch (_) {}
          var resUrl = res.url || requestUrl;
          if (isLikelyMediaUrl(resUrl) || /^audio\//i.test(ct)) {
            capture({
              url: resUrl,
              method: (init && init.method) || (req && req.method) || "GET",
              contentType: ct,
              contentLength: toInt(headers["content-length"]),
              status: Number(res.status) || 0,
              headers: headers,
              requestHeaders: requestHeaders,
              source: "fetch-response",
            });
          }
          return res;
        });
      };
    }

    var xOpen = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
    var xSend = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;
    var xSetHeader =
      window.XMLHttpRequest && window.XMLHttpRequest.prototype.setRequestHeader;
    if (xOpen && xSend) {
      window.XMLHttpRequest.prototype.open = function (method, url) {
        this.__rb_method = method;
        this.__rb_url = url;
        this.__rb_headers = {};
        return xOpen.apply(this, arguments);
      };

      if (xSetHeader) {
        window.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
          if (!this.__rb_headers) this.__rb_headers = {};
          var key = lower(name);
          if (key) {
            this.__rb_headers[key] = norm(value);
          }
          return xSetHeader.apply(this, arguments);
        };
      }

      window.XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        var scan = function () {
          var url = xhr.responseURL || xhr.__rb_url;
          var ct = "";
          var headers = {};
          try {
            ct = xhr.getResponseHeader("content-type") || "";
            headers = parseRawResponseHeaders(xhr.getAllResponseHeaders());
          } catch (_) {}
          if (isLikelyMediaUrl(url) || /^audio\//i.test(ct)) {
            capture({
              url: url,
              method: xhr.__rb_method,
              contentType: ct,
              contentLength:
                toInt(headers["content-length"]) || toInt(xhr.getResponseHeader("content-length")),
              status: Number(xhr.status) || 0,
              headers: headers,
              requestHeaders: xhr.__rb_headers || {},
              source: "xhr-response",
            });
          }
        };
        xhr.addEventListener("load", scan);
        xhr.addEventListener("readystatechange", function () {
          if (xhr.readyState === 2) scan();
        });
        return xSend.apply(this, arguments);
      };
    }
  }

  function inputNode() {
    var selectors = [
      'input[placeholder*="Search"]',
      'input[aria-label*="Search"]',
      'input[type="search"]',
      'input[type="text"]',
    ];
    for (var i = 0; i < selectors.length; i += 1) {
      var nodes = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < nodes.length; j += 1) {
        if (visible(nodes[j])) return nodes[j];
      }
    }
    return null;
  }

  async function ensureInput() {
    var input = inputNode();
    if (input) return input;

    if (window.location.href !== BASE_URL) {
      window.location.href = BASE_URL;
    }

    input = await waitFor(inputNode, 20000, 180);
    if (!input) {
      throw new Error("Search input not available.");
    }
    return input;
  }

  function setInput(el, value) {
    var next = String(value || "");
    var descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    );
    if (descriptor && descriptor.set) descriptor.set.call(el, next);
    else el.value = next;
    el.dispatchEvent(new Event("input", {bubbles: true}));
    el.dispatchEvent(new Event("change", {bubbles: true}));
  }

  function buttonLabel(btn) {
    return lower(
      ((btn && btn.textContent) || "") +
      " " +
      ((btn && btn.getAttribute("aria-label")) || "") +
      " " +
      ((btn && btn.getAttribute("title")) || "")
    );
  }

  function findTabButton(type) {
    var target = lower(type || "tracks");
    var buttons = Array.prototype.slice.call(document.querySelectorAll("button"));

    for (var i = 0; i < buttons.length; i += 1) {
      if (!visible(buttons[i])) continue;
      var text = buttonLabel(buttons[i]);
      if (!text) continue;
      if (text === target) return buttons[i];
    }

    for (var j = 0; j < buttons.length; j += 1) {
      if (!visible(buttons[j])) continue;
      var t = buttonLabel(buttons[j]);
      if (!t) continue;
      if (t.indexOf(target) >= 0 && t.length <= 28) return buttons[j];
    }

    return null;
  }

  async function switchTab(type) {
    var button = findTabButton(type);
    if (!button) {
      blog("Tab not found", {type: type});
      return false;
    }
    button.click();
    await sleep(220);
    blog("Tab switched", {type: type});
    return true;
  }

  function findSearchButton(input) {
    var buttons = Array.prototype.slice.call(document.querySelectorAll("button"));
    var inputRect = input && input.getBoundingClientRect ? input.getBoundingClientRect() : null;
    var best = null;
    var bestScore = -1;

    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      if (!visible(btn)) continue;
      var label = buttonLabel(btn);
      if (!label || label.indexOf("search") < 0) continue;

      var score = 10;
      if (inputRect && btn.getBoundingClientRect) {
        var rect = btn.getBoundingClientRect();
        var dx = Math.abs(rect.left - inputRect.right);
        var dy = Math.abs(rect.top - inputRect.top);
        score = 100 - Math.min(95, dx + dy);
      }

      if (score > bestScore) {
        bestScore = score;
        best = btn;
      }
    }

    return best;
  }

  function isCancelDownloadLabel(label) {
    var text = lower(label);
    if (!text) return false;
    return (
      text.indexOf("cancel download") >= 0 ||
      text.indexOf("cancelling download") >= 0 ||
      text.indexOf("stop download") >= 0
    );
  }

  function isDownloadButton(btn) {
    if (!btn || !visible(btn)) return false;
    var label = buttonLabel(btn);
    if (isCancelDownloadLabel(label)) return false;
    if (label.indexOf("download") >= 0) return true;
    var html = lower(btn.innerHTML || "");
    if (html.indexOf("lucide-download") >= 0) return true;
    return false;
  }

  function getDownloadButtons() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll("button"));
    var out = [];
    for (var i = 0; i < buttons.length; i += 1) {
      if (isDownloadButton(buttons[i])) out.push(buttons[i]);
    }
    return out;
  }

  function getTrackLinks() {
    return Array.prototype.slice.call(
      document.querySelectorAll('a[href*="/track/"],a[href*="/tracks/"]')
    );
  }

  function likelyNoResults() {
    var text = lower(document.body && document.body.textContent);
    return (
      text.indexOf("no results") >= 0 ||
      text.indexOf("no tracks") >= 0 ||
      text.indexOf("nothing found") >= 0
    );
  }

  function cardFromButton(btn) {
    return (
      btn &&
      (
        btn.closest('[role="button"]') ||
        btn.closest(".track-row") ||
        btn.closest('[class*="track-row"]') ||
        btn.closest("li") ||
        btn.parentElement
      )
    );
  }

  function extractTextLines(node) {
    if (!node) return [];
    var lines = Array.prototype.slice
      .call(node.querySelectorAll("p,span,div,h1,h2,h3"))
      .map(function (x) { return norm(x.textContent); })
      .filter(Boolean);
    var unique = [];
    var seen = {};
    for (var i = 0; i < lines.length; i += 1) {
      var key = lower(lines[i]);
      if (seen[key]) continue;
      seen[key] = true;
      unique.push(lines[i]);
    }
    return unique;
  }

  function splitBulletText(text) {
    return norm(text)
      .split(/(?:\u2022|\u00e2\u20ac\u00a2|\u00c3\u00a2\u00e2\u201a\u00ac\u00c2\u00a2)/)
      .map(function (part) { return norm(part); })
      .filter(Boolean);
  }

  function containsBulletToken(text) {
    var value = String(text || "");
    return (
      value.indexOf("\u2022") >= 0 ||
      value.indexOf("\u00e2\u20ac\u00a2") >= 0 ||
      value.indexOf("\u00c3\u00a2\u00e2\u201a\u00ac\u00c2\u00a2") >= 0
    );
  }

  function stripLeadingTitle(value, title) {
    var source = norm(value);
    var target = norm(title);
    if (!source || !target) return source;
    var sourceLower = lower(source);
    var targetLower = lower(target);
    if (sourceLower === targetLower) return "";
    if (sourceLower.indexOf(targetLower + " ") === 0) {
      return norm(source.slice(target.length));
    }
    return source;
  }
  function parseTrack(btn, index) {
    var card = cardFromButton(btn);
    if (!card) return null;

    var aria = norm(btn.getAttribute("aria-label"));
    var titleAttr = norm(btn.getAttribute("title"));
    var fromButton = aria
      .replace(/^Cancel\s+download\s+for\s+/i, "")
      .replace(/^Download\s+/i, "")
      .trim();
    if (isCancelDownloadLabel(aria)) {
      fromButton = "";
    }
    if (lower(fromButton) === "track" || lower(fromButton) === "download") {
      fromButton = "";
    }
    if (!fromButton && lower(titleAttr).indexOf("download") === 0) {
      fromButton = "";
    }

    var heading = card.querySelector("h3,h2,h1,[class*='title']");
    var title = norm(fromButton || (heading && heading.textContent));
    if (!title) return null;

    var lines = extractTextLines(card);
    var meta = "";
    var artist = "";
    for (var i = 0; i < lines.length; i += 1) {
      var hasBullet = containsBulletToken(lines[i]);
      if (!meta && (hasBullet || /(\d{1,2}):(\d{2})/.test(lines[i]))) {
        meta = lines[i];
      }
      if (
        !artist &&
        lines[i] !== title &&
        !/(\d{1,2}):(\d{2})/.test(lines[i]) &&
        !hasBullet
      ) {
        artist = lines[i];
      }
      if (meta && artist) break;
    }

    if (!artist && meta) {
      var metaLead = splitBulletText(meta)[0] || "";
      artist = stripLeadingTitle(metaLead, title);
    }
    artist = norm(artist || "Unknown");
    if (!artist) {
      artist = "Unknown";
    }

    var album = "";
    var metaParts = splitBulletText(meta);
    if (metaParts.length > 0) {
      album = stripLeadingTitle(metaParts[0], title);
      if (album && artist && lower(album).indexOf(lower(artist)) === 0) {
        var trimmedAlbum = norm(album.slice(artist.length));
        album = trimmedAlbum || album;
      }
    }

    var duration = 0;
    for (var j = 0; j < lines.length; j += 1) {
      duration = parseDur(lines[j]);
      if (duration > 0) break;
    }

    var img = card.querySelector("img");
    var trackAnchor = card.querySelector('a[href*="/track/"],a[href*="/tracks/"]');
    var url = norm(trackAnchor && trackAnchor.getAttribute("href"));

    return {
      index: index,
      type: "track",
      title: title,
      artist: artist || "Unknown",
      album: album || "",
      subtitle: meta || artist || "",
      duration: duration || 0,
      artwork: norm(img && img.getAttribute("src")) || null,
      url: url || null,
      tidalId: trackId(url) || null,
      downloadable: true,
    };
  }

  function parseTrackFromLink(link, index) {
    if (!link) return null;
    var card =
      link.closest('[role="button"]') ||
      link.closest("li") ||
      link.parentElement;
    if (!card) return null;

    var heading = card.querySelector("h3,h2,h1,[class*='title']");
    var title = norm((heading && heading.textContent) || link.textContent);
    if (!title) return null;

    var artist = norm(
      (card.querySelector("p,[class*='artist'],span") || {}).textContent
    ) || "Unknown";
    var img = card.querySelector("img");
    var url = norm(link.getAttribute("href"));

    return {
      index: index,
      type: "track",
      title: title,
      artist: artist,
      album: "",
      subtitle: artist,
      duration: 0,
      artwork: norm(img && img.getAttribute("src")) || null,
      url: url || null,
      tidalId: trackId(url) || null,
      downloadable: false,
    };
  }

  function parseResults(type) {
    var out = [];
    var mode = lower(type || "tracks");
    var buttons = getDownloadButtons();

    for (var i = 0; i < buttons.length && out.length < 80; i += 1) {
      var parsed = parseTrack(buttons[i], out.length);
      if (!parsed) continue;

      if (mode.indexOf("album") === 0) {
        var card = cardFromButton(buttons[i]);
        var albumAnchor = card && card.querySelector('a[href*="/album/"]');
        var href = norm(albumAnchor && albumAnchor.getAttribute("href"));
        if (!href) continue;
        out.push({
          index: out.length,
          type: "album",
          title: parsed.title,
          artist: parsed.artist,
          album: parsed.title,
          subtitle: parsed.subtitle,
          duration: 0,
          artwork: parsed.artwork,
          url: href,
          tidalId: null,
          downloadable: true,
        });
      } else {
        out.push(parsed);
      }
    }

    if (out.length > 0) return out;

    var links = getTrackLinks();
    for (var j = 0; j < links.length && out.length < 80; j += 1) {
      var fallback = parseTrackFromLink(links[j], out.length);
      if (fallback) out.push(fallback);
    }
    return out;
  }

  function resultIdentity(item) {
    if (!item) return "";
    return [
      lower(item.type || ""),
      lower(item.title || ""),
      lower(item.artist || ""),
      lower(item.album || ""),
      String(Number(item.duration) || 0),
      lower(item.url || ""),
    ].join("|");
  }

  function mergeUniqueResults(current, incoming) {
    var out = Array.isArray(current) ? current.slice() : [];
    var seen = {};
    for (var i = 0; i < out.length; i += 1) {
      seen[resultIdentity(out[i])] = true;
    }

    var next = Array.isArray(incoming) ? incoming : [];
    for (var j = 0; j < next.length; j += 1) {
      var key = resultIdentity(next[j]);
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(next[j]);
    }

    for (var k = 0; k < out.length; k += 1) {
      out[k].index = k;
    }
    return out;
  }

  function isScrollableElement(el) {
    if (!el || !el.scrollHeight || !el.clientHeight) return false;
    if (el.scrollHeight <= el.clientHeight + 10) return false;
    var style = window.getComputedStyle(el);
    var overflowY = lower(style && (style.overflowY || style.overflow));
    return (
      overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "overlay"
    );
  }

  function findNearestScrollable(node) {
    var current = node;
    while (current && current !== document.body && current !== document.documentElement) {
      if (isScrollableElement(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function findResultsScrollTarget() {
    var seed = getDownloadButtons()[0] || getTrackLinks()[0] || null;
    var nested = findNearestScrollable(seed);
    if (nested) {
      return nested;
    }

    var pageScrollable =
      (document.documentElement.scrollHeight || 0) > (window.innerHeight || 0) + 10;
    return pageScrollable ? window : null;
  }

  function scrollTargetStep(target) {
    if (!target) return false;

    if (target === window) {
      var currentWinTop =
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0;
      var maxWinTop = Math.max(
        0,
        (document.documentElement.scrollHeight || 0) - (window.innerHeight || 0)
      );
      var nextWinTop = Math.min(
        maxWinTop,
        currentWinTop + Math.max(260, Math.floor((window.innerHeight || 720) * 0.9))
      );
      if (nextWinTop <= currentWinTop + 1) {
        return false;
      }
      window.scrollTo(0, nextWinTop);
      return true;
    }

    var currentTop = target.scrollTop || 0;
    var maxTop = Math.max(0, (target.scrollHeight || 0) - (target.clientHeight || 0));
    var nextTop = Math.min(
      maxTop,
      currentTop + Math.max(220, Math.floor((target.clientHeight || 480) * 0.9))
    );
    if (nextTop <= currentTop + 1) {
      return false;
    }
    target.scrollTop = nextTop;
    return true;
  }

  function resetScrollTarget(target) {
    if (!target) return;
    if (target === window) {
      window.scrollTo(0, 0);
      return;
    }
    target.scrollTop = 0;
  }

  async function collectResultsWithScroll(type, initialItems) {
    var mode = type || "tracks";
    var merged = mergeUniqueResults([], initialItems);
    var target = findResultsScrollTarget();
    if (!target) {
      return merged;
    }

    var previousCount = merged.length;
    var stagnantPasses = 0;

    for (var pass = 0; pass < 20 && stagnantPasses < 4 && merged.length < 80; pass += 1) {
      var moved = scrollTargetStep(target);
      if (!moved) {
        break;
      }

      await sleep(220);
      await switchTab(mode);
      var parsed = parseResults(mode);
      merged = mergeUniqueResults(merged, parsed);

      if (merged.length > previousCount) {
        previousCount = merged.length;
        stagnantPasses = 0;
      } else {
        stagnantPasses += 1;
      }
    }

    resetScrollTarget(target);
    return merged;
  }

  async function runSearch(q, type) {
    var query = norm(q);
    if (!query) return [];
    var mode = type || "tracks";

    var input = await ensureInput();
    await switchTab(mode);

    setInput(input, "");
    await sleep(80);
    setInput(input, query);

    var button = findSearchButton(input);
    if (button) {
      button.click();
      blog("Search triggered by button", {query: query, type: mode});
      await sleep(110);
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
      input.dispatchEvent(new KeyboardEvent("keyup", {key: "Enter", bubbles: true}));
    } else {
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
      input.dispatchEvent(new KeyboardEvent("keyup", {key: "Enter", bubbles: true}));
      if (input.form && typeof input.form.requestSubmit === "function") {
        input.form.requestSubmit();
      }
      blog("Search triggered by Enter fallback", {query: query, type: mode});
    }

    await switchTab(mode);
    await waitFor(function () {
      return (
        getDownloadButtons().length > 0 ||
        getTrackLinks().length > 0 ||
        likelyNoResults()
      );
    }, 12000, 180);

    await sleep(lower(mode).indexOf("album") === 0 ? 850 : 520);

    var parsed = parseResults(mode);
    if (
      parsed.length === 0 &&
      !likelyNoResults()
    ) {
      blog("Search retry triggered", {query: query, type: mode});
      setInput(input, query);
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
      input.dispatchEvent(new KeyboardEvent("keyup", {key: "Enter", bubbles: true}));
      await switchTab(mode);
      await waitFor(function () {
        return (
          getDownloadButtons().length > 0 ||
          getTrackLinks().length > 0 ||
          likelyNoResults()
        );
      }, 8000, 180);
      await sleep(420);
      parsed = parseResults(mode);
    }
    parsed = await collectResultsWithScroll(mode, parsed);
    blog("Search parse summary", {
      query: query,
      type: mode,
      parsedCount: parsed.length,
      downloadButtons: getDownloadButtons().length,
      trackLinks: getTrackLinks().length,
      noResultsText: likelyNoResults(),
    });
    return parsed;
  }

  function albumPath(v) {
    var text = norm(v);
    var match = text.match(/\/album\/(\d+)/i) || text.match(/^(\d+)$/);
    return match && match[1] ? "/album/" + match[1] : "";
  }

  async function albumTracks(url, meta) {
    var path = albumPath(url);
    if (!path) throw new Error("Invalid album URL.");

    var absolute = BASE_URL.replace(/\/$/, "") + path;
    if (window.location.href !== absolute) {
      window.location.href = absolute;
    }

    var ready = await waitFor(function () {
      var albumRoot = document.querySelector(".album-page");
      return (
        (albumRoot && visible(albumRoot)) ||
        getDownloadButtons().length > 0
      );
    }, 22000, 200);
    if (!ready) throw new Error("Album page failed to load.");

    await sleep(700);

    var albumTitle = norm(
      (document.querySelector(".album-page .album-title") || {}).textContent
    ) || norm(meta && meta.albumTitle);
    var albumArtist = norm(
      (document.querySelector(".album-page .album-artist-row") || {}).textContent
    ) || norm(meta && meta.albumArtist);
    var albumArtwork = norm(
      (document.querySelector(".album-page img") || {}).src
    ) || norm(meta && meta.albumArtwork);

    var buttons = getDownloadButtons();
    var out = [];

    for (var i = 0; i < buttons.length && out.length < 240; i += 1) {
      var row =
        buttons[i].closest(".track-row") ||
        buttons[i].closest('[class*="track-row"]') ||
        cardFromButton(buttons[i]);
      if (!row) continue;

      var title = norm(
        (
          row.querySelector('[class*="track-row__title"],h3,h2,[class*="title"]') ||
          {}
        ).textContent
      );
      if (!title) continue;

      var artist = norm(
        (row.querySelector('[class*="track-row__artist"],p,span') || {}).textContent
      ) || albumArtist || "Unknown";
      var trackNumber = norm(
        (row.querySelector('[class*="track-row__number"]') || {}).textContent
      );
      var duration = parseDur(
        (row.querySelector('[class*="track-row__duration"]') || {}).textContent
      );
      var tags = norm(
        (row.querySelector('[class*="track-row__tags"]') || {}).textContent
      ).replace(
        /^\s*(?:\u2022|\u00e2\u20ac\u00a2|\u00c3\u00a2\u00e2\u201a\u00ac\u00c2\u00a2)\s*/,
        "",
      );
      var subtitle = tags ? artist + " \u2022 " + tags : artist;
      var artwork = norm((row.querySelector("img") || {}).src) || albumArtwork || null;

      out.push({
        index: out.length,
        type: "track",
        title: title,
        artist: artist,
        album: albumTitle || "",
        subtitle: subtitle,
        duration: duration || 0,
        artwork: artwork,
        url: trackNumber ? path + "#" + trackNumber : path,
        tidalId: null,
        downloadable: true,
      });
    }

    blog("Album tracks parsed", {url: path, count: out.length});
    return out;
  }

  async function applySetting(value) {
    var target = norm(value || "Hi-Res");
    var wanted = lower(target).replace(/[^a-z0-9]+/g, "");
    if (wanted.indexOf("hi") >= 0 && wanted.indexOf("res") >= 0) {
      target = "Hi-Res";
      wanted = "hires";
    } else if (wanted.indexOf("320") >= 0 && wanted.indexOf("aac") >= 0) {
      target = "320kbps AAC";
      wanted = "320kbpsaac";
    } else if (wanted.indexOf("96") >= 0 && wanted.indexOf("aac") >= 0) {
      target = "96kbps AAC";
      wanted = "96kbpsaac";
    } else if (wanted.indexOf("lossless") >= 0 && wanted.indexOf("cd") >= 0) {
      target = "CD Lossless";
      wanted = "cdlossless";
    }

    var settings = document.querySelector('button[aria-label^="Settings menu"]');
    if (!visible(settings)) {
      var candidates = Array.prototype.slice.call(document.querySelectorAll("button"));
      for (var si = 0; si < candidates.length; si += 1) {
        var label = buttonLabel(candidates[si]);
        if (visible(candidates[si]) && label.indexOf("settings") >= 0) {
          settings = candidates[si];
          break;
        }
      }
    }
    if (!visible(settings)) {
      blog("Settings button not visible; leaving setting unchanged", {target: target});
      return target;
    }

    var current = lower(
      settings.getAttribute("aria-label") ||
      settings.textContent
    ).replace(/[^a-z0-9]+/g, "");
    if (current && current.indexOf(wanted) >= 0) {
      blog("Download setting already applied", {target: target});
      return target;
    }

    settings.click();
    await sleep(280);

    var panel = await waitFor(function () {
      var divs = Array.prototype.slice.call(document.querySelectorAll("div"));
      for (var i = 0; i < divs.length; i += 1) {
        if (visible(divs[i]) && lower(divs[i].textContent).indexOf("streaming & downloads") >= 0) {
          return divs[i];
        }
      }
      return null;
    }, 5000, 120);
    if (!panel) {
      blog("Settings panel not found; leaving setting unchanged", {target: target});
      return target;
    }

    var labels = [target];
    if (/320/i.test(wanted) && /aac/i.test(wanted)) labels.push("320 kbps AAC", "320 kbps");
    if (/96/i.test(wanted) && /aac/i.test(wanted)) labels.push("96 kbps AAC", "96 kbps");
    if (/hires/i.test(wanted)) labels.push("Hi Res", "Hi-Res");
    if (/cdlossless/i.test(wanted)) labels.push("CD Lossless", "Lossless");

    var nodes = Array.prototype.slice.call(panel.querySelectorAll("button,div,span"));
    for (var li = 0; li < labels.length; li += 1) {
      var lookFor = lower(labels[li]);
      for (var ni = 0; ni < nodes.length; ni += 1) {
        if (!visible(nodes[ni])) continue;
        var text = lower(nodes[ni].textContent);
        if (!text) continue;
        if (text === lookFor || text.indexOf(lookFor) >= 0) {
          nodes[ni].click();
          await sleep(260);
          var after = lower(
            settings.getAttribute("aria-label") ||
            settings.textContent
          ).replace(/[^a-z0-9]+/g, "");
          var applied = after.indexOf(wanted) >= 0;
          blog("Apply setting click result", {
            target: target,
            matchedLabel: labels[li],
            applied: applied,
            current: after,
          });
          return applied ? target : labels[li];
        }
      }
    }
    blog("Setting option not found in panel", {target: target});
    return target;
  }

  function score(song, cand) {
    if (!song || !cand) return -1;

    var scoreVal = 0;
    var targetId = trackId(song.tidalId || song.url);
    var candId = trackId(cand.tidalId || cand.url);
    if (targetId && candId && targetId === candId) scoreVal += 1200;

    var tTitle = lower(song.title);
    var cTitle = lower(cand.title);
    var tArtist = lower(song.artist);
    var cArtist = lower(cand.artist);

    if (tTitle && cTitle) {
      if (tTitle === cTitle) scoreVal += 140;
      else if (tTitle.indexOf(cTitle) >= 0 || cTitle.indexOf(tTitle) >= 0) scoreVal += 90;
    }

    if (tArtist && cArtist) {
      if (tArtist === cArtist) scoreVal += 45;
      else if (tArtist.indexOf(cArtist) >= 0 || cArtist.indexOf(tArtist) >= 0) scoreVal += 20;
    }

    var td = Number(song.duration) || 0;
    var cd = Number(cand.duration) || 0;
    if (td > 0 && cd > 0) {
      var delta = Math.abs(td - cd);
      if (delta === 0) scoreVal += 40;
      else if (delta <= 2) scoreVal += 30;
      else if (delta <= 6) scoreVal += 12;
    }

    return scoreVal;
  }

  function pickBestCandidate(song) {
    var best = null;
    var bestScore = -1;
    var buttons = getDownloadButtons();

    for (var i = 0; i < buttons.length; i += 1) {
      var parsed = parseTrack(buttons[i], 0);
      if (!parsed) continue;
      if (isCancelDownloadLabel(parsed.title)) continue;
      var s = score(song, parsed);
      if (s > bestScore) {
        bestScore = s;
        best = {button: buttons[i], song: parsed, score: s};
      }
    }

    return best;
  }

  async function findCandidate(song) {
    var direct = pickBestCandidate(song);
    if (direct && direct.score >= 130) return direct;

    var queries = [];
    if (song.title && song.artist) {
      queries.push(song.title + " " + song.artist);
      queries.push(song.artist + " " + song.title);
    }
    if (song.title) {
      queries.push(song.title);
    }

    for (var q = 0; q < queries.length; q += 1) {
      await runSearch(queries[q], "tracks");
      var next = pickBestCandidate(song);
      if (next && next.score >= 130) return next;
    }

    return direct || null;
  }

  function findCancelButtonForSong(song) {
    var title = lower(song && song.title);
    if (!title) return null;
    var buttons = Array.prototype.slice.call(document.querySelectorAll("button"));
    for (var i = 0; i < buttons.length; i += 1) {
      if (!visible(buttons[i])) continue;
      var label = buttonLabel(buttons[i]);
      if (!isCancelDownloadLabel(label)) continue;
      if (label.indexOf(title) >= 0) return buttons[i];
    }
    return null;
  }

  async function waitProcessedBlob(startTs, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var best = null;
    while (Date.now() < deadline) {
      best = bestBlobArtifact(startTs);
      if (best && best.clickedAt > 0 && best.blob && best.blob.size > 0) {
        return best;
      }
      await sleep(140);
    }
    return best || null;
  }

  async function waitCapture(startTs, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var quietMs = 1200;
    var waitForResponseWindowMs = 4200;
    var best = null;
    var firstSeenTs = 0;

    function scoreCapture(evt) {
      if (!evt || !evt.url) return -1;
      var scoreVal = 0;
      var url = lower(evt.url);

      if (evt.status >= 200 && evt.status < 300) {
        scoreVal += 260;
      } else if (evt.status > 0) {
        scoreVal -= 220;
      }

      if (evt.contentLength > 0) {
        scoreVal += Math.min(480, Math.round(evt.contentLength / 280000));
      }

      if (evt.contentType && /^audio\//i.test(evt.contentType)) {
        scoreVal += 120;
      }
      if (url.indexOf("/mediatracks/") >= 0) {
        scoreVal += 200;
      }
      if (url.indexOf("policy=") >= 0 && url.indexOf("signature=") >= 0) {
        scoreVal += 140;
      }
      if (/\.(m4a|mp4|flac|aac|mp3)(\?|$)/i.test(url)) {
        scoreVal += 80;
      }
      if (String(evt.source || "").indexOf("response") >= 0) {
        scoreVal += 80;
      }
      if (String(evt.source || "").indexOf("request") >= 0) {
        scoreVal -= 120;
      }
      if (!evt.status && !evt.contentType && !evt.contentLength) {
        scoreVal -= 90;
      }
      return scoreVal;
    }

    while (Date.now() < deadline) {
      var scoped = [];
      for (var i = 0; i < captures.length; i += 1) {
        if (captures[i].ts >= startTs) {
          scoped.push(captures[i]);
        }
      }

      if (scoped.length > 0) {
        if (!firstSeenTs) firstSeenTs = scoped[0].ts;
        var newestTs = scoped[scoped.length - 1].ts;
        var top = null;
        var topScore = -1;
        var hasResponseCapture = false;
        for (var j = 0; j < scoped.length; j += 1) {
          if (String(scoped[j].source || "").indexOf("response") >= 0) {
            hasResponseCapture = true;
          }
          var currentScore = scoreCapture(scoped[j]);
          if (currentScore > topScore) {
            topScore = currentScore;
            top = scoped[j];
          }
        }

        if (top) {
          best = {event: top, score: topScore, total: scoped.length};
        }
        var quietEnough = Date.now() - newestTs >= quietMs;
        var waitedLongEnoughForResponse =
          firstSeenTs > 0 && Date.now() - firstSeenTs >= waitForResponseWindowMs;
        var bestIsResponse =
          best && String(best.event && best.event.source || "").indexOf("response") >= 0;
        if (
          best &&
          quietEnough &&
          (hasResponseCapture || bestIsResponse || waitedLongEnoughForResponse)
        ) {
          return best;
        }
      }

      await sleep(180);
    }

    if (best) {
      return best;
    }

    throw new Error("Timed out waiting for media URL.");
  }

  async function download(payload, context) {
    installCapture();
    var song = payload && payload.song;
    var commandId = context && context.id ? context.id : "";
    if (!song || !norm(song.title)) throw new Error("Song title is missing.");

    await ensureInput();
    var applied = await applySetting(payload && payload.downloadSetting);
    var candidate = await findCandidate(song);
    if (!candidate) {
      var cancelButton = findCancelButtonForSong(song);
      if (cancelButton) {
        blog("Clearing stale cancel state before retrying candidate", {
          targetTitle: norm(song.title),
        });
        cancelButton.click();
        await sleep(520);
        candidate = await findCandidate(song);
      }
    }
    if (!candidate || !candidate.button) {
      throw new Error("Could not resolve track download button.");
    }

    if (candidate.button.scrollIntoView) {
      candidate.button.scrollIntoView({block: "center"});
    }
    await sleep(250);

    blog("Download candidate resolved", {
      targetTitle: norm(song.title),
      matchedTitle: norm((candidate.song || {}).title),
      matchedArtist: norm((candidate.song || {}).artist),
      score: candidate.score,
    });

    var started = Date.now();
    candidate.button.click();

    var processedBlob = await waitProcessedBlob(
      started,
      /aac/i.test(lower(applied)) ? 105000 : 70000
    );
    if (processedBlob && processedBlob.blob && processedBlob.blob.size > 0) {
      blog("Processed blob artifact selected", {
        filename: processedBlob.filename || null,
        type: processedBlob.type || null,
        size: processedBlob.blob.size,
      });
      if (!commandId) {
        throw new Error("Command id missing for chunk transfer.");
      }
      var chunkTransfer = await emitBlobChunks(commandId, processedBlob);
      chunkTransfer.appliedSetting = applied;
      chunkTransfer.song = candidate.song || song;
      return chunkTransfer;
    }

    var mediaPicked = await waitCapture(
      started,
      /aac/i.test(lower(applied)) ? 95000 : 50000
    );
    var media = mediaPicked.event;
    blog("Media capture selected", {
      score: mediaPicked.score,
      totalCaptured: mediaPicked.total,
      status: media.status || null,
      contentType: media.contentType || null,
      contentLength: media.contentLength || 0,
      source: media.source || null,
      url: media.url,
    });

    return {
      mediaUrl: media.url,
      method: media.method || "GET",
      contentType: media.contentType || "",
      contentLength: media.contentLength || 0,
      status: media.status || null,
      headers: media.headers || null,
      requestHeaders: media.requestHeaders || null,
      referer: media.referer || BASE_URL,
      userAgent: media.userAgent || "",
      appliedSetting: applied,
      song: candidate.song || song,
    };
  }

  var handlers = {
    ping: async function () {
      return {
        ok: true,
        href: window.location.href,
        inputReady: Boolean(inputNode()),
        downloadButtons: getDownloadButtons().length,
      };
    },
    search: async function (payload) {
      return {
        items: await runSearch(payload && payload.q, payload && payload.type),
      };
    },
    albumTracks: async function (payload) {
      return {
        items: await albumTracks(
          payload && (payload.url || payload.albumUrl),
          {
            albumTitle: payload && payload.album,
            albumArtist: payload && payload.artist,
            albumArtwork: payload && payload.artwork,
          }
        ),
      };
    },
    download: async function (payload, context) {
      return download(payload || {}, context || {});
    },
  };

  async function onMessage(raw) {
    var msg = null;
    try {
      msg = JSON.parse(raw);
    } catch (_) {
      return;
    }

    if (!msg || !msg.id || !handlers[msg.type]) return;
    blog("Received command", {id: msg.id, type: msg.type});

    try {
      var result = await handlers[msg.type](msg.payload || {}, {id: msg.id});
      blog("Command success", {id: msg.id, type: msg.type});
      send({type: RESP, id: msg.id, ok: true, result: result});
    } catch (error) {
      blog("Command error", {
        id: msg.id,
        type: msg.type,
        error: error && error.message ? error.message : String(error),
      });
      send({
        type: RESP,
        id: msg.id,
        ok: false,
        error: error && error.message ? error.message : String(error),
      });
    }
  }

  window.addEventListener("message", function (event) {
    onMessage(event && event.data);
  });
  document.addEventListener("message", function (event) {
    onMessage(event && event.data);
  });

  installCapture();
  blog("Bridge script initialized", {href: window.location.href});
  send({type: READY});
})();
true;
`;

export default SQUID_BRIDGE_SCRIPT;

