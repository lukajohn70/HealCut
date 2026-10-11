import { NextResponse } from "next/server";
import { getFfmpegBinary } from "@/lib/ffmpeg";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function GET() {
  try {
    const binary = getFfmpegBinary();
    let ffmpegVersion = "Unknown";

    if (binary) {
      try {
        const { stdout } = await execAsync(`"${binary}" -version`);
        ffmpegVersion = stdout.split("\n")[0] || "Installed";
      } catch (err: unknown) {
        ffmpegVersion = `Error executing: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    return NextResponse.json({
      status: "ok",
      ffmpeg: {
        path: binary,
        available: Boolean(binary && !ffmpegVersion.startsWith("Error")),
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
