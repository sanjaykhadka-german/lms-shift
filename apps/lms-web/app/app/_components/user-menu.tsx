"use client";

import { useRouter } from "next/navigation";
import { Building2, LogOut, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { signOutAction } from "../_actions";

export function UserMenu({
  name,
  email,
  photoUrl,
  showPlatformLink = false,
}: {
  name: string | null;
  email: string;
  photoUrl?: string | null;
  showPlatformLink?: boolean;
}) {
  const router = useRouter();
  const initials = (name ?? email).slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="User menu"
          className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[color:var(--secondary)] text-sm font-medium text-[color:var(--secondary-foreground)] transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-[color:var(--foreground)]">
              {name ?? "Account"}
            </span>
            <span className="text-xs text-[color:var(--muted-foreground)]">{email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            router.push("/app/profile");
          }}
          className="cursor-pointer"
        >
          <User className="mr-2 h-4 w-4" />
          Profile
        </DropdownMenuItem>
        {showPlatformLink && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              router.push("/platform");
            }}
            className="cursor-pointer"
          >
            <Building2 className="mr-2 h-4 w-4" />
            Tracey Platform
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            // Prevent Radix from closing the menu *before* the action runs;
            // signOut() redirects, so the menu vanishes anyway.
            e.preventDefault();
            void signOutAction();
          }}
          className="cursor-pointer"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
