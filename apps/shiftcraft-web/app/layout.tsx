import type { Metadata } from "next";
import Script from "next/script";
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// "Workforce Studio" type system: Bricolage (display), Hanken (body),
// JetBrains Mono (all time/count/cost numerals + uppercase labels).
const displayFont = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-bricolage",
  display: "swap",
});

const bodyFont = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-hanken",
  display: "swap",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "ShiftCraft", template: "%s — ShiftCraft" },
  description: "Employee shift scheduling for any team",
};

// Set the `.dark` class before paint so the theme never flashes. Reads the
// persisted choice first, then falls back to the OS preference.
//
// Delivered via next/script with strategy="beforeInteractive" rather than a
// raw <script> in <head>: React 19 refuses to execute inline scripts during
// client renders and logs a console error for them. next/script injects the
// inline source into the initial server HTML before hydration, so it still
// runs before paint (no theme flash) but without tripping that warning.
const themeBootstrap = `(function(){try{var t=localStorage.getItem('sc-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
      <body className="min-h-screen bg-background font-body text-foreground antialiased">
        <Script id="sc-theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
        {children}
      </body>
    </html>
  );
}
