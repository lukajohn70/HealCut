# HealCUT — Live Broadcast Clip Studio

**HealCUT** is a full-stack broadcast clipping studio built with **Next.js 16**, **React 19**, **TypeScript**, and **FFmpeg**. It allows live streaming operators (ministrations, conferences, and broadcasts) to rewind, scrub, and generate high-speed clips and vertical shorts without interrupting the ongoing livestream.

---

## ✨ Features

- **Live DVR Scrubbing**: Rewind through YouTube Live DVR buffer while the broadcast continues running in real time.
- **Dual Export Engines**:
  - **Server-Side FFmpeg Engine**: Fast background stream segmenting and clipping with bundled FFmpeg 6.1.1.
  - **Browser Studio Engine**: Client-side canvas cropping and direct tab capture fallback for zero-server environments.
- **Aspect Ratio Presets & Framing Guides**:
  - `16:9` Landscape (Full widescreen)
  - `9:16` Vertical Shorts / Reels / TikTok (Center framing guide overlay)
  - `1:1` Square (Feed & social posts)
- **Precision Timecode & Transport Controls**:
  - Real-time scrub bar and dual IN / OUT marker range handles.
  - Quick transport buttons: `-5s`, `+5s`, `Set IN [I]`, `Set OUT [O]`, and `Jump to Live [L]`.
- **Keyboard Shortcuts**:
  - `Space`: Play / Pause
  - `I`: Set IN point to current playhead
  - `O`: Set OUT point to current playhead
  - `L`: Jump to Live Edge
  - `←` / `→`: Step backward / forward 5 seconds
- **Session Clip Queue**:
  - Tracks all generated clips during the session with timecode range, aspect ratio tags, duration, and file size.
  - Instant one-click MP4 download.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ (tested on Node.js 25.x)
- npm 9+

### Installation

```bash
git clone https://github.com/lukajohn70/HealCut.git
cd HealCut
npm install
```

### Running Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
npm run build
npm run start
```

---

## 📡 API Endpoints

- `GET /api/health` — Checks FFmpeg availability, system binary path, and version.
- `GET /api/clip` — Lists all generated clips saved on the server.
- `POST /api/clip` — Extracts a clip via FFmpeg from a stream URL with custom `startTime`, `endTime`, and `aspectRatio`.
- `DELETE /api/clip?id={clipId}` — Removes a saved clip.

---

## 📄 License
MIT License.
