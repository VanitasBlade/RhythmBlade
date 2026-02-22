import path from "path";

import {streamFile} from "./streamFile.js";

function errorMessage(error) {
  return error?.message || String(error);
}

function hasErrorText(error, ...parts) {
  const message = errorMessage(error);
  return parts.some(part => message.includes(part));
}

function sendApiError(res, status, error) {
  return res.status(status).json({success: false, error: errorMessage(error)});
}

function sendStreamError(res, status, error) {
  return res.status(status).json({error: errorMessage(error)});
}

export function registerRoutes({
  app,
  browserController,
  searchEngine,
  downloadEngine,
  songsDir,
}) {
  app.post("/api/login", async (req, res) => {
    try {
      const {email, password} = req.body || {};
      await browserController.runBrowserTask(() =>
        browserController.initBrowser({email, password})
      );
      return res.json({success: true});
    } catch (error) {
      return sendApiError(res, 500, error);
    }
  });

  app.get("/api/search", async (req, res) => {
    try {
      const query = String(req.query.q || "").trim();
      if (!query) {
        return sendApiError(res, 400, "Missing query 'q'");
      }

      const type = String(req.query.type || "tracks").trim();
      const songs = await searchEngine.searchByType(query, type);
      searchEngine.setLastSearchSongs(songs);

      return res.json({
        success: true,
        songs: songs.map(downloadEngine.toPublicItem),
      });
    } catch (error) {
      return sendApiError(res, /timed out/i.test(errorMessage(error)) ? 504 : 500, error);
    }
  });

  app.post("/api/download", async (req, res) => {
    try {
      const result = await downloadEngine.runDownloadPipeline(req.body || {});
      return res.json({
        success: true,
        song: {
          id: result.id,
          filename: result.filename,
          ...downloadEngine.toPublicItem(result.selectedSong),
        },
      });
    } catch (error) {
      if (
        hasErrorText(
          error,
          "Song not found in current search context",
          "not downloadable"
        )
      ) {
        return sendApiError(res, 400, error);
      }
      return sendApiError(res, 500, error);
    }
  });

  app.post("/api/downloads", (req, res) => {
    try {
      const queued = downloadEngine.enqueueDownload(req.body || {});
      if (!queued.ok) {
        return sendApiError(res, 400, queued.error);
      }

      return res.status(202).json({
        success: true,
        job: downloadEngine.toPublicDownloadJob(queued.job),
      });
    } catch (error) {
      return sendApiError(res, 500, error);
    }
  });

  app.get("/api/downloads", (req, res) =>
    res.json({
      success: true,
      jobs: downloadEngine.getDownloadJobs(req.query.limit),
    })
  );

  app.post("/api/downloads/:id/cancel", (req, res) => {
    try {
      const canceled = downloadEngine.cancelDownloadJob(req.params.id);
      return res.status(202).json({
        success: true,
        job: downloadEngine.toPublicDownloadJob(canceled),
      });
    } catch (error) {
      return sendApiError(
        res,
        hasErrorText(error, "not found") ? 404 : 500,
        error
      );
    }
  });

  app.post("/api/downloads/:id/retry", (req, res) => {
    try {
      const retried = downloadEngine.retryDownloadJob(req.params.id);
      return res.status(202).json({
        success: true,
        job: downloadEngine.toPublicDownloadJob(retried),
      });
    } catch (error) {
      if (hasErrorText(error, "not found")) {
        return sendApiError(res, 404, error);
      }
      if (hasErrorText(error, "already in progress", "Retry data unavailable")) {
        return sendApiError(res, 400, error);
      }
      return sendApiError(res, 500, error);
    }
  });

  app.get("/api/downloads/:id", (req, res) => {
    const job = downloadEngine.getDownloadJob(req.params.id);
    if (!job) {
      return sendApiError(res, 404, "Download job not found");
    }
    return res.json({
      success: true,
      job: downloadEngine.toPublicDownloadJob(job),
    });
  });

  app.get("/api/stream/:id", async (req, res) => {
    try {
      const filename = downloadEngine.getDownloadedFilename(req.params.id);
      if (!filename) {
        return sendStreamError(res, 404, "File not found");
      }
      return streamFile(path.join(songsDir, filename), req, res);
    } catch (error) {
      return sendStreamError(res, 500, error);
    }
  });
}
