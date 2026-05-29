import Link from "next/link";
import { siteConfig } from "~/lib/site-config";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-[color:var(--border)] py-10 text-sm text-[color:var(--muted-foreground)]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row">
        <div>
          {siteConfig.name} &copy; {year}
        </div>
        <nav className="flex gap-4">
          <Link href="#features" className="hover:text-[color:var(--foreground)]">
            Features
          </Link>
          <Link href="#pricing" className="hover:text-[color:var(--foreground)]">
            Pricing
          </Link>
          <Link href="#faq" className="hover:text-[color:var(--foreground)]">
            FAQ
          </Link>
          <a
            href={`mailto:${siteConfig.contact.sales}`}
            className="hover:text-[color:var(--foreground)]"
          >
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
