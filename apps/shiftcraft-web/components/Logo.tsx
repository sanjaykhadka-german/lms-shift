import { cn } from "~/lib/utils";

export function Logo({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const fontSize = size === "lg" ? "text-[2.4rem]" : size === "sm" ? "text-xl" : "text-[1.9rem]";
  return (
    <span
      className={cn("leading-none tracking-tight", fontSize, className)}
      style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
    >
      Shift<span className="italic text-primary">Craft</span>
    </span>
  );
}
