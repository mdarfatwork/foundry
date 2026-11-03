"use client";

import { useState } from "react";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { WorkspaceChatSidebar } from "@/components/workspace/workspace-chat-sidebar";
import { WorkspaceCanvas } from "@/components/workspace/workspace-canvas";
import type { ProjectRecord } from "@/app/actions/project";
import { cn } from "@/lib/utils";

type WorkspaceShellUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

type WorkspaceShellProps = Readonly<{
  project: ProjectRecord | null;
  user: WorkspaceShellUser | null;
  slug: string;
}>;

function formatSlugToTitle(slug: string): string {
  if (!slug) return "Untitled Project";
  // Clean synthetic database IDs
  if (slug.startsWith("proj_")) {
    return "Untitled Project";
  }
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Client Workspace Shell coordinating mobile view switching and canvas viewport emulation.
 * Spans full viewport height and width with zero max-w-* constraints.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.3, §5.4 and DESIGN.md.
 */
export function WorkspaceShell({ project, user, slug }: WorkspaceShellProps) {
  const [activeMobileTab, setActiveMobileTab] = useState<"chat" | "preview">(
    "chat",
  );
  const [viewportMode, setViewportMode] = useState<
    "desktop" | "tablet" | "mobile"
  >("desktop");

  const projectName = project?.name || formatSlugToTitle(slug);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground select-none">
      {/* 1. Full-Width Workspace Header */}
      <WorkspaceHeader
        projectName={projectName}
        user={user}
        activeMobileTab={activeMobileTab}
        onMobileTabChange={setActiveMobileTab}
      />

      {/* 2. Main Workspace Body: Left Chat Sidebar + Right Canvas */}
      <main className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* Left Chat Sidebar: Always visible on desktop; conditionally rendered on mobile */}
        <WorkspaceChatSidebar
          className={cn(activeMobileTab === "chat" ? "flex" : "hidden md:flex")}
        />

        {/* Right Canvas: Always visible on desktop; conditionally rendered on mobile */}
        <WorkspaceCanvas
          slug={slug}
          viewportMode={viewportMode}
          onViewportModeChange={setViewportMode}
          className={cn(
            activeMobileTab === "preview" ? "flex" : "hidden md:flex",
          )}
        />
      </main>
    </div>
  );
}
