"use client";

import Link from "next/link";
import {
  Flame,
  ChevronDown,
  Share2,
  MessageSquare,
  Eye,
  Layers,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/auth/user-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type WorkspaceHeaderUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

type WorkspaceHeaderProps = Readonly<{
  projectName: string;
  user: WorkspaceHeaderUser | null;
  activeMobileTab: "chat" | "preview";
  onMobileTabChange: (tab: "chat" | "preview") => void;
}>;

/**
 * Full-width workspace application header.
 * Spans 100% viewport width without max-width constraints.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.3, §5.4 and DESIGN.md.
 */
export function WorkspaceHeader({
  projectName,
  user,
  activeMobileTab,
  onMobileTabChange,
}: WorkspaceHeaderProps) {
  return (
    <header className="w-full h-12 border-b border-border bg-background px-3 sm:px-4 flex items-center justify-between shrink-0 select-none z-30">
      {/* Left: Brand mark, subtle divider, and project name with dropdown */}
      <div className="flex items-center gap-2.5 min-w-0">
        <Link
          href="/workspace"
          className="flex items-center gap-2 transition-opacity hover:opacity-85 shrink-0"
          aria-label="Back to Foundry projects"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background shadow-2xs">
            <Flame className="h-4 w-4 fill-current" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground hidden sm:inline">
            Foundry
          </span>
        </Link>

        <div className="h-4 w-px bg-border/60 shrink-0" aria-hidden="true" />

        {/* Project Name & Actions Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 cursor-pointer min-w-0"
                aria-label={`Project options for ${projectName}`}
              >
                <span className="truncate">{projectName}</span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="w-52 p-1">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground px-2 py-1">
                Project Actions
              </DropdownMenuLabel>
              <DropdownMenuItem
                render={
                  <Link
                    href="/workspace"
                    className="flex items-center gap-2 px-2 py-1.5 text-xs text-foreground cursor-pointer"
                  >
                    <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>All projects</span>
                  </Link>
                }
              />
              <DropdownMenuItem className="flex items-center gap-2 px-2 py-1.5 text-xs text-foreground cursor-pointer">
                <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Project settings</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
              ID: <span className="font-mono">{projectName}</span>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Badge
          variant="outline"
          className="hidden lg:inline-flex text-[10px] font-mono h-4.5 px-1.5 font-normal text-muted-foreground"
        >
          v0 engine
        </Badge>
      </div>

      {/* Center: Mobile View Switcher (Chat vs Preview) */}
      <div className="flex md:hidden items-center rounded-lg bg-muted p-0.5 text-xs border border-border/40 shrink-0">
        <button
          type="button"
          onClick={() => onMobileTabChange("chat")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-all cursor-pointer font-medium",
            activeMobileTab === "chat"
              ? "bg-background text-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={activeMobileTab === "chat"}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>Chat</span>
        </button>
        <button
          type="button"
          onClick={() => onMobileTabChange("preview")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-all cursor-pointer font-medium",
            activeMobileTab === "preview"
              ? "bg-background text-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={activeMobileTab === "preview"}
        >
          <Eye className="h-3.5 w-3.5" />
          <span>Preview</span>
        </button>
      </div>

      {/* Right: Actions, theme toggle, and user menu */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="hidden sm:inline-flex text-xs h-7 px-2.5 gap-1.5 shadow-2xs"
          title="Share project link (placeholder)"
          aria-label="Share project"
        >
          <Share2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Share</span>
        </Button>

        <ThemeToggle />

        {user ? (
          <UserMenu user={user} />
        ) : (
          <Avatar size="sm">
            <AvatarFallback>FD</AvatarFallback>
          </Avatar>
        )}
      </div>
    </header>
  );
}
