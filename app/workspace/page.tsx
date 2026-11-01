import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Flame } from "lucide-react";
import { requireUserOrRedirect } from "@/lib/auth/session";
import { getUserProjectsAction } from "@/app/actions/project";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/auth/user-menu";
import { ProjectsSection } from "@/components/workspace/projects-section";

export const metadata: Metadata = {
  title: "Workspace — Foundry",
  description: "Foundry AI developer workspace and projects.",
};

async function WorkspaceContent() {
  const user = await requireUserOrRedirect("/workspace");
  const projectsResult = await getUserProjectsAction();
  const initialProjects = projectsResult.success ? projectsResult.data : [];

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-foreground selection:text-background">
      {/* Top Application Header */}
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
            aria-label="Foundry Home"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background shadow-xs">
              <Flame className="h-4 w-4 fill-current" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Foundry
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      {/* Main Workspace Surface */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        <ProjectsSection initialProjects={initialProjects} />
      </main>
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col bg-background text-foreground animate-pulse p-8">
          <div className="mx-auto w-full max-w-7xl space-y-6">
            <div className="h-8 w-48 rounded bg-muted" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="h-32 rounded-xl bg-muted" />
              <div className="h-32 rounded-xl bg-muted" />
              <div className="h-32 rounded-xl bg-muted" />
            </div>
          </div>
        </div>
      }
    >
      <WorkspaceContent />
    </Suspense>
  );
}
