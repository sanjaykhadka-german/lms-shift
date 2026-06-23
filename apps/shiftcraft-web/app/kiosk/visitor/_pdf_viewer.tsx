"use client";

import { useEffect, useRef, useState } from "react";

// Inline PDF viewer for the visitor-policy popup. Renders the PDF onto canvases
// with pdfjs-dist (legacy build for older tablets) so it displays reliably on
// iOS Safari and Android — an <iframe>/<embed> depends on a native browser PDF
// plugin those devices lack (they show a download stub instead).
//
// pdfjs is imported dynamically so it stays out of the main kiosk bundle until
// the popup actually opens. The worker is served as a static file from /public
// (see public/pdf.worker.min.mjs) — it is VERSION-LOCKED to the pdfjs-dist
// version in package.json; re-copy it from
// node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs if that dep is bumped.

const WORKER_SRC = "/pdf.worker.min.mjs";

export function PdfViewer({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;

        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }

        // Render at the container's content width, capped so a wide desktop
        // modal doesn't render a huge canvas. devicePixelRatio keeps text crisp
        // on high-DPI tablet screens.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssWidth = Math.min(container.clientWidth || 600, 900);

        // Clear any previous render (StrictMode double-invoke / re-mount).
        container.replaceChildren();

        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          const page = await doc.getPage(pageNum);
          if (cancelled) break;

          const base = page.getViewport({ scale: 1 });
          const scale = cssWidth / base.width;
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          canvas.style.marginBottom = "12px";
          canvas.style.borderRadius = "4px";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          container.appendChild(canvas);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }

        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          console.error("[PdfViewer] render failed:", err);
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="relative flex-1 overflow-y-auto bg-white p-3">
      <div ref={containerRef} className="mx-auto max-w-[900px]" />

      {status === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-[#766b5e]">
          Loading policy…
        </div>
      ) : null}

      {status === "error" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-[#1a1512]">
            The policy couldn&apos;t be displayed here.
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-[var(--accent-ink)]"
          >
            Open / Download the policy
          </a>
        </div>
      ) : null}
    </div>
  );
}
