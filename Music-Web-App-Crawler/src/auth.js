import fs from "fs";
import path from "path";

import { BASE_URL, SESSION_FILE } from "./config.js";

function ensureSessionDir() {
  const dir = path.dirname(SESSION_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function hasSavedSession() {
  return fs.existsSync(SESSION_FILE);
}

export async function saveSessionState(context) {
  ensureSessionDir();
  await context.storageState({ path: SESSION_FILE });
}

export async function ensureLoggedIn(page, context, overrideAuth = {}) {
  // SquidWTF does not require user authentication, but we keep this function
  // to preserve the existing init flow and persist browser storage state.
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await saveSessionState(context);
}
