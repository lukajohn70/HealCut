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

async function resolveDirectStreams(url: string): Promise<{ videoUrl: string; audioUrl?: string; isHls: boolean }> {
  if (url.includes(".m3u8")) {
    return { videoUrl: url, isHls: true };
  }

  const ytDlp = getYtDlpBinary();
  const node = getNodeBinary();
  const target = url.startsWith("http") ? url : `https://www.youtube.com/watch?v=${url.trim()}`;

  const cmd = `"${ytDlp}" --js-runtimes node:"${node}" -g "${target}"`;
  console.log("[HealCUT Resolve] Resolving stream URL with command:", cmd);

  const { stdout } = await execAsync(cmd, { maxBuffer: 1024 * 1024 * 20 });
  const lines = stdout.trim().split("\n").map((l) => l.trim()).filter((l) => l.startsWith("http"));

  if (!lines.length) {
    throw new Error("Could not extract a live stream URL. Please ensure the stream is currently live or public.");
  }

  const isHls = lines[0].includes(".m3u8");
  if (!isHls && lines.length >= 2) {
    return { videoUrl: lines[0], audioUrl: lines[1], isHls: false };
  }

  return { videoUrl: lines[0], isHls };
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

// POST /api/clip - True direct stream extraction and segment cutting
export async function POST(req: NextRequest) {
  try {
    ensureClipsDir();

    const ffmpegBin = getFfmpegBinary();
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
        { success: false, error: "Missing or empty streamUrl parameter." },
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
        { success: false, error: "Maximum clip duration is 30 minutes." },
        { status: 400 }
      );
    }

    const clipId = `healcut_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const finalFilename = `${clipId}.mp4`;
    const finalPath = path.join(CLIPS_DIR, finalFilename);

    // 1. Resolve raw direct stream URLs (HLS m3u8 or raw video/audio endpoints)
    const { videoUrl, audioUrl, isHls } = await resolveDirectStreams(streamUrl);
    console.log(`[HealCUT Direct Stream] isHls=${isHls}, video=${videoUrl.slice(0, 60)}...`);

    // 2. Direct FFmpeg extraction
    await new Promise<void>((resolve, reject) => {
      let command = ffmpeg();

      // Configure input streams
      command = command
        .input(videoUrl)
        .inputOption(`-ss ${start}`)
        .inputOption(`-t ${duration}`);

      if (audioUrl) {
        command = command
          .input(audioUrl)
          .inputOption(`-ss ${start}`)
          .inputOption(`-t ${duration}`);
      }

      // Aspect Ratio filter & encoding
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
        // 16:9 Standard
        if (isHls && !audioUrl) {
          // Lossless copy directly from HLS segment stream
          command = command.outputOptions(["-c", "copy", "-movflags", "+faststart"]);
        } else {
          command = command
            .videoCodec("libx264")
            .audioCodec("aac")
            .outputOptions(["-preset", "veryfast", "-crf", "22", "-movflags", "+faststart"]);
        }
      }

      command
        .on("start", (cmd) => {
          console.log("[HealCUT FFmpeg Direct] Executing:", cmd);
        })
        .on("error", (err, stdout, stderr) => {
          console.error("[HealCUT FFmpeg Direct Error]:", err.message, stderr);
          reject(new Error(err.message || stderr || "Stream clipping failed"));
        })
        .on("end", () => {
          console.log("[HealCUT FFmpeg Direct] Complete:", finalFilename);
          resolve();
        })
        .save(finalPath);
    });

    if (!fs.existsSync(finalPath)) {
      throw new Error("Output clip file was not generated.");
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
    console.error("[HealCUT Route Error]:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Direct stream recording failed",
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
