import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HealCUT — Live Broadcast Clip Studio",
  description:
    "High-speed live stream clipping, DVR rewind, and vertical shorts generation powered by Next.js & FFmpeg.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
