"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

/**
 * Touch / mouse / stylus signature pad. Renders a canvas plus a hidden input
 * (named `name`) that always holds the current signature as a PNG data URL —
 * so it submits cleanly inside a <form action={serverAction}>. Empty when no
 * strokes have been drawn. Clear wipes everything; Undo drops the last stroke.
 */
export function SignaturePad({
  name,
  label = "Signature",
  required = false,
  onInkChange,
}: {
  name: string;
  label?: string;
  required?: boolean;
  /** Fires whenever the signed/empty state changes — lets a parent form gate
   *  its submit button on a signature being present. */
  onInkChange?: (hasInk: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Point[][]>([]);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  // The signature PNG lives in React state and is rendered into a *controlled*
  // hidden input below, so the value submitted with the form is always exactly
  // what's on screen. (An uncontrolled input set imperatively via a ref can
  // submit stale/empty on a re-render — which is what caused "add your
  // signature" even after signing.)
  const [dataUrl, setDataUrl] = useState("");

  // Resize the backing store to match the element's CSS size × DPR so lines
  // stay crisp. Re-draws existing strokes after a resize.
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#17130f";
    for (const stroke of strokesRef.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i]!.x, stroke[i]!.y);
      }
      ctx.stroke();
    }
  }, []);

  const commit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ink = strokesRef.current.some((s) => s.length > 0);
    setHasInk(ink);
    onInkChange?.(ink);
    setDataUrl(ink ? canvas.toDataURL("image/png") : "");
  }, [onInkChange]);

  useEffect(() => {
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    strokesRef.current.push([pointFrom(e)]);
    redraw();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    stroke?.push(pointFrom(e));
    redraw();
  }

  function onPointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    commit();
  }

  function clear() {
    strokesRef.current = [];
    redraw();
    commit();
  }

  function undo() {
    strokesRef.current.pop();
    redraw();
    commit();
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-[#a89c8c]">
          {label}
          {required ? " *" : ""}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={undo}
            className="rounded-md border border-line bg-[rgba(244,238,227,0.1)] px-3 py-1.5 text-xs font-medium text-[#f4eee3] hover:bg-[rgba(244,238,227,0.16)]"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded-md border border-line bg-[rgba(244,238,227,0.1)] px-3 py-1.5 text-xs font-medium text-[#f4eee3] hover:bg-[rgba(244,238,227,0.16)]"
          >
            Clear
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        className="h-44 w-full touch-none rounded-lg border border-[rgba(244,238,227,0.18)] bg-[#f4eee3]"
      />
      <input type="hidden" name={name} value={dataUrl} readOnly />
      {!hasInk ? (
        <p className="mt-1 text-xs text-[#a89c8c]">
          Sign above with your finger, stylus, or mouse.
        </p>
      ) : null}
    </div>
  );
}
