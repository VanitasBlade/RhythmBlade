import path from "path";

import { DOWNLOAD_SETTINGS, SELECTORS } from "./config.js";

async function applyDownloadSetting(page, requestedSetting = "Hi-Res") {
  const setting = DOWNLOAD_SETTINGS.includes(requestedSetting)
    ? requestedSetting
    : "Hi-Res";

  const settingsButton = page.locator(SELECTORS.settingsButton).first();
  if (!(await settingsButton.isVisible().catch(() => false))) {
    return;
  }

  const currentLabel = await settingsButton.getAttribute("aria-label").catch(() => "");
  if (currentLabel && currentLabel.toLowerCase().includes(setting.toLowerCase())) {
    return;
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
}

export async function downloadSong(page, songElement, folderPath, downloadSetting = "Hi-Res") {
  console.log("Preparing to download...");

  await applyDownloadSetting(page, downloadSetting);

  const downloadButton = songElement.locator(SELECTORS.downloadButton).first();
  try {
    await downloadButton.waitFor({ state: "visible", timeout: 5000 });
  } catch (error) {
    throw new Error("Download button not found in this song card");
  }

  await downloadButton.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  console.log("Initiating download...");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 45000 }),
    downloadButton.click(),
  ]);

  const filename = download.suggestedFilename();
  const filepath = path.join(folderPath, filename);
  await download.saveAs(filepath);

  return filename;
}
