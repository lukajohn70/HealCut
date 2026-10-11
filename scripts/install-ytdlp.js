const fs = require("fs");
const path = require("path");
const https = require("https");

const binDir = path.join(__dirname, "..", "bin");
if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

const platform = process.platform;
let binaryName = "yt-dlp";
if (platform === "darwin") {
  binaryName = "yt-dlp_macos";
} else if (platform === "win32") {
  binaryName = "yt-dlp.exe";
}

const targetPath = path.join(binDir, platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

if (fs.existsSync(targetPath)) {
  console.log("[HealCUT Setup] yt-dlp binary is already present at:", targetPath);
  process.exit(0);
}

const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binaryName}`;
console.log(`[HealCUT Setup] Downloading ${binaryName} from ${url}...`);

function download(downloadUrl, destPath) {
  https.get(downloadUrl, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      return download(res.headers.location, destPath);
    }
    if (res.statusCode !== 200) {
      console.error(`[HealCUT Setup] Failed to download yt-dlp: Status ${res.statusCode}`);
      process.exit(1);
    }

    const fileStream = fs.createWriteStream(destPath);
    res.pipe(fileStream);

    fileStream.on("finish", () => {
      fileStream.close();
      if (platform !== "win32") {
        fs.chmodSync(destPath, 0o755);
      }
      console.log("[HealCUT Setup] yt-dlp installed successfully at:", destPath);
    });
  }).on("error", (err) => {
    console.error("[HealCUT Setup] Error downloading yt-dlp:", err.message);
  });
}

download(url, targetPath);
