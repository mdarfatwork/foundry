import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Flame, Sparkles, FolderX, ArrowLeft } from "lucide-react";
import { requireUserOrRedirect } from "@/lib/auth/session";
import { getProjectByIdForUser } from "@/app/actions/project";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/auth/user-menu";
import { PromptComposer } from "@/components/home/prompt-composer";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ProjectPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

export async function generateMetadata({
  params,
}: ProjectPageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Project ${id} — Foundry`,
    description: "Foundry project workspace and prompt composer.",
  };
}

async function ProjectPageContent({ params }: ProjectPageProps) {
  const { id } = await params;
  const user = await requireUserOrRedirect(`/workspace/${id}`);
  const project = await getProjectByIdForUser(id, user.id);

  if (!project) {
    return (
      <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-foreground selection:text-background">
        {/* Minimal Navigation Header */}
        <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
            <Link
              href="/workspace"
              className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
              aria-label="Foundry Workspace"
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

        {/* Not Found / Access Denied Surface */}
        <main className="flex flex-1 flex-col items-center justify-center px-4 sm:px-6 py-16 text-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-xs flex flex-col items-center space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <FolderX className="h-6 w-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-semibold tracking-tight text-foreground">
                Project not found
              </h1>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The requested project does not exist or you lack permission to
                view it.
              </p>
            </div>
            <Link
              href="/workspace"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              <span>Back to Workspace</span>
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-foreground selection:text-background">
      {/* Top Application Header with Breadcrumb Navigation */}
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/workspace"
              className="flex items-center gap-2.5 transition-opacity hover:opacity-90 shrink-0"
              aria-label="Back to Workspace"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background shadow-xs">
                <Flame className="h-4 w-4 fill-current" />
              </div>
              <span className="text-sm font-semibold tracking-tight text-foreground hidden sm:inline">
                Foundry
              </span>
            </Link>

            <span className="text-muted-foreground/40 text-sm select-none">
              /
            </span>

            <Link
              href="/workspace"
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              Workspace
            </Link>

            <span className="text-muted-foreground/40 text-sm select-none">
              /
            </span>

            <span className="text-xs font-semibold text-foreground truncate max-w-[140px] sm:max-w-xs">
              {project.name}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      {/* Main Project Surface (Constrained to max-w-xl) */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 sm:px-6 py-12 sm:py-16 md:py-20">
        <div className="w-full max-w-xl flex flex-col items-center text-center space-y-6">
          {/* Project Heading & Details */}
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-foreground text-balance">
              {project.name}
            </h1>
            {project.description ? (
              <p className="text-sm text-muted-foreground text-balance leading-relaxed">
                {project.description}
              </p>
            ) : null}
          </div>

          {/* Simple Placeholder Explaining Workspace Preparation */}
          <div className="w-full rounded-xl border border-dashed border-border bg-card/50 p-6 text-center space-y-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground mx-auto">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">
                Project workspace initialized
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-md mx-auto">
                Project chat, conversational iteration, live preview canvas, and
                direct code generation will be available here.
              </p>
            </div>
          </div>

          {/* Minimal Chat / Prompt Area Consistent With Updated Composer */}
          <div className="w-full text-left">
            <PromptComposer placeholder="What do you want to build for this project?" />
          </div>

          {/* Back Navigation Link */}
          <div className="pt-2">
            <Link
              href="/workspace"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to all projects</span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ProjectPage(props: ProjectPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col bg-background text-foreground animate-pulse p-8">
          <div className="mx-auto w-full max-w-xl space-y-6">
            <div className="h-8 w-48 rounded bg-muted mx-auto" />
            <div className="h-28 rounded-xl bg-muted" />
            <div className="h-32 rounded-2xl bg-muted" />
          </div>
        </div>
      }
    >
      <ProjectPageContent {...props} />
    </Suspense>
  );
}
