import path from "path";

import { DOWNLOAD_SETTINGS, SELECTORS } from "./config.js";

const DEFAULT_DOWNLOAD_SETTING = "Hi-Res";
const DEFAULT_DOWNLOAD_START_TIMEOUT_MS = 45_000;
const AAC_DOWNLOAD_START_TIMEOUT_MS = 90_000;

function emitProgress(onProgress, payload) {
  if (typeof onProgress !== "function") {
    return;
  }

  onProgress(payload);
}

function normalizeSettingLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function canonicalDownloadSetting(requestedSetting) {
  const normalizedRequest = normalizeSettingLabel(requestedSetting);
  if (!normalizedRequest) {
    return DEFAULT_DOWNLOAD_SETTING;
  }

  const exactSetting = DOWNLOAD_SETTINGS.find(
    setting => normalizeSettingLabel(setting) === normalizedRequest
  );
  if (exactSetting) {
    return exactSetting;
  }

  if (normalizedRequest.includes("320") && normalizedRequest.includes("aac")) {
    return "320kbps AAC";
  }
  if (normalizedRequest.includes("96") && normalizedRequest.includes("aac")) {
    return "96kbps AAC";
  }
  if (
    normalizedRequest.includes("cd") &&
    normalizedRequest.includes("lossless")
  ) {
    return "CD Lossless";
  }
  if (
    normalizedRequest.includes("hi") &&
    normalizedRequest.includes("res")
  ) {
    return "Hi-Res";
  }

  return DEFAULT_DOWNLOAD_SETTING;
}

function getSettingTextCandidates(setting) {
  const normalizedSetting = normalizeSettingLabel(setting);
  if (normalizedSetting === normalizeSettingLabel("320kbps AAC")) {
    return ["320kbps AAC", "320 kbps AAC", "320 kbps", "320kbps"];
  }
  if (normalizedSetting === normalizeSettingLabel("96kbps AAC")) {
    return ["96kbps AAC", "96 kbps AAC", "96 kbps", "96kbps"];
  }
  return [setting];
}

function labelContainsSetting(label, setting) {
  const normalizedLabel = normalizeSettingLabel(label);
  const normalizedSetting = normalizeSettingLabel(setting);
  return Boolean(
    normalizedLabel && normalizedSetting && normalizedLabel.includes(normalizedSetting)
  );
}

async function findSettingOption(panel, setting) {
  const textCandidates = getSettingTextCandidates(setting);

  for (const label of textCandidates) {
    const exactOption = panel.getByText(label, { exact: true }).first();
    if (await exactOption.isVisible().catch(() => false)) {
      return exactOption;
    }
  }

  for (const label of textCandidates) {
    const looseOption = panel.getByText(label).first();
    if (await looseOption.isVisible().catch(() => false)) {
      return looseOption;
    }
  }

  return null;
}

function getDownloadStartTimeoutMs(setting) {
  const normalizedSetting = normalizeSettingLabel(setting);
  return normalizedSetting.includes("aac")
    ? AAC_DOWNLOAD_START_TIMEOUT_MS
    : DEFAULT_DOWNLOAD_START_TIMEOUT_MS;
}

function getNextSyntheticProgress(value) {
  if (value < 78) {
    return value + 2;
  }
  if (value < 90) {
    return value + 1;
  }
  if (value < 97) {
    return value + 0.5;
  }
  return value + 0.2;
}

async function applyDownloadSetting(page, requestedSetting = DEFAULT_DOWNLOAD_SETTING) {
  const setting = canonicalDownloadSetting(requestedSetting);

  const settingsButton = page.locator(SELECTORS.settingsButton).first();
  if (!(await settingsButton.isVisible().catch(() => false))) {
    return setting;
  }

  const currentLabel = await settingsButton.getAttribute("aria-label").catch(() => "");
  if (labelContainsSetting(currentLabel, setting)) {
    return setting;
  }

  await settingsButton.click();
  await page.waitForTimeout(250);

  const panel = page.locator(SELECTORS.settingsPanel).first();
  await panel.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

  const option = await findSettingOption(panel, setting);
  if (option) {
    await option.click();
    await page.waitForTimeout(300);
  }
  return setting;
}

export async function downloadSong(page, songElement, folderPath, downloadSetting = "Hi-Res", onProgress = null) {
  console.log("Preparing to download...");

  emitProgress(onProgress, { phase: "preparing", progress: 8 });
  const appliedSetting = await applyDownloadSetting(page, downloadSetting);
  emitProgress(onProgress, { phase: "preparing", progress: 18, setting: appliedSetting });

  const downloadButton = songElement.locator(SELECTORS.downloadButton).first();
  try {
    await downloadButton.waitFor({ state: "visible", timeout: 5000 });
  } catch (error) {
    throw new Error("Download button not found in this song card");
  }

  await downloadButton.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  emitProgress(onProgress, { phase: "preparing", progress: 32 });

  console.log("Initiating download...");
  emitProgress(onProgress, { phase: "downloading", progress: 42 });

  let syntheticProgress = 42;
  const pulse = setInterval(() => {
    syntheticProgress = Math.min(getNextSyntheticProgress(syntheticProgress), 99);
    emitProgress(onProgress, {
      phase: "downloading",
      progress: Math.round(syntheticProgress),
    });
  }, 800);

  const downloadStartTimeoutMs = getDownloadStartTimeoutMs(appliedSetting);
  let download;
  try {
    [download] = await Promise.all([
      page.waitForEvent("download", { timeout: downloadStartTimeoutMs }),
      downloadButton.click(),
    ]);
  } catch (error) {
    if (/timeout/i.test(String(error?.message || ""))) {
      throw new Error(
        `Download did not start in time for ${appliedSetting}. Please retry this track.`
      );
    }
    throw error;
  } finally {
    clearInterval(pulse);
  }

  emitProgress(onProgress, { phase: "downloading", progress: 94 });
  emitProgress(onProgress, { phase: "saving", progress: 97 });

  const filename = download.suggestedFilename();
  const filepath = path.join(folderPath, filename);
  await download.saveAs(filepath);

  emitProgress(onProgress, { phase: "done", progress: 100 });
  return filename;
}
