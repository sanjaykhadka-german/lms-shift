"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "~/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppButton() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Already running as an installed PWA — never show the button.
    // The matchMedia check needs the browser DOM, so it can't run on the
    // server, which is why this is in an effect rather than initial state.
    if (window.matchMedia?.("(display-mode: standalone)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time install detection; cascading render is unavoidable
      setInstalled(true);
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || !event) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        const ev = event;
        setEvent(null);
        await ev.prompt();
        try {
          await ev.userChoice;
        } catch {
          // User dismissed; nothing to do.
        }
      }}
    >
      <Download aria-hidden />
      Install app
    </Button>
  );
}
