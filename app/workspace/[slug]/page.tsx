import { Suspense } from "react";
import type { Metadata } from "next";
import { requireUserOrRedirect } from "@/lib/auth/session";
import { getProjectByIdForUser } from "@/app/actions/project";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

type ProjectPageProps = Readonly<{
  params: Promise<{
    slug: string;
  }>;
}>;

function formatSlugToTitle(slug: string): string {
  if (!slug) return "Workspace";
  if (slug.startsWith("proj_")) {
    return "Project Workspace";
  }
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function generateMetadata({
  params,
}: ProjectPageProps): Promise<Metadata> {
  const { slug } = await params;
  const title = formatSlugToTitle(slug);
  return {
    title: `${title} — Foundry`,
    description:
      "Foundry dynamic project workspace, AI conversation, and preview canvas.",
  };
}

async function ProjectPageContent({ params }: ProjectPageProps) {
  const { slug } = await params;
  const user = await requireUserOrRedirect(`/workspace/${slug}`);
  const project = await getProjectByIdForUser(slug, user.id);

  return <WorkspaceShell project={project} user={user} slug={slug} />;
}

function WorkspaceLoadingFallback() {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground animate-pulse select-none">
      {/* Full-width header skeleton */}
      <div className="h-12 w-full border-b border-border bg-background px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-md bg-muted" />
          <div className="h-4 w-32 rounded bg-muted" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-7 w-16 rounded-md bg-muted hidden sm:block" />
          <div className="h-7 w-7 rounded-md bg-muted" />
          <div className="h-7 w-7 rounded-full bg-muted" />
        </div>
      </div>

      {/* Main split surface skeleton */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        <div className="hidden md:flex w-[360px] lg:w-[390px] shrink-0 border-r border-border p-4 flex-col justify-between bg-sidebar/20">
          <div className="space-y-4">
            <div className="h-4 w-20 rounded bg-muted" />
            <div className="h-24 w-full rounded-xl bg-muted" />
            <div className="h-16 w-3/4 rounded-xl bg-muted ml-auto" />
            <div className="h-28 w-full rounded-xl bg-muted" />
          </div>
          <div className="h-20 w-full rounded-xl bg-muted" />
        </div>

        <div className="flex-1 p-4 sm:p-6 flex flex-col min-w-0 bg-muted/15">
          <div className="h-8 w-full rounded-lg bg-muted/60 mb-4" />
          <div className="flex-1 rounded-xl border border-border bg-card/40 flex items-center justify-center p-8">
            <div className="flex flex-col items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-muted" />
              <div className="h-5 w-48 rounded bg-muted" />
              <div className="h-3 w-72 rounded bg-muted" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProjectWorkspacePage(props: ProjectPageProps) {
  return (
    <Suspense fallback={<WorkspaceLoadingFallback />}>
      <ProjectPageContent {...props} />
    </Suspense>
  );
}
