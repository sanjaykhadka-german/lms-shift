"use client";

import { ChevronsUpDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { switchTenantAction } from "../_actions";

interface TenantOption {
  id: string;
  name: string;
  role: string;
}

export function TenantSwitcher({
  active,
  options,
}: {
  active: TenantOption;
  options: TenantOption[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-[color:var(--accent)]"
        >
          <span className="max-w-[12rem] truncate">{active.name}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-[color:var(--muted-foreground)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((opt) => (
          <DropdownMenuItem key={opt.id} asChild>
            <form action={switchTenantAction}>
              <input type="hidden" name="tenantId" value={opt.id} />
              <button
                type="submit"
                className="flex w-full items-center justify-between text-left"
              >
                <span className="flex flex-col">
                  <span className="text-sm">{opt.name}</span>
                  <span className="text-xs text-[color:var(--muted-foreground)] capitalize">
                    {opt.role}
                  </span>
                </span>
                {opt.id === active.id && (
                  <Check className="h-4 w-4 text-[color:var(--muted-foreground)]" />
                )}
              </button>
            </form>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
