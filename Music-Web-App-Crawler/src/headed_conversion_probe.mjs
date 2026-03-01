import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = "https://tidal.squid.wtf/";
const SESSION_FILE = "./.session/squid-state.json";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const browser = await chromium.launch({
  headless: false,
  slowMo: 120,
});

const context = await browser.newContext({
  acceptDownloads: true,
  ignoreHTTPSErrors: true,
  ...(fs.existsSync(path.resolve(SESSION_FILE))
    ? { storageState: SESSION_FILE }
    : {}),
});

const page = await context.newPage();
page.setDefaultTimeout(45_000);

const networkHits = [];
const browserDownloads = [];

await page.exposeBinding("__PW_PROBE__", (_source, payload) => {
  const evt = payload || {};
  const type = String(evt.type || "");
  if (!/(anchor|object-url|ffmpeg|worker|wasm|download|convert)/i.test(type)) {
    return;
  }
  console.log(
    "PROBE",
    JSON.stringify({
      type,
      ts: evt.ts,
      url: evt.url || evt.href || evt.script || "",
      download: evt.download || "",
      blobType: evt.blobType || "",
      size: evt.size || 0,
      key: evt.key || "",
    })
  );
});

await page.addInitScript(() => {
  const events = [];
  window.__pwProbeEvents = events;

  function emit(type, data) {
    const evt = { ts: Date.now(), type, ...(data || {}) };
    events.push(evt);
    if (events.length > 4000) {
      events.splice(0, events.length - 4000);
    }
    try {
      if (typeof window.__PW_PROBE__ === "function") {
        window.__PW_PROBE__(evt);
      }
    } catch (_) {}
  }

  function norm(v) {
    return String(v || "").replace(/\s+/g, " ").trim();
  }

  function interestingUrl(url) {
    const v = String(url || "").toLowerCase();
    return (
      v.includes("ffmpeg") ||
      v.includes("wasm") ||
      v.includes("worker") ||
      v.includes("mediatracks") ||
      /\.(mp3|m4a|mp4|aac|flac)(\?|$)/i.test(v)
    );
  }

  const OriginalWorker = window.Worker;
  if (OriginalWorker) {
    window.Worker = function WorkerProxy(scriptURL, options) {
      emit("worker-create", { script: String(scriptURL || "") });
      return new OriginalWorker(scriptURL, options);
    };
    window.Worker.prototype = OriginalWorker.prototype;
  }

  const originalCreateObjectURL =
    window.URL && window.URL.createObjectURL
      ? window.URL.createObjectURL.bind(window.URL)
      : null;
  if (originalCreateObjectURL) {
    window.URL.createObjectURL = function createObjectURLProxy(obj) {
      const url = originalCreateObjectURL(obj);
      emit("object-url", {
        url,
        blobType: obj && obj.type ? String(obj.type) : "",
        size: obj && typeof obj.size === "number" ? obj.size : 0,
      });
      return url;
    };
  }

  const originalAnchorClick =
    window.HTMLAnchorElement &&
    window.HTMLAnchorElement.prototype &&
    window.HTMLAnchorElement.prototype.click
      ? window.HTMLAnchorElement.prototype.click
      : null;
  if (originalAnchorClick) {
    window.HTMLAnchorElement.prototype.click = function anchorClickProxy() {
      const href =
        norm(this.getAttribute && this.getAttribute("href")) || norm(this.href);
      const download =
        norm(this.getAttribute && this.getAttribute("download")) ||
        norm(this.download);
      emit("anchor-click", { href, download });
      return originalAnchorClick.apply(this, arguments);
    };
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function fetchProxy() {
      const req = arguments[0];
      const init = arguments[1] || {};
      const url = typeof req === "string" ? req : req && req.url;
      if (interestingUrl(url)) {
        emit("fetch-request", {
          url: String(url || ""),
          method: String(init.method || (req && req.method) || "GET"),
        });
      }
      return originalFetch.apply(window, arguments).then(res => {
        const resUrl = (res && res.url) || url;
        const ct = (res && res.headers && res.headers.get("content-type")) || "";
        if (interestingUrl(resUrl) || /audio|mpeg|mp4|flac|aac|wasm/i.test(String(ct))) {
          emit("fetch-response", {
            url: String(resUrl || ""),
            status: Number(res && res.status) || 0,
            contentType: String(ct || ""),
          });
        }
        return res;
      });
    };
  }

  const xOpen = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
  const xSend = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;
  if (xOpen && xSend) {
    window.XMLHttpRequest.prototype.open = function openProxy(method, url) {
      this.__probeUrl = url;
      return xOpen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function sendProxy() {
      const xhr = this;
      xhr.addEventListener("load", function onLoad() {
        const finalUrl = xhr.responseURL || xhr.__probeUrl || "";
        const ct = xhr.getResponseHeader("content-type") || "";
        if (interestingUrl(finalUrl) || /audio|mpeg|mp4|flac|aac|wasm/i.test(String(ct))) {
          emit("xhr-response", {
            url: String(finalUrl || ""),
            status: Number(xhr.status) || 0,
            contentType: String(ct || ""),
          });
        }
      });
      return xSend.apply(this, arguments);
    };
  }

  const originalInstantiate =
    window.WebAssembly && window.WebAssembly.instantiate
      ? window.WebAssembly.instantiate.bind(window.WebAssembly)
      : null;
  if (originalInstantiate) {
    window.WebAssembly.instantiate = function instantiateProxy(source) {
      let size = 0;
      try {
        size = source && source.byteLength ? source.byteLength : 0;
      } catch (_) {
        size = 0;
      }
      emit("wasm-instantiate", { size });
      return originalInstantiate.apply(window.WebAssembly, arguments);
    };
  }

  const originalInstantiateStreaming =
    window.WebAssembly && window.WebAssembly.instantiateStreaming
      ? window.WebAssembly.instantiateStreaming.bind(window.WebAssembly)
      : null;
  if (originalInstantiateStreaming) {
    window.WebAssembly.instantiateStreaming = function instantiateStreamingProxy(source) {
      let src = "";
      try {
        src = source && source.url ? String(source.url) : "";
      } catch (_) {
        src = "";
      }
      emit("wasm-instantiate-streaming", { url: src });
      return originalInstantiateStreaming.apply(window.WebAssembly, arguments);
    };
  }

  setInterval(() => {
    try {
      if (typeof window.createFFmpeg === "function") {
        emit("ffmpeg-global", { key: "createFFmpeg" });
      }
      if (typeof window.FFmpeg !== "undefined") {
        emit("ffmpeg-global", { key: "FFmpeg", valueType: typeof window.FFmpeg });
      }
      if (typeof window.ffmpeg !== "undefined") {
        emit("ffmpeg-global", { key: "ffmpeg", valueType: typeof window.ffmpeg });
      }
    } catch (_) {}
  }, 1800);
});

page.on("console", msg => {
  const text = msg.text();
  if (/ffmpeg|mp3|m4a|convert|download|wasm|worker/i.test(text)) {
    console.log("PAGE_CONSOLE", text);
  }
});

page.on("response", res => {
  const url = res.url();
  if (/ffmpeg|wasm|worker|mediatracks|\.mp3|\.m4a|\.mp4|\.aac|\.flac/i.test(url)) {
    const hit = {
      url,
      status: res.status(),
      contentType: res.headers()["content-type"] || "",
    };
    networkHits.push(hit);
    if (networkHits.length <= 120) {
      console.log("NET", JSON.stringify(hit));
    }
  }
});

page.on("download", d => {
  const filename = d.suggestedFilename();
  const hit = { filename };
  browserDownloads.push(hit);
  console.log("PLAYWRIGHT_DOWNLOAD", JSON.stringify(hit));
});

async function configure320AndConvertOn() {
  return page.evaluate(async () => {
    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
    function norm(v) {
      return String(v || "").replace(/\s+/g, " ").trim();
    }
    function lower(v) {
      return norm(v).toLowerCase();
    }
    function visible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function settingsButton() {
      let node = document.querySelector('button[aria-label^="Settings menu"]');
      if (visible(node)) return node;
      const buttons = Array.from(document.querySelectorAll("button"));
      for (let i = 0; i < buttons.length; i += 1) {
        const text = lower(
          (buttons[i].textContent || "") +
            " " +
            (buttons[i].getAttribute("aria-label") || "")
        );
        if (visible(buttons[i]) && text.includes("settings")) return buttons[i];
      }
      return null;
    }
    function currentQuality(settings) {
      const text = lower(
        (settings && settings.getAttribute("aria-label")) ||
          (settings && settings.textContent) ||
          ""
      );
      if (text.includes("320") && text.includes("aac")) return "320kbps AAC";
      if (text.includes("96") && text.includes("aac")) return "96kbps AAC";
      if (text.includes("cd") && text.includes("lossless")) return "CD Lossless";
      if (text.includes("hi-res") || (text.includes("hi") && text.includes("res"))) return "Hi-Res";
      return "";
    }
    function settingsPanel() {
      const direct = document.querySelector(".settings-menu");
      if (visible(direct)) return direct;
      const fallbacks = Array.from(document.querySelectorAll("div.settings-menu, div.settings-grid"));
      for (let i = 0; i < fallbacks.length; i += 1) {
        if (visible(fallbacks[i])) return fallbacks[i];
      }
      return null;
    }

    function optionButtons(panel) {
      const root = panel || settingsPanel();
      if (!root) return [];
      const buttons = Array.from(root.querySelectorAll("button.glass-option, button[aria-pressed]"));
      return buttons.filter(visible);
    }

    function panelQuality(panel) {
      const buttons = optionButtons(panel);
      const active = buttons.find(btn => btn.getAttribute("aria-pressed") === "true");
      const text = lower(active ? active.textContent || "" : "");
      if (text.includes("320") && text.includes("aac")) return "320kbps AAC";
      if (text.includes("96") && text.includes("aac")) return "96kbps AAC";
      if (text.includes("cd") && text.includes("lossless")) return "CD Lossless";
      if (text.includes("hi-res") || (text.includes("hi") && text.includes("res"))) return "Hi-Res";
      return "";
    }

    function convertButton(panel) {
      const buttons = optionButtons(panel);
      return (
        buttons.find(btn => {
          const text = lower(btn.textContent || "");
          return text.includes("convert") && text.includes("aac") && text.includes("mp3");
        }) || null
      );
    }
    async function ensurePanelOpen(settings) {
      let panel = settingsPanel();
      if (panel) return panel;
      settings.click();
      await sleep(260);
      panel = settingsPanel();
      return panel;
    }
    function readConvertState(panel) {
      const btn = convertButton(panel);
      if (!btn) return { found: false, enabled: null, row: null };
      const pressed = btn.getAttribute("aria-pressed");
      if (pressed === "true") return { found: true, enabled: true, row: btn };
      if (pressed === "false") return { found: true, enabled: false, row: btn };
      const text = lower(btn.textContent || "");
      const hasOn = /\bon\b/.test(text);
      const hasOff = /\boff\b/.test(text);
      if (hasOn && !hasOff) return { found: true, enabled: true, row: btn };
      if (hasOff && !hasOn) return { found: true, enabled: false, row: btn };
      return { found: true, enabled: null, row: btn };
    }

    const settings = settingsButton();
    if (!settings) {
      return { ok: false, reason: "settings-button-missing" };
    }

    const steps = [];

    // Force quality to 320kbps AAC
    let qualityOk = false;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      let panel = await ensurePanelOpen(settings);
      if (!panel) {
        steps.push({ step: "open-panel", attempt, ok: false });
        continue;
      }

      const qButton =
        optionButtons(panel).find(btn => {
          const text = lower(btn.textContent || "");
          return text.includes("320kbps aac") || (text.includes("320") && text.includes("aac"));
        }) || null;
      const clicked = Boolean(qButton);
      if (qButton) {
        qButton.click();
      }
      await sleep(260);

      panel = settingsPanel() || panel;
      const quality = panelQuality(panel) || currentQuality(settings);
      qualityOk = quality === "320kbps AAC";
      steps.push({ step: "set-quality-320", attempt, clicked, quality });
      if (qualityOk) break;
    }

    // Force convert toggle ON
    let convertOk = false;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      let panel = await ensurePanelOpen(settings);
      if (!panel) {
        steps.push({ step: "open-panel-convert", attempt, ok: false });
        continue;
      }

      const stateBefore = readConvertState(panel);
      let clicked = false;
      if (stateBefore.found && stateBefore.enabled !== true && stateBefore.row) {
        stateBefore.row.click();
        clicked = true;
        await sleep(260);
      }
      panel = settingsPanel() || panel;
      const stateAfter = readConvertState(panel);
      convertOk = stateAfter.found && stateAfter.enabled === true;
      steps.push({
        step: "set-convert-on",
        attempt,
        clicked,
        before: stateBefore.enabled,
        after: stateAfter.enabled,
        found: stateAfter.found,
      });
      if (convertOk) break;
    }

    const finalQuality = panelQuality(settingsPanel()) || currentQuality(settings);
    const finalPanel = settingsPanel();
    const finalConvert = finalPanel ? readConvertState(finalPanel) : { found: false, enabled: null };
    const qualityLabel = norm(
      settings.getAttribute("aria-label") || settings.textContent || ""
    );

    // Close settings panel after verification
    if (settingsPanel()) {
      settings.click();
      await sleep(120);
    }

    return {
      ok: qualityOk && convertOk,
      qualityOk,
      convertOk,
      finalQuality,
      finalConvert: finalConvert.enabled,
      qualityLabel,
      steps,
    };
  });
}

async function clickFirstDownloadButton() {
  return page.evaluate(() => {
    function visible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    const btn = Array.from(document.querySelectorAll('button[aria-label^="Download "]')).find(visible);
    if (!btn) return { ok: false, reason: "download-button-missing" };
    const label = String(btn.getAttribute("aria-label") || "").trim();
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return { ok: true, label };
  });
}

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  const input = page
    .locator('input[placeholder*="Search"], input[aria-label*="Search"], input[type="search"]')
    .first();
  await input.waitFor({ state: "visible", timeout: 40_000 });
  await input.fill("you armaan malik");
  await input.press("Enter");
  await sleep(2600);

  const tracksTab = page.getByRole("button", { name: /tracks/i }).first();
  if (await tracksTab.isVisible().catch(() => false)) {
    await tracksTab.click().catch(() => {});
    await sleep(600);
  }

  await page
    .locator('button[aria-label^="Download "]')
    .first()
    .waitFor({ state: "visible", timeout: 50_000 });

  const config = await configure320AndConvertOn();
  console.log("CONFIG_RESULT", JSON.stringify(config, null, 2));
  if (!config.ok) {
    throw new Error(
      `Settings verification failed (qualityOk=${config.qualityOk}, convertOk=${config.convertOk}).`
    );
  }

  const clickResult = await clickFirstDownloadButton();
  console.log("DOWNLOAD_CLICK", JSON.stringify(clickResult));
  if (!clickResult.ok) {
    throw new Error(clickResult.reason || "Failed to click download button.");
  }

  // Give time for full chain: source download + optional ffmpeg conversion + final browser download.
  await sleep(115_000);

  const summary = await page.evaluate(() => {
    const events = Array.isArray(window.__pwProbeEvents) ? window.__pwProbeEvents : [];
    const anchors = events
      .filter(e => e.type === "anchor-click")
      .map(e => ({
        ts: e.ts,
        href: e.href || "",
        download: e.download || "",
      }));
    const objectUrls = events
      .filter(e => e.type === "object-url")
      .map(e => ({
        ts: e.ts,
        url: e.url || "",
        blobType: e.blobType || "",
        size: Number(e.size) || 0,
      }));
    const ffmpegSignals = events.filter(
      e =>
        /ffmpeg|wasm|worker/.test(String(e.type || "")) ||
        /ffmpeg/i.test(String(e.url || "") + " " + String(e.script || ""))
    );
    return {
      totalEvents: events.length,
      anchors,
      objectUrls,
      ffmpegSignalCount: ffmpegSignals.length,
      ffmpegSignals: ffmpegSignals.slice(0, 120),
    };
  });

  console.log("=== PROBE SUMMARY START ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("=== PROBE SUMMARY END ===");
  console.log("=== PLAYWRIGHT DOWNLOADS ===");
  console.log(JSON.stringify(browserDownloads, null, 2));
  console.log("=== NETWORK HITS ===");
  console.log(JSON.stringify(networkHits.slice(0, 220), null, 2));
} catch (error) {
  console.error(
    "HEADED_PROBE_FAILED",
    error && error.message ? error.message : String(error)
  );
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}
