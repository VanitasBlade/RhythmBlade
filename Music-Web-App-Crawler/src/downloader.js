import path from "path";

import { DOWNLOAD_SETTINGS, SELECTORS } from "./config.js";

function emitProgress(onProgress, payload) {
  if (typeof onProgress !== "function") {
    return;
  }

  onProgress(payload);
}

async function applyDownloadSetting(page, requestedSetting = "Hi-Res") {
  const setting = DOWNLOAD_SETTINGS.includes(requestedSetting)
    ? requestedSetting
    : "Hi-Res";

  const settingsButton = page.locator(SELECTORS.settingsButton).first();
  if (!(await settingsButton.isVisible().catch(() => false))) {
    return setting;
  }

  const currentLabel = await settingsButton.getAttribute("aria-label").catch(() => "");
  if (currentLabel && currentLabel.toLowerCase().includes(setting.toLowerCase())) {
    return setting;
  }

  await settingsButton.click();
  await page.waitForTimeout(250);

  const panel = page.locator(SELECTORS.settingsPanel).first();
  await panel.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

  const option = panel.getByText(setting, { exact: true }).first();
  if (await option.isVisible().catch(() => false)) {
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
    syntheticProgress = Math.min(syntheticProgress + 2, 92);
    emitProgress(onProgress, { phase: "downloading", progress: syntheticProgress });
  }, 800);

  let download;
  try {
    [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 45000 }),
      downloadButton.click(),
    ]);
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
