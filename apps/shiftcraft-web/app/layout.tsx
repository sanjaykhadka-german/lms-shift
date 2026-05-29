import type { Metadata } from "next";
import { Cormorant_Garamond } from "next/font/google";
import "./globals.css";

const headingFont = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "ShiftCraft", template: "%s — ShiftCraft" },
  description: "Employee shift scheduling for hospitality teams",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={headingFont.variable}>
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
