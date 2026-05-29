import type { Metadata } from "next";
import { Hero } from "./_components/hero";
import { Features } from "./_components/features";
import { Pricing } from "./_components/pricing";
import { Faq } from "./_components/faq";
import { siteConfig } from "~/lib/site-config";

export const metadata: Metadata = {
  title: "Tracey",
  description: siteConfig.description,
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <Features />
      <Pricing />
      <Faq />
    </>
  );
}
