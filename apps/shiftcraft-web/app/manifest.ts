import type { MetadataRoute } from "next";

// App-wide PWA manifest so staff can install ShiftCraft to their home screen
// ("Add to home screen") and receive push notifications for shifts. Next.js
// serves this at /manifest.webmanifest and injects the <link rel="manifest">
// on every page. The kiosk keeps its own narrower manifest (public/
// kiosk.webmanifest, scoped to /kiosk) for the on-premise device experience.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ShiftCraft",
    short_name: "ShiftCraft",
    description: "Shifts, time clock, and timesheets for your team.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#17130f",
    theme_color: "#17130f",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
