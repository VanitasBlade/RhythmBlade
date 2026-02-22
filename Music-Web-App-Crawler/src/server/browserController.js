import {ensureLoggedIn} from "../auth.js";
import {createBrowser} from "../browser.js";
import {BASE_URL} from "../config.js";

export function createBrowserController(state) {
  function runBrowserTask(task) {
    const run = state.browserQueue.then(() => task());
    state.browserQueue = run.catch(() => {});
    return run;
  }

  async function initBrowser(authOverride = null) {
    if (!state.browserInstance) {
      state.browserInstance = await createBrowser();
    }

    const {page, context} = state.browserInstance;
    if (!state.browserInitialized || authOverride) {
      await ensureLoggedIn(page, context, authOverride || {});
      await page.goto(BASE_URL, {waitUntil: "domcontentloaded"});
      state.browserInitialized = true;
    }

    return state.browserInstance;
  }

  function getBrowserInstance() {
    return state.browserInstance;
  }

  return {
    runBrowserTask,
    initBrowser,
    getBrowserInstance,
  };
}
