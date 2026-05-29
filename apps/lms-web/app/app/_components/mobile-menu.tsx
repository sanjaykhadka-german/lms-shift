"use client";

import { useRouter } from "next/navigation";
import { CreditCard, GraduationCap, Menu, Settings, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

interface Props {
  isAdminOrOwner: boolean;
}

export function MobileMenu({ isAdminOrOwner }: Props) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open navigation menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[color:var(--border)] bg-[color:var(--background)] text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--secondary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)] sm:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            router.push("/app/my/modules");
          }}
          className="cursor-pointer"
        >
          <GraduationCap className="mr-2 h-4 w-4" />
          Training
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            router.push("/app/members");
          }}
          className="cursor-pointer"
        >
          <Users className="mr-2 h-4 w-4" />
          Team
        </DropdownMenuItem>
        {isAdminOrOwner && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                router.push("/app/billing");
              }}
              className="cursor-pointer"
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Billing
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                router.push("/app/admin");
              }}
              className="cursor-pointer"
            >
              <Settings className="mr-2 h-4 w-4" />
              Admin
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
