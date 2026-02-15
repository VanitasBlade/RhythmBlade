import fs from "fs";
import { chromium } from "playwright";
import { SESSION_FILE } from "./config.js";

export async function createBrowser() {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "false",
  });

  const contextOptions = {
    acceptDownloads: true,
    ignoreHTTPSErrors: true,
  };

  if (fs.existsSync(SESSION_FILE)) {
    contextOptions.storageState = SESSION_FILE;
  }

  const context = await browser.newContext(contextOptions);

  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);

  return { browser, context, page };
}
