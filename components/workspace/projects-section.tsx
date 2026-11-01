"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderPlus, Layers, ArrowUpRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreateProjectDialog } from "@/components/workspace/create-project-dialog";
import type { ProjectRecord } from "@/app/actions/project";

type ProjectsSectionProps = Readonly<{
  /**
   * Initial list of projects pre-fetched by the Server Component.
   */
  initialProjects: readonly ProjectRecord[];
}>;

function formatDate(dateInput: Date | string | null): string {
  if (!dateInput) return "Recently";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return "Recently";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * Projects Section for the Foundry Workspace.
 * Provides project list/grid, creation modal, and responsive empty state.
 * Adheres to AGENTS.md §5.1, §5.3, §5.4, and DESIGN.md.
 */
export function ProjectsSection({ initialProjects }: ProjectsSectionProps) {
  const [projects, setProjects] =
    useState<readonly ProjectRecord[]>(initialProjects);
  const router = useRouter();

  const handleProjectCreated = (newProject: ProjectRecord) => {
    setProjects((prev) => [newProject, ...prev]);
    router.refresh();
  };

  return (
    <section className="space-y-4" aria-labelledby="projects-heading">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-border/40">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2
              id="projects-heading"
              className="text-lg sm:text-xl font-semibold tracking-tight text-foreground"
            >
              Projects
            </h2>
            <Badge variant="secondary" className="font-mono text-[11px] h-5">
              {projects.length}
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Manage your AI-generated applications, websites, and prototypes.
          </p>
        </div>

        <div className="shrink-0">
          <CreateProjectDialog onProjectCreated={handleProjectCreated} />
        </div>
      </div>

      {/* Projects Grid or Useful Empty State */}
      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 sm:p-12 text-center flex flex-col items-center justify-center space-y-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FolderPlus className="h-5 w-5" />
          </div>
          <div className="space-y-1 max-w-sm">
            <h3 className="text-sm font-semibold text-foreground">
              No projects yet
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Create your first project to start building and iterating on
              applications with conversational AI.
            </p>
          </div>
          <div className="pt-2">
            <CreateProjectDialog
              onProjectCreated={handleProjectCreated}
              trigger={
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shadow-xs"
                >
                  <Plus className="h-4 w-4" />
                  <span>Create first project</span>
                </Button>
              }
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
          {projects.map((proj) => (
            <Link
              key={proj.id}
              href={`/workspace/${proj.id}`}
              className="group relative flex flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs transition-all duration-150 hover:border-foreground/20 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                      <Layers className="h-3.5 w-3.5" />
                    </div>
                    <span className="font-semibold text-sm text-foreground truncate group-hover:text-primary transition-colors">
                      {proj.name}
                    </span>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem] leading-relaxed">
                  {proj.description || "No description provided."}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-mono">{formatDate(proj.createdAt)}</span>
                <span className="text-xs font-medium text-foreground group-hover:underline">
                  Open project
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
