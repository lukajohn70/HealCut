import { NextResponse } from "next/server";
import ffmpegPath from "ffmpeg-static";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function GET() {
  try {
    let ffmpegVersion = "Unknown";
    if (ffmpegPath) {
      try {
        const { stdout } = await execAsync(`"${ffmpegPath}" -version`);
        ffmpegVersion = stdout.split("\n")[0] || "Installed";
      } catch (err: unknown) {
        ffmpegVersion = `Error executing: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    return NextResponse.json({
      status: "ok",
      ffmpeg: {
        path: ffmpegPath || null,
        available: Boolean(ffmpegPath),
        version: ffmpegVersion,
      },
      time: new Date().toISOString(),
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : "Internal error",
      },
      { status: 500 }
    );
  }
}
