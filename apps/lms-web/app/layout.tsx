import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond } from "next/font/google";
import { siteConfig } from "~/lib/site-config";
import { RegisterServiceWorker } from "~/components/pwa/RegisterServiceWorker";
import "./globals.css";

const headingFont = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: siteConfig.name, template: `%s — ${siteConfig.name}` },
  description: siteConfig.description,
  metadataBase: new URL(siteConfig.url),
  manifest: "/manifest.webmanifest",
  applicationName: siteConfig.name,
  appleWebApp: {
    capable: true,
    title: siteConfig.name,
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#8b1a1a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={headingFont.variable}>
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
