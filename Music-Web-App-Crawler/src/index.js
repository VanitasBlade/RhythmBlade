import fs from "fs";
import promptSync from "prompt-sync";

import { ensureLoggedIn } from "./auth.js";
import { createBrowser } from "./browser.js";
import { BASE_URL } from "./config.js";
import { downloadSong } from "./downloader.js";
import { searchSongs } from "./search.js";

const prompt = promptSync();

(async () => {
  console.log("\nDAB Music CLI Bot\n");

  if (!fs.existsSync("./songs")) {
    fs.mkdirSync("./songs");
  }

  const { browser, context, page } = await createBrowser();

  try {
    await ensureLoggedIn(page, context);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    const query = prompt("Enter song name: ").trim();
    if (!query) {
      console.log("Empty search. Exiting.");
      return;
    }

    const songs = await searchSongs(page, query);
    if (songs.length === 0) {
      console.log("No songs found.");
      return;
    }

    console.log("\nResults:\n");
    songs.forEach((song, i) => {
      console.log(`[${i + 1}] ${song.title} - ${song.artist}`);
    });

    const selection = parseInt(prompt("\nSelect song number to download: "), 10) - 1;
    if (Number.isNaN(selection) || selection < 0 || selection >= songs.length) {
      console.log("Invalid selection.");
      return;
    }

    const filename = await downloadSong(page, songs[selection].element, "./songs");
    console.log(`Downloaded: ${filename}`);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await context.close();
    await browser.close();
  }
})();

