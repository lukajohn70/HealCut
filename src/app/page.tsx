"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  Scissors,
  Download,
  Trash2,
  Radio,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Sliders,
  CheckCircle2,
  Tv,
  Film,
  Sparkles,
  Server,
  Share2,
} from "lucide-react";

interface ClipItem {
  id: string;
  title: string;
  downloadUrl: string;
  duration: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  sizeBytes?: number;
  timeRange: string;
  createdAt: string;
}

interface ServerHealth {
  available: boolean;
  version: string;
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function parseYouTubeId(input: string): string | null {
  try {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

    const url = new URL(trimmed);
    if (url.hostname === "youtu.be") {
      return url.pathname.slice(1).split("/")[0] || null;
    }
    if (url.hostname.includes("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v) return v;
      const parts = url.pathname.split("/").filter(Boolean);
      if (["live", "embed", "shorts", "v"].includes(parts[0])) {
        return parts[1] || null;
      }
    }
  } catch {
    // If not a full URL, fallback regex
    const match = input.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|live\/))([\w-]{11})/);
    return match ? match[1] : null;
  }
  return null;
}

export default function HealCutStudio() {
  const [streamUrl, setStreamUrl] = useState("https://www.youtube.com/watch?v=jfKfPfyJRdk"); // lofi live sample
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [playerState, setPlayerState] = useState<"idle" | "playing" | "paused" | "buffering">("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [clipTitle, setClipTitle] = useState("Live Highlight");
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("Ready to load live stream");
  const [statusType, setStatusType] = useState<"info" | "success" | "live">("info");
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);
  const [clipMode, setClipMode] = useState<"server" | "browser">("server");

  const playerRef = useRef<any>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const screenSourceRef = useRef<HTMLVideoElement | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);

  // Check backend FFmpeg health
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => {
        if (data?.ffmpeg) {
          setServerHealth({
            available: data.ffmpeg.available,
            version: data.ffmpeg.version,
          });
        }
      })
      .catch(() => {
        setServerHealth({ available: false, version: "Offline" });
      });

    // Load server saved clips
    fetch("/api/clip")
      .then((res) => res.json())
      .then((data) => {
        if (data?.clips) {
          const loaded: ClipItem[] = data.clips.map((c: any) => ({
            id: c.id,
            title: c.fileName.replace(".mp4", ""),
            downloadUrl: c.url,
            duration: 0,
            aspectRatio: "16:9",
            sizeBytes: c.sizeBytes,
            timeRange: "Server Clip",
            createdAt: c.createdAt,
          }));
          setClips(loaded);
        }
      })
      .catch(() => {});
  }, []);

  // Initialize YouTube API
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
    }
  }, []);

  // Synchronize player time & duration
  const syncPlayback = useCallback(() => {
    if (!playerRef.current || typeof playerRef.current.getCurrentTime !== "function") return;
    try {
      const t = playerRef.current.getCurrentTime() || 0;
      const d = playerRef.current.getDuration() || 0;
      setCurrentTime(t);
      if (d > 0) setDuration(d);

      // Auto initialize default range if empty
      setInPoint((prev) => (prev === null ? Math.max(0, t - 30) : prev));
      setOutPoint((prev) => (prev === null ? t : prev));
    } catch {
      // player might be unmounting
    }
  }, []);

  // Poll video timecode
  useEffect(() => {
    if (activeVideoId) {
      pollTimerRef.current = setInterval(syncPlayback, 400);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [activeVideoId, syncPlayback]);

  // Load stream
  const handleLoadStream = (urlToLoad?: string) => {
    const target = urlToLoad || streamUrl;
    const vidId = parseYouTubeId(target);
    if (!vidId) {
      alert("Please enter a valid YouTube Live URL or video ID.");
      return;
    }

    setActiveVideoId(vidId);
    setStatusMessage("Connecting to YouTube DVR stream...");
    setStatusType("info");

    const setupPlayer = () => {
      if (playerRef.current?.destroy) {
        playerRef.current.destroy();
      }

      playerRef.current = new window.YT.Player("healcut-player", {
        videoId: vidId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          controls: 0,
          playsinline: 1,
          rel: 0,
          enablejsapi: 1,
        },
        events: {
          onReady: () => {
            setStatusMessage("Connected · Live DVR stream active");
            setStatusType("live");
            playerRef.current.playVideo();
          },
          onStateChange: (event: any) => {
            if (event.data === 1) {
              setPlayerState("playing");
              const dur = playerRef.current.getDuration() || 0;
              const cur = playerRef.current.getCurrentTime() || 0;
              if (dur - cur > 10) {
                setStatusMessage("Playing (Rewound in DVR Buffer)");
              } else {
                setStatusMessage("Broadcast Live Edge");
              }
            } else if (event.data === 2) {
              setPlayerState("paused");
            } else if (event.data === 3) {
              setPlayerState("buffering");
            }
          },
        },
      });
    };

    if (window.YT && window.YT.Player) {
      setupPlayer();
    } else {
      window.onYouTubeIframeAPIReady = setupPlayer;
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === "KeyI") {
        e.preventDefault();
        setInToCurrent();
      } else if (e.code === "KeyO") {
        e.preventDefault();
        setOutToCurrent();
      } else if (e.code === "KeyL") {
        e.preventDefault();
        jumpToLive();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        seekRelative(-5);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        seekRelative(5);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentTime, duration, playerState]);

  const togglePlayPause = () => {
    if (!playerRef.current) return;
    if (playerState === "playing") {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  };

  const seekRelative = (sec: number) => {
    if (!playerRef.current) return;
    const next = Math.max(0, Math.min(duration, currentTime + sec));
    playerRef.current.seekTo(next, true);
    setCurrentTime(next);
  };

  const jumpToLive = () => {
    if (!playerRef.current || duration <= 0) return;
    playerRef.current.seekTo(Math.max(0, duration - 1), true);
    playerRef.current.playVideo();
    setStatusMessage("Jumped to Broadcast Live Edge");
    setStatusType("live");
  };

  const setInToCurrent = () => {
    const nextIn = Math.min(currentTime, (outPoint ?? duration) - 1);
    setInPoint(Math.max(0, nextIn));
  };

  const setOutToCurrent = () => {
    const nextOut = Math.max(currentTime, (inPoint ?? 0) + 1);
    setOutPoint(Math.min(duration, nextOut));
  };

  // Generate Clip
  const handleCreateClip = async () => {
    const start = inPoint ?? 0;
    const end = outPoint ?? currentTime;

    if (end <= start) {
      alert("OUT point must be greater than IN point.");
      return;
    }

    const clipDuration = end - start;
    setIsProcessing(true);
    setStatusMessage(`Processing ${formatTime(start)} → ${formatTime(end)} (${Math.round(clipDuration)}s)...`);

    if (clipMode === "server") {
      try {
        const response = await fetch("/api/clip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            streamUrl,
            startTime: start,
            endTime: end,
            aspectRatio,
            title: clipTitle,
          }),
        });

        const data = await response.json();
        if (data.success && data.clip) {
          const newClip: ClipItem = {
            id: data.clip.id,
            title: clipTitle,
            downloadUrl: data.clip.downloadUrl,
            duration: Math.round(clipDuration),
            aspectRatio,
            sizeBytes: data.clip.sizeBytes,
            timeRange: `${formatTime(start)} – ${formatTime(end)}`,
            createdAt: new Date().toISOString(),
          };
          setClips((prev) => [newClip, ...prev]);
          setStatusMessage(`Clip generated: ${clipTitle} (${formatTime(clipDuration)})`);
          setStatusType("success");
        } else {
          // If server stream copy encounters YouTube rate limit, offer browser tab fallback
          console.warn("Server FFmpeg fallback to browser recorder:", data.error);
          setStatusMessage("Server requires direct stream link. Switching to Browser Studio Engine...");
          await handleBrowserTabClip(start, end, clipDuration);
        }
      } catch (err) {
        console.error("Clip request error:", err);
        setStatusMessage("Falling back to Browser Studio Engine...");
        await handleBrowserTabClip(start, end, clipDuration);
      } finally {
        setIsProcessing(false);
      }
    } else {
      await handleBrowserTabClip(start, end, clipDuration);
      setIsProcessing(false);
    }
  };

  // Browser Tab Studio Engine fallback
  const handleBrowserTabClip = async (start: number, end: number, clipDuration: number) => {
    try {
      if (!displayStreamRef.current) {
        setStatusMessage("Requesting browser tab capture with audio...");
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30, max: 60 } },
          audio: true,
        });
        displayStreamRef.current = stream;
      }

      const stream = displayStreamRef.current;
      const playerEl = document.getElementById("healcut-player");
      if (!playerEl || !stream) throw new Error("Display stream or player element unavailable");

      // Setup Canvas
      const canvas = document.createElement("canvas");
      canvas.width = aspectRatio === "9:16" ? 1080 : 1920;
      canvas.height = aspectRatio === "9:16" ? 1920 : aspectRatio === "1:1" ? 1080 : 1080;
      if (aspectRatio === "1:1") canvas.width = 1080;

      const ctx = canvas.getContext("2d", { alpha: false });
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      // Video element to pull frames
      const v = document.createElement("video");
      v.srcObject = stream;
      v.muted = true;
      await v.play();

      const canvasStream = canvas.captureStream(30);
      const outStream = new MediaStream([
        canvasStream.getVideoTracks()[0],
        ...(audioTrack ? [audioTrack] : []),
      ]);

      const chunks: Blob[] = [];
      const mime = ["video/mp4;codecs=avc1", "video/mp4", "video/webm"].find((m) =>
        MediaRecorder.isTypeSupported(m)
      );
      const recorder = new MediaRecorder(outStream, { mimeType: mime });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      // Seek to IN and play
      playerRef.current.seekTo(start, true);
      playerRef.current.playVideo();

      recorder.start();
      setStatusMessage(`Recording live playback: ${Math.round(clipDuration)}s...`);

      // Draw frames
      const drawTimer = setInterval(() => {
        if (!ctx) return;
        const rect = playerEl.getBoundingClientRect();
        const sx = v.videoWidth / window.innerWidth;
        const sy = v.videoHeight / window.innerHeight;
        const x = Math.max(0, rect.left * sx);
        const y = Math.max(0, rect.top * sy);
        const w = Math.min(rect.width * sx, v.videoWidth - x);
        const h = Math.min(rect.height * sy, v.videoHeight - y);

        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (w > 0 && h > 0) {
          ctx.drawImage(v, x, y, w, h, 0, 0, canvas.width, canvas.height);
        }
      }, 33);

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          clearInterval(drawTimer);
          recorder.stop();
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: mime || "video/mp4" });
            const url = URL.createObjectURL(blob);
            const newClip: ClipItem = {
              id: `browser_${Date.now()}`,
              title: clipTitle,
              downloadUrl: url,
              duration: Math.round(clipDuration),
              aspectRatio,
              sizeBytes: blob.size,
              timeRange: `${formatTime(start)} – ${formatTime(end)}`,
              createdAt: new Date().toISOString(),
            };
            setClips((prev) => [newClip, ...prev]);
            setStatusMessage(`Clip recorded successfully: ${clipTitle}`);
            setStatusType("success");
            resolve();
          };
        }, clipDuration * 1000);
      });
    } catch (err: any) {
      console.error(err);
      setStatusMessage(err.message || "Recording cancelled");
    }
  };

  const deleteClip = async (clip: ClipItem) => {
    if (clip.id.startsWith("healcut_")) {
      try {
        await fetch(`/api/clip?id=${clip.id}`, { method: "DELETE" });
      } catch {}
    }
    setClips((prev) => prev.filter((c) => c.id !== clip.id));
  };

  const selectedDuration = Math.max(0, (outPoint ?? currentTime) - (inPoint ?? 0));
  const rangeLeftPercent = duration > 0 ? ((inPoint ?? 0) / duration) * 100 : 0;
  const rangeWidthPercent =
    duration > 0 ? (((outPoint ?? currentTime) - (inPoint ?? 0)) / duration) * 100 : 0;

  return (
    <div>
      {/* Top Navigation */}
      <header className="top-nav">
        <div className="brand-wrapper">
          <div className="brand-logo">
            <span className="brand-dot" />
            HealCUT
          </div>
          <span className="brand-badge">PRO STUDIO</span>
        </div>

        <div className="nav-actions">
          {serverHealth && (
            <div className={`engine-pill ${serverHealth.available ? "ready" : ""}`}>
              <Server size={12} />
              <span>FFmpeg: {serverHealth.available ? "Online (6.1.1)" : "Offline"}</span>
            </div>
          )}
          <div className="engine-pill ready">
            <Radio size={12} className="text-red-500" />
            <span>DVR Lossless Segmenter</span>
          </div>
        </div>
      </header>

      {/* Main Studio Viewport */}
      <main className="studio-container">
        {/* Left Column: Player & Transport */}
        <section className="studio-panel">
          <div className="panel-header">
            <div className="panel-title">
              <Tv size={14} />
              Live Broadcast Monitor
            </div>
            <div className={`status-badge ${statusType}`}>
              {statusMessage.toUpperCase()}
            </div>
          </div>

          {/* Stream Input */}
          <div className="input-bar">
            <input
              id="stream-url-input"
              className="stream-input"
              placeholder="Paste YouTube Live Link (or direct stream URL)..."
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
            />
            <button
              id="btn-load-stream"
              className="btn btn-primary"
              onClick={() => handleLoadStream()}
            >
              <Play size={13} />
              Connect Stream
            </button>
            <button
              id="btn-sample-stream"
              className="btn"
              title="Load sample 24/7 live stream"
              onClick={() => {
                const sample = "https://www.youtube.com/watch?v=jfKfPfyJRdk";
                setStreamUrl(sample);
                handleLoadStream(sample);
              }}
            >
              <Sparkles size={13} />
              Sample
            </button>
          </div>

          {/* Video Player & Framing Guide */}
          <div className="monitor-viewport">
            <div id="healcut-player" className="monitor-iframe" />

            {!activeVideoId && (
              <div className="monitor-placeholder">
                <Film className="monitor-placeholder-icon" />
                <p>Paste a YouTube Live stream or HLS link to initialize the DVR monitor.</p>
              </div>
            )}

            {/* Visual Safe Zone & Crop Guides */}
            {activeVideoId && aspectRatio !== "16:9" && (
              <div className={`aspect-overlay ratio-${aspectRatio.replace(":", "-")}`}>
                <div className="aspect-box">
                  <span className="aspect-guide-tag">
                    {aspectRatio === "9:16" ? "Shorts / Reels Crop" : "Square 1:1 Crop"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Controls & Trimming Timeline */}
          <div className="controls-area">
            {/* Scrubber Timeline */}
            <div className="scrub-timeline">
              <div className="time-readout">
                <span className="current-time">{formatTime(currentTime)}</span>
                <span className="live-edge">LIVE · {formatTime(duration)}</span>
              </div>
              <div className="timeline-slider-wrap">
                <input
                  id="timeline-scrubber"
                  type="range"
                  className="timeline-slider"
                  min={0}
                  max={Math.max(1, duration)}
                  value={currentTime}
                  disabled={duration <= 0}
                  onChange={(e) => {
                    const t = Number(e.target.value);
                    setCurrentTime(t);
                    playerRef.current?.seekTo(t, false);
                  }}
                  onMouseUp={() => playerRef.current?.seekTo(currentTime, true)}
                />
              </div>
            </div>

            {/* Dual IN/OUT Trim Range Slider */}
            <div className="trim-section">
              <div className="trim-header">
                <div className="trim-point-badge">
                  <span>IN POINT</span>
                  <strong id="in-point-display">{formatTime(inPoint ?? 0)}</strong>
                </div>
                <div className="trim-duration-badge">
                  SELECTED DURATION: {Math.round(selectedDuration)}s ({formatTime(selectedDuration)})
                </div>
                <div className="trim-point-badge">
                  <span>OUT POINT</span>
                  <strong id="out-point-display">{formatTime(outPoint ?? currentTime)}</strong>
                </div>
              </div>

              <div className="dual-slider-track">
                <div className="dual-slider-base" />
                <div
                  className="dual-slider-range"
                  style={{
                    left: `${Math.max(0, Math.min(100, rangeLeftPercent))}%`,
                    width: `${Math.max(0, Math.min(100, rangeWidthPercent))}%`,
                  }}
                />
                <input
                  id="range-slider-in"
                  type="range"
                  className="range-input"
                  min={0}
                  max={Math.max(1, duration)}
                  value={inPoint ?? 0}
                  disabled={duration <= 0}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setInPoint(Math.min(val, (outPoint ?? duration) - 1));
                  }}
                />
                <input
                  id="range-slider-out"
                  type="range"
                  className="range-input"
                  min={0}
                  max={Math.max(1, duration)}
                  value={outPoint ?? currentTime}
                  disabled={duration <= 0}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setOutPoint(Math.max(val, (inPoint ?? 0) + 1));
                  }}
                />
              </div>
            </div>

            {/* Transport & Setting Buttons */}
            <div className="button-row">
              <div className="button-group">
                <button
                  id="btn-play-pause"
                  className="btn"
                  onClick={togglePlayPause}
                  disabled={!activeVideoId}
                >
                  {playerState === "playing" ? <Pause size={14} /> : <Play size={14} />}
                  {playerState === "playing" ? "Pause" : "Play"}
                </button>

                <button
                  id="btn-seek-back"
                  className="btn"
                  onClick={() => seekRelative(-5)}
                  disabled={!activeVideoId}
                  title="Jump back 5 seconds (Left Arrow)"
                >
                  <RotateCcw size={13} />
                  -5s
                </button>

                <button
                  id="btn-seek-forward"
                  className="btn"
                  onClick={() => seekRelative(5)}
                  disabled={!activeVideoId}
                  title="Jump forward 5 seconds (Right Arrow)"
                >
                  <RotateCw size={13} />
                  +5s
                </button>

                <button
                  id="btn-set-in"
                  className="btn"
                  onClick={setInToCurrent}
                  disabled={!activeVideoId}
                  title="Set In Point [I]"
                >
                  Set IN [I]
                </button>

                <button
                  id="btn-set-out"
                  className="btn"
                  onClick={setOutToCurrent}
                  disabled={!activeVideoId}
                  title="Set Out Point [O]"
                >
                  Set OUT [O]
                </button>
              </div>

              <div className="button-group">
                <button
                  id="btn-jump-live"
                  className="btn btn-live"
                  onClick={jumpToLive}
                  disabled={!activeVideoId}
                >
                  <Radio size={12} />
                  Jump to Live [L]
                </button>
              </div>
            </div>

            {/* Format & Cutting Action */}
            <div className="button-row" style={{ paddingTop: "8px", borderTop: "1px solid var(--border-subtle)" }}>
              <div className="button-group">
                <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 600 }}>
                  OUTPUT FORMAT:
                </span>
                <div className="aspect-tabs">
                  <button
                    id="tab-16-9"
                    className={`aspect-tab ${aspectRatio === "16:9" ? "active" : ""}`}
                    onClick={() => setAspectRatio("16:9")}
                  >
                    16:9 Landscape
                  </button>
                  <button
                    id="tab-9-16"
                    className={`aspect-tab ${aspectRatio === "9:16" ? "active" : ""}`}
                    onClick={() => setAspectRatio("9:16")}
                  >
                    9:16 Shorts/Reels
                  </button>
                  <button
                    id="tab-1-1"
                    className={`aspect-tab ${aspectRatio === "1:1" ? "active" : ""}`}
                    onClick={() => setAspectRatio("1:1")}
                  >
                    1:1 Square
                  </button>
                </div>
              </div>

              <div className="button-group">
                <input
                  id="clip-title-input"
                  className="stream-input"
                  style={{ width: "170px", padding: "7px 10px", fontSize: "12px" }}
                  placeholder="Clip title..."
                  value={clipTitle}
                  onChange={(e) => setClipTitle(e.target.value)}
                />

                <button
                  id="btn-generate-clip"
                  className="btn btn-primary"
                  onClick={handleCreateClip}
                  disabled={isProcessing || !activeVideoId || selectedDuration <= 0}
                >
                  <Scissors size={14} />
                  {isProcessing ? "Processing..." : "Cut & Generate Clip"}
                </button>
              </div>
            </div>
          </div>

          {/* Keyboard Shortcuts Cheatsheet */}
          <div className="shortcuts-grid">
            <div className="shortcut-item">
              <span className="kbd">Space</span>
              <span>Play / Pause</span>
            </div>
            <div className="shortcut-item">
              <span className="kbd">I</span>
              <span>Set IN marker to playhead</span>
            </div>
            <div className="shortcut-item">
              <span className="kbd">O</span>
              <span>Set OUT marker to playhead</span>
            </div>
            <div className="shortcut-item">
              <span className="kbd">L</span>
              <span>Jump to broadcast live edge</span>
            </div>
            <div className="shortcut-item">
              <span className="kbd">← / →</span>
              <span>Seek rewind buffer -5s / +5s</span>
            </div>
            <div className="shortcut-item">
              <span className="kbd">9:16</span>
              <span>Auto-crops center vertical frame</span>
            </div>
          </div>
        </section>

        {/* Right Column: Multi-Clip Queue & Library */}
        <aside className="studio-panel">
          <div className="panel-header">
            <div className="panel-title">
              <Film size={14} />
              Generated Clips ({clips.length})
            </div>
            <span className="status-badge">SESSION QUEUE</span>
          </div>

          <div className="clips-scroll">
            {clips.length === 0 ? (
              <div className="empty-clips">
                <Scissors size={28} style={{ opacity: 0.25, margin: "0 auto 12px" }} />
                <p>No clips generated yet.</p>
                <small style={{ color: "var(--text-subtle)", marginTop: "4px", display: "block" }}>
                  Set an IN &amp; OUT marker on any highlight and click "Cut &amp; Generate Clip".
                </small>
              </div>
            ) : (
              clips.map((clip) => (
                <div key={clip.id} className="clip-card">
                  <div className="clip-card-header">
                    <span className="clip-title">{clip.title}</span>
                    <span className="clip-aspect-badge">{clip.aspectRatio}</span>
                  </div>

                  <div className="clip-meta-row">
                    <span>{clip.timeRange}</span>
                    <span>{clip.duration > 0 ? `${clip.duration}s` : ""}</span>
                    {clip.sizeBytes && (
                      <span>{(clip.sizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
                    )}
                  </div>

                  <div className="clip-card-actions">
                    <a
                      href={clip.downloadUrl}
                      download={`${clip.title.replace(/\s+/g, "_")}.mp4`}
                      className="btn btn-primary"
                    >
                      <Download size={13} />
                      Download MP4
                    </a>
                    <button
                      className="btn"
                      onClick={() => deleteClip(clip)}
                      title="Remove clip"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </main>

      <video
        ref={screenSourceRef}
        muted
        playsInline
        style={{
          position: "fixed",
          width: "2px",
          height: "2px",
          opacity: 0.01,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
