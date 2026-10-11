import { NextRequest, NextResponse } from "next/server";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const CLIPS_DIR = path.join(process.cwd(), "public", "clips");

function ensureClipsDir() {
  if (!fs.existsSync(CLIPS_DIR)) {
    fs.mkdirSync(CLIPS_DIR, { recursive: true });
  }
}

// GET /api/clip - List saved server clips
export async function GET() {
  try {
    ensureClipsDir();
    const files = fs.readdirSync(CLIPS_DIR);
    const clips = files
      .filter((file) => file.endsWith(".mp4"))
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

// POST /api/clip - Cut segment via FFmpeg
export async function POST(req: NextRequest) {
  try {
    ensureClipsDir();

    if (!ffmpegPath) {
      return NextResponse.json(
        { success: false, error: "FFmpeg binary is not available on this server." },
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
        { success: false, error: "Missing or invalid streamUrl parameter." },
        { status: 400 }
      );
    }

    const start = Math.max(0, Number(startTime) || 0);
    const end = Number(endTime);

    if (isNaN(end) || end <= start) {
      return NextResponse.json(
        { success: false, error: "Invalid start or end time: end time must be greater than start time." },
        { status: 400 }
      );
    }

    const duration = end - start;
    if (duration > 900) {
      return NextResponse.json(
        { success: false, error: "Maximum clip duration is 15 minutes (900 seconds)." },
        { status: 400 }
      );
    }

    const clipId = `healcut_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const outputFilename = `${clipId}.mp4`;
    const outputPath = path.join(CLIPS_DIR, outputFilename);

    // Build FFmpeg command
    await new Promise<void>((resolve, reject) => {
      let command = ffmpeg(streamUrl)
        .setStartTime(start)
        .setDuration(duration);

      // Video aspect ratio transformation filters
      if (aspectRatio === "9:16") {
        // Center crop to 9:16 vertical and scale to 1080x1920
        command = command
          .videoFilters([
            "crop=ih*(9/16):ih",
            "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
          ])
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions(["-preset", "veryfast", "-crf", "22", "-movflags", "+faststart"]);
      } else if (aspectRatio === "1:1") {
        // Center crop to 1:1 square and scale to 1080x1080
        command = command
          .videoFilters([
            "crop=ih:ih",
            "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2",
          ])
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions(["-preset", "veryfast", "-crf", "22", "-movflags", "+faststart"]);
      } else {
        // 16:9 standard - high quality fast encode with web faststart
        command = command
          .videoCodec("libx264")
          .audioCodec("aac")
          .outputOptions(["-preset", "veryfast", "-crf", "22", "-movflags", "+faststart"]);
      }

      command
        .on("start", (cmd) => {
          console.log("[HealCUT FFmpeg] Started:", cmd);
        })
        .on("error", (err, stdout, stderr) => {
          console.error("[HealCUT FFmpeg] Error:", err.message, stderr);
          reject(new Error(err.message || stderr || "FFmpeg process error"));
        })
        .on("end", () => {
          console.log("[HealCUT FFmpeg] Finished:", outputFilename);
          resolve();
        })
        .save(outputPath);
    });

    const fileStats = fs.statSync(outputPath);

    return NextResponse.json({
      success: true,
      clip: {
        id: clipId,
        title,
        fileName: outputFilename,
        downloadUrl: `/clips/${outputFilename}`,
        startTime: start,
        endTime: end,
        duration: Math.round(duration),
        aspectRatio,
        sizeBytes: fileStats.size,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    console.error("[HealCUT API Error]:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Clip processing failed",
      },
      { status: 500 }
    );
  }
}

// DELETE /api/clip?id=... - Delete a server clip
export async function DELETE(req: NextRequest) {
  try {
    ensureClipsDir();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing clip id parameter" },
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
