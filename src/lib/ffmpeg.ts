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

export function getYtDlpBinary(): string | null {
  const localBin = path.join(process.cwd(), "bin", "yt-dlp");
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return "yt-dlp";
}

export function getNodeBinary(): string {
  if (fs.existsSync("/usr/local/bin/node")) return "/usr/local/bin/node";
  if (fs.existsSync("/opt/homebrew/bin/node")) return "/opt/homebrew/bin/node";
  return process.execPath || "node";
}

const resolvedPath = getFfmpegBinary();
if (resolvedPath) {
  ffmpeg.setFfmpegPath(resolvedPath);
}

export default ffmpeg;
