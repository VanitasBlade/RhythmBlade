import cors from "cors";
import express from "express";
import path from "path";
import {fileURLToPath} from "url";

import {createBrowserController} from "./src/server/browserController.js";
import {createDownloadEngine} from "./src/server/downloadEngine.js";
import {registerRoutes} from "./src/server/routes.js";
import {createSearchEngine} from "./src/server/searchEngine.js";
import {createServerState} from "./src/server/state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const songsDir = path.join(__dirname, "songs");

const app = express();
app.use(cors());
app.use(express.json());

const state = createServerState();
const browserController = createBrowserController(state);
const searchEngine = createSearchEngine(state, browserController);
const downloadEngine = createDownloadEngine({
  state,
  browserController,
  searchEngine,
  songsDir,
});

registerRoutes({
  app,
  browserController,
  searchEngine,
  downloadEngine,
  songsDir,
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
