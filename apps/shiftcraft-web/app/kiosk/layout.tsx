import type { Metadata, Viewport } from "next";
import { RegisterServiceWorker } from "./_register-sw";

// Kiosk-only shell. Intentionally separate from /app/* — no Auth.js session,
// no Sidebar, no /app navigation. The kiosk runs as the device, not as a
// user; the user identity lives in a short-lived cookie only after PIN entry
// (see lib/kiosk/cookies.ts). Fullscreen dark surface so a tablet wall-
// mounted at the workplace reads from across the room.
//
// The kiosk-scoped web manifest + service worker make this section
// installable as a standalone PWA ("Install app" / Add to home screen) so a
// dedicated tablet can run it like a native kiosk app.
export const metadata: Metadata = {
  title: "ShiftCraft Kiosk",
  manifest: "/kiosk.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Kiosk",
  },
};

// Lock zoom on the kiosk surface only. On a budget digitiser an accidental
// pinch / double-tap magnifies the page and shifts every key off-target — the
// classic "missed key" failure. Scoped to /kiosk/* via this layout, so /app/*
// keeps normal pinch-zoom. Acceptable a11y tradeoff for a fixed kiosk.
export const viewport: Viewport = {
  themeColor: "#17130f",
  maximumScale: 1,
  userScalable: false,
};

export default function KioskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dark min-h-screen touch-manipulation overscroll-contain bg-[#17130f] text-[#f4eee3] antialiased [touch-action:manipulation] [overscroll-behavior:contain]">
      <RegisterServiceWorker />
      {children}
    </div>
  );
}
