"use client";

import { useState, useCallback } from "react";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { WorkspaceChatSidebar } from "@/components/workspace/workspace-chat-sidebar";
import { WorkspaceCanvas } from "@/components/workspace/workspace-canvas";
import type {
  ProjectRecord,
  ProjectFileRecord,
  ProjectMessageRecord,
} from "@/app/actions/project";
import type { FileModification } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

type WorkspaceShellUser = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image?: string | null;
};

type WorkspaceShellProps = Readonly<{
  project: ProjectRecord | null;
  user: WorkspaceShellUser | null;
  slug: string;
  initialFiles?: readonly ProjectFileRecord[];
  initialMessages?: readonly ProjectMessageRecord[];
}>;

function formatSlugToTitle(slug: string): string {
  if (!slug) return "Untitled Project";
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
 * Client Workspace Shell coordinating mobile view switching, file updates, and canvas state.
 * Spans full viewport height and width with zero max-w-* constraints.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.3, §5.4 and DESIGN.md.
 */
export function WorkspaceShell({
  project,
  user,
  slug,
  initialFiles = [],
  initialMessages = [],
}: WorkspaceShellProps) {
  const [activeMobileTab, setActiveMobileTab] = useState<"chat" | "preview">(
    "chat",
  );
  const [viewportMode, setViewportMode] = useState<
    "desktop" | "tablet" | "mobile"
  >("desktop");
  const [files, setFiles] =
    useState<readonly ProjectFileRecord[]>(initialFiles);
  const [isGenerating, setIsGenerating] = useState(
    project?.generationStatus === "generating",
  );
  const [fixErrorPrompt, setFixErrorPrompt] = useState<string | null>(null);

  const handleRequestFixError = useCallback((errorDescription: string) => {
    setFixErrorPrompt(
      `Please fix this preview build/runtime error in my Next.js landing page:\n\n${errorDescription}`,
    );
    setActiveMobileTab("chat");
  }, []);

  const handleFilesUpdated = useCallback(
    (updatedFiles: readonly FileModification[]) => {
      setFiles((prev) => {
        const fileMap = new Map(prev.map((f) => [f.path, f]));
        for (const uf of updatedFiles) {
          const existing = fileMap.get(uf.path);
          if (existing) {
            fileMap.set(uf.path, {
              ...existing,
              content: uf.content,
              updatedAt: new Date(),
            });
          } else {
            fileMap.set(uf.path, {
              id: `file_${slug}_${Math.random().toString(36).substring(2, 7)}`,
              projectId: slug,
              path: uf.path,
              content: uf.content,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
        }
        return Array.from(fileMap.values()).sort((a, b) =>
          a.path.localeCompare(b.path),
        );
      });
    },
    [slug],
  );

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
          projectId={project?.id ?? slug}
          initialMessages={initialMessages}
          isGenerating={isGenerating}
          onGeneratingChange={setIsGenerating}
          onFilesUpdated={handleFilesUpdated}
          externalPromptPrefill={fixErrorPrompt}
          onClearExternalPrompt={() => setFixErrorPrompt(null)}
          className={cn(activeMobileTab === "chat" ? "flex" : "hidden md:flex")}
        />

        {/* Right Canvas: Always visible on desktop; conditionally rendered on mobile */}
        <WorkspaceCanvas
          project={project}
          files={files}
          slug={slug}
          isGenerating={isGenerating}
          viewportMode={viewportMode}
          onViewportModeChange={setViewportMode}
          onRequestFixError={handleRequestFixError}
          className={cn(
            activeMobileTab === "preview" ? "flex" : "hidden md:flex",
          )}
        />
      </main>
    </div>
  );
}
