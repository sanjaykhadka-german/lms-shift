// Kiosk-only shell. Intentionally separate from /app/* — no Auth.js session,
// no Sidebar, no /app navigation. The kiosk runs as the device, not as a
// user; the user identity lives in a short-lived cookie only after PIN entry
// (see lib/kiosk/cookies.ts). Fullscreen dark surface so a tablet wall-
// mounted at the workplace reads from across the room.
export default function KioskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#17130f] text-[#f4eee3] antialiased">
      {children}
    </div>
  );
}
