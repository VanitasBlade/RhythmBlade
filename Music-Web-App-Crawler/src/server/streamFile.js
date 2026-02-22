import fs from "fs";
import path from "path";

const MIME_BY_EXT = {
  ".flac": "audio/flac",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

export async function streamFile(filePath, req, res) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return res.status(404).json({error: "File not found on disk"});
  }

  const contentType = MIME_BY_EXT[path.extname(filePath).toLowerCase()]
    || "application/octet-stream";

  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentType,
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  const parts = range.replace(/^bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": contentType,
  });

  return fs.createReadStream(filePath, {start, end}).pipe(res);
}
