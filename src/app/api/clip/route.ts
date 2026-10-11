import { NextRequest, NextResponse } from "next/server";
import ffmpeg, { getFfmpegBinary, getYtDlpBinary, getNodeBinary } from "@/lib/ffmpeg";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const CLIPS_DIR = path.join(process.cwd(), "public", "clips");

function ensureClipsDir() {
  if (!fs.existsSync(CLIPS_DIR)) {
    fs.mkdirSync(CLIPS_DIR, { recursive: true });
  }
}

function formatSecs(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

// GET /api/clip - List saved clips
export async function GET() {
  try {
    ensureClipsDir();
    const files = fs.readdirSync(CLIPS_DIR);
    const clips = files
      .filter((file) => file.endsWith(".mp4") && !file.startsWith("temp_"))
      .map((file) => {
        const filePath = path.join(CLIPS_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          id: file.replace(".mp4", ""),
          fileName: file,
          url: `/clips/${file}`,
          sizeBytes: stats.size,
          createdAt: stats.birthtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ success: true, clips });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to list clips" },
      { status: 500 }
    );
  }
}

// POST /api/clip - Direct stream recording and cutting
export async function POST(req: NextRequest) {
  try {
    ensureClipsDir();

    const ffmpegBin = getFfmpegBinary();
    const ytDlpBin = getYtDlpBinary();
    const nodeBin = getNodeBinary();

    if (!ffmpegBin) {
      return NextResponse.json(
        { success: false, error: "FFmpeg binary is unavailable on the server." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const {
      streamUrl,
      startTime = 0,
      endTime,
      aspectRatio = "16:9",
      title = "Live Highlight",
    } = body;

    if (!streamUrl || typeof streamUrl !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing streamUrl parameter." },
        { status: 400 }
      );
    }

    const start = Math.max(0, Number(startTime) || 0);
    const end = Number(endTime);

    if (isNaN(end) || end <= start) {
      return NextResponse.json(
        { success: false, error: "End time must be greater than start time." },
        { status: 400 }
      );
    }

    const duration = end - start;
    if (duration > 1800) {
      return NextResponse.json(
        { success: false, error: "Maximum clip length is 30 minutes." },
        { status: 400 }
      );
    }

    const clipId = `healcut_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const finalFilename = `${clipId}.mp4`;
    const finalPath = path.join(CLIPS_DIR, finalFilename);

    const isYouTube =
      streamUrl.includes("youtube.com") ||
      streamUrl.includes("youtu.be") ||
      /^[a-zA-Z0-9_-]{11}$/.test(streamUrl.trim());

    if (isYouTube) {
      // Direct stream segment download via yt-dlp & FFmpeg
      const sectionArg = `*${formatSecs(start)}-${formatSecs(end)}`;
      const tempFilename = `temp_${clipId}.mp4`;
      const tempPath = path.join(CLIPS_DIR, tempFilename);

      const targetUrl = streamUrl.includes("http")
        ? streamUrl
        : `https://www.youtube.com/watch?v=${streamUrl.trim()}`;

      const cmd = `"${ytDlpBin}" --js-runtimes node:"${nodeBin}" --ffmpeg-location "${ffmpegBin}" --download-sections "${sectionArg}" --force-keyframes-at-cuts -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" -o "${tempPath}" "${targetUrl}"`;

      console.log("[HealCUT Direct Record] Running:", cmd);

      try {
        await execAsync(cmd, { maxBuffer: 1024 * 1024 * 50 });
      } catch (ytErr: any) {
        console.error("[HealCUT Direct Record Error]:", ytErr);
        throw new Error(
          ytErr.stderr || ytErr.message || "Failed to download live stream segment directly."
        );
      }

      // Check if temp file was downloaded
      if (!fs.existsSync(tempPath)) {
        throw new Error("Direct recording file could not be produced for this segment.");
      }

      // If aspect ratio adjustment is required (e.g. 9:16 Shorts or 1:1 Square)
      if (aspectRatio === "9:16") {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(tempPath)
            .videoFilters([
              "crop=ih*(9/16):ih",
              "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
            ])
            .videoCodec("libx264")
            .audioCodec("aac")
            .outputOptions(["-preset", "veryfast", "-crf", "22", "-movflags", "+faststart"])
            .on("error", (err) => reject(err))
            .on("end", () => {
              fs.unlinkSync(tempPath);
              resolve();
            })
            .save(finalPath);
        });
      } else if (aspectRatio === "1:1") {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(tempPath)
            .videoFilters([
              "crop=ih:ih",
              "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2",
            ])
            .videoCodec("libx264")
            .audioCodec("aac")
            .outputOptions(["-preset", "veryfast", "-crf", "22", "-movflags", "+faststart"])
            .on("error", (err) => reject(err))
            .on("end", () => {
              fs.unlinkSync(tempPath);
              resolve();
            })
            .save(finalPath);
        });
      } else {
        // 16:9 - Rename directly (lossless)
        fs.renameSync(tempPath, finalPath);
      }
    } else {
      // Direct HLS / Media stream (.m3u8, RTMP, HTTP live feed)
      await new Promise<void>((resolve, reject) => {
        let command = ffmpeg(streamUrl)
          .setStartTime(start)
          .setDuration(duration);

        if (aspectRatio === "9:16") {
          command = command
            .videoFilters([
              "crop=ih*(9/16):ih",
              "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
            ])
            .videoCodec("libx264")
            .audioCodec("aac")
            .outputOptions(["-preset", "veryfast", "-crf", "22", "-movflags", "+faststart"]);
        } else if (aspectRatio === "1:1") {
          command = command
            .videoFilters([
              "crop=ih:ih",
              "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2",
            ])
            .videoCodec("libx264")
            .audioCodec("aac")
            .outputOptions(["-preset", "veryfast", "-crf", "22", "-movflags", "+faststart"]);
        } else {
          command = command
            .outputOptions(["-c", "copy", "-movflags", "+faststart"]);
        }

        command
          .on("error", (err) => reject(err))
          .on("end", () => resolve())
          .save(finalPath);
      });
    }

    const fileStats = fs.statSync(finalPath);

    return NextResponse.json({
      success: true,
      clip: {
        id: clipId,
        title,
        fileName: finalFilename,
        downloadUrl: `/clips/${finalFilename}`,
        startTime: start,
        endTime: end,
        duration: Math.round(duration),
        aspectRatio,
        sizeBytes: fileStats.size,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    console.error("[HealCUT Clip Error]:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Direct recording failed",
      },
      { status: 500 }
    );
  }
}

// DELETE /api/clip?id=... - Delete clip
export async function DELETE(req: NextRequest) {
  try {
    ensureClipsDir();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing clip id" },
        { status: 400 }
      );
    }

    const safeId = path.basename(id);
    const filePath = path.join(CLIPS_DIR, `${safeId}.mp4`);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return NextResponse.json({ success: true, message: "Clip deleted" });
    } else {
      return NextResponse.json(
        { success: false, error: "Clip not found" },
        { status: 404 }
      );
    }
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Delete failed" },
      { status: 500 }
    );
  }
}
