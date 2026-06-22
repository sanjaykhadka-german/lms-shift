"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "~/components/ui/input";

interface ModuleHit {
  id: string;
  title: string;
  url: string;
}
interface EmployeeHit {
  id: string;
  name: string;
  email: string | null;
  url: string;
}
interface LookupHit {
  id: string;
  name: string;
  url: string;
}
interface SearchResult {
  modules: ModuleHit[];
  employees: EmployeeHit[];
  locations: LookupHit[];
  templates: LookupHit[];
}

const EMPTY_RESULT: SearchResult = {
  modules: [],
  employees: [],
  locations: [],
  templates: [],
};

type Flat = {
  kind: "module" | "employee" | "location" | "template";
  label: string;
  sub?: string;
  url: string;
};

// Universal search — jumps to nav modules, employees, locations, and shift
// templates. Backed by /api/search; results are role/scope-gated server-side.
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult>(EMPTY_RESULT);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  // Click-outside closes the dropdown.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Debounced fetch.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults(EMPTY_RESULT);
      return;
    }
    const myReq = ++reqIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        if (!res.ok) return;
        const data = (await res.json()) as SearchResult;
        // Drop stale responses.
        if (myReq !== reqIdRef.current) return;
        setResults(data);
        setHighlight(0);
        setOpen(true);
      } catch {
        // Network error — silently leave the previous results in place.
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  const flat: Flat[] = [
    ...results.modules.map<Flat>((m) => ({ kind: "module", label: m.title, url: m.url })),
    ...results.employees.map<Flat>((e) => ({
      kind: "employee",
      label: e.name,
      sub: e.email ?? undefined,
      url: e.url,
    })),
    ...results.locations.map<Flat>((l) => ({ kind: "location", label: l.name, url: l.url })),
    ...results.templates.map<Flat>((t) => ({ kind: "template", label: t.name, url: t.url })),
  ];

  function navigate(item: Flat) {
    setOpen(false);
    setQ("");
    router.push(item.url);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[highlight];
      if (item) navigate(item);
    }
  }

  // Section offsets into the flat list, in render order.
  const offModules = 0;
  const offEmployees = offModules + results.modules.length;
  const offLocations = offEmployees + results.employees.length;
  const offTemplates = offLocations + results.locations.length;

  return (
    <div ref={containerRef} className="relative hidden w-44 md:block lg:w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          if (flat.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search modules, people, places…"
        aria-label="Search modules, employees, and locations"
        autoComplete="off"
        className="pl-9"
      />
      {open && flat.length > 0 && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-full overflow-y-auto rounded-[var(--r-sm)] border border-line bg-[var(--paper)] shadow-lg"
          style={{ maxHeight: "60vh" }}
          role="listbox"
        >
          {results.modules.length > 0 && (
            <Section label="Modules">
              {results.modules.map((m, idx) => (
                <Row
                  key={`m-${m.id}`}
                  active={highlight === offModules + idx}
                  onClick={() => navigate(flat[offModules + idx]!)}
                  onMouseEnter={() => setHighlight(offModules + idx)}
                  primary={m.title}
                />
              ))}
            </Section>
          )}
          {results.employees.length > 0 && (
            <Section label="People">
              {results.employees.map((e, idx) => (
                <Row
                  key={`e-${e.id}`}
                  active={highlight === offEmployees + idx}
                  onClick={() => navigate(flat[offEmployees + idx]!)}
                  onMouseEnter={() => setHighlight(offEmployees + idx)}
                  primary={e.name}
                  secondary={e.email ?? undefined}
                />
              ))}
            </Section>
          )}
          {results.locations.length > 0 && (
            <Section label="Locations">
              {results.locations.map((l, idx) => (
                <Row
                  key={`l-${l.id}`}
                  active={highlight === offLocations + idx}
                  onClick={() => navigate(flat[offLocations + idx]!)}
                  onMouseEnter={() => setHighlight(offLocations + idx)}
                  primary={l.name}
                />
              ))}
            </Section>
          )}
          {results.templates.length > 0 && (
            <Section label="Shift templates">
              {results.templates.map((t, idx) => (
                <Row
                  key={`t-${t.id}`}
                  active={highlight === offTemplates + idx}
                  onClick={() => navigate(flat[offTemplates + idx]!)}
                  onMouseEnter={() => setHighlight(offTemplates + idx)}
                  primary={t.name}
                />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  active,
  onClick,
  onMouseEnter,
  primary,
  secondary,
}: {
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  primary: string;
  secondary?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={active}
      className={
        "block w-full px-3 py-2 text-left text-sm transition-colors " +
        (active ? "bg-paper-2 text-ink" : "text-ink-2 hover:bg-paper-2")
      }
    >
      <div className="font-medium">{primary}</div>
      {secondary && <div className="text-xs text-ink-3">{secondary}</div>}
    </button>
  );
}
