"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutDashboard, LogOut, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { authClient } from "@/lib/auth/auth-client";
import { cn } from "@/lib/utils";

type UserMenuProps = Readonly<{
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
  className?: string;
}>;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts.at(0)!.at(0)! + parts.at(-1)!.at(0)!).toUpperCase();
}

/**
 * Authenticated User Navigation Menu.
 * Built with @base-ui/react primitives via shadcn/ui.
 * Adheres to AGENTS.md §5.1, §5.3, §5.4, and DESIGN.md.
 */
export function UserMenu({ user, className }: UserMenuProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const router = useRouter();

  const handleSignOut = async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);
    try {
      await authClient.signOut();
      router.push("/");
      router.refresh();
    } catch (err) {
      console.error("[Foundry Auth] Error during sign-out:", err);
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50 transition-opacity hover:opacity-90 cursor-pointer",
              className,
            )}
            aria-label={`User menu for ${user.name}`}
          >
            <Avatar size="sm">
              {user.image ? (
                <AvatarImage src={user.image} alt={user.name} />
              ) : null}
              <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
            </Avatar>
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-56 p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5">
            <span className="text-xs font-semibold text-foreground truncate">
              {user.name}
            </span>
            <span className="text-[11px] font-normal text-muted-foreground truncate">
              {user.email}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={
            <Link
              href="/workspace"
              prefetch={false}
              className="flex items-center gap-2 px-2 py-1.5 text-xs text-foreground cursor-pointer"
            >
              <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Workspace</span>
            </Link>
          }
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer"
        >
          {isSigningOut ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LogOut className="h-3.5 w-3.5" />
          )}
          <span>{isSigningOut ? "Signing out..." : "Sign out"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
