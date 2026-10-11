import path from "path";
import fs from "fs";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";

export function getFfmpegBinary(): string | null {
  // Check direct static path in node_modules
  const localPath = path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // Check if ffmpeg-static resolved path exists
  if (ffmpegPath && fs.existsSync(ffmpegPath)) {
    return ffmpegPath;
  }

  // Check system PATH
  return "ffmpeg";
}

const resolvedPath = getFfmpegBinary();
if (resolvedPath) {
  ffmpeg.setFfmpegPath(resolvedPath);
}

export default ffmpeg;
