"use client";

import { useState, useMemo } from "react";
import {
  Monitor,
  Tablet,
  Smartphone,
  RotateCw,
  ExternalLink,
  Lock,
  Eye,
  Code2,
  Sparkles,
  FileCode,
  Check,
  Copy,
  Folder,
  Layers,
  LayoutGrid,
  Loader2,
  FileJson,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ProjectRecord, ProjectFileRecord } from "@/app/actions/project";
import { cn } from "@/lib/utils";

type ViewportMode = "desktop" | "tablet" | "mobile";
type ViewMode = "preview" | "code";

type WorkspaceCanvasProps = Readonly<{
  project: ProjectRecord | null;
  files?: readonly ProjectFileRecord[];
  slug?: string;
  viewportMode: ViewportMode;
  onViewportModeChange: (mode: ViewportMode) => void;
  className?: string;
  isGenerating?: boolean;
}>;

const STARTER_TEMPLATES = [
  {
    title: "SaaS Landing Page",
    description:
      "Hero with CTA, feature architecture, testimonials, and 3-tier pricing matrix.",
    badge: "Full-Stack",
    icon: LayoutGrid,
  },
  {
    title: "Interactive Analytics Dashboard",
    description:
      "Real-time metrics, line charts, data tables, and collapsible sidebar navigation.",
    badge: "Data",
    icon: Layers,
  },
  {
    title: "Design System Showcase",
    description:
      "Accessible Base UI primitives, responsive dialogs, tokens, and theme controls.",
    badge: "UI Kit",
    icon: Sparkles,
  },
] as const;

function normalizeFilePath(rawPath: string): string {
  let p = rawPath.replace(/\\/g, "/").trim();
  while (p.startsWith("/")) p = p.slice(1);
  if (p.startsWith("config/lib/")) {
    p = p.replace(/^config\/lib\//, "lib/");
  } else if (p.startsWith("config/")) {
    p = p.replace(/^config\//, "");
  }
  return p;
}

/**
 * Main Workspace Canvas Surface.
 * Houses preview toolbar, dynamic viewport controls, hierarchical Next.js file tree explorer,
 * and responsive browser-frame application canvas.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.3, §5.4 and DESIGN.md.
 */
export function WorkspaceCanvas({
  project,
  files = [],
  slug = "new",
  viewportMode,
  onViewportModeChange,
  className,
  isGenerating = false,
}: WorkspaceCanvasProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [selectedFilePath, setSelectedFilePath] =
    useState<string>("app/page.tsx");
  const [hasCopied, setHasCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Normalize files list to prevent any misplaced legacy paths
  const normalizedFiles = useMemo(() => {
    return files.map((f) => ({
      ...f,
      path: normalizeFilePath(f.path),
    }));
  }, [files]);

  // Selected file record for the code viewer
  const selectedFile = useMemo(() => {
    return (
      normalizedFiles.find((f) => f.path === selectedFilePath) ??
      normalizedFiles.find((f) => f.path === "app/page.tsx") ??
      normalizedFiles[0] ??
      null
    );
  }, [normalizedFiles, selectedFilePath]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleCopyCode = async () => {
    if (!selectedFile) return;
    try {
      await navigator.clipboard.writeText(selectedFile.content);
      setHasCopied(true);
      setTimeout(() => setHasCopied(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  // True Next.js file hierarchy grouping
  const fileGroups = useMemo(() => {
    const appFiles: ProjectFileRecord[] = [];
    const componentFiles: ProjectFileRecord[] = [];
    const libFiles: ProjectFileRecord[] = [];
    const publicFiles: ProjectFileRecord[] = [];
    const rootConfigFiles: ProjectFileRecord[] = [];

    for (const f of normalizedFiles) {
      if (f.path.startsWith("app/")) {
        appFiles.push(f);
      } else if (f.path.startsWith("components/")) {
        componentFiles.push(f);
      } else if (f.path.startsWith("lib/")) {
        libFiles.push(f);
      } else if (f.path.startsWith("public/")) {
        publicFiles.push(f);
      } else {
        rootConfigFiles.push(f);
      }
    }

    const sortFn = (a: ProjectFileRecord, b: ProjectFileRecord) =>
      a.path.localeCompare(b.path);

    return {
      app: appFiles.sort(sortFn),
      components: componentFiles.sort(sortFn),
      lib: libFiles.sort(sortFn),
      public: publicFiles.sort(sortFn),
      rootConfig: rootConfigFiles.sort(sortFn),
    };
  }, [normalizedFiles]);

  return (
    <section
      className={cn(
        "flex-1 min-w-0 flex flex-col h-full bg-muted/15 select-none overflow-hidden",
        className,
      )}
      aria-label="Application preview canvas"
    >
      {/* 1. Canvas Toolbar */}
      <div className="h-10 px-3 sm:px-4 border-b border-border bg-background/80 backdrop-blur-xs flex items-center justify-between shrink-0 z-10">
        {/* Left: View mode switcher & browser address bar */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center rounded-md bg-muted p-0.5 text-xs border border-border/40 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-all cursor-pointer font-medium",
                viewMode === "preview"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={viewMode === "preview"}
            >
              <Eye className="h-3 w-3" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("code")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-all cursor-pointer font-medium",
                viewMode === "code"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={viewMode === "code"}
            >
              <Code2 className="h-3 w-3" />
              <span>Code ({normalizedFiles.length})</span>
            </button>
          </div>

          <div
            className="h-3.5 w-px bg-border/60 shrink-0 hidden sm:block"
            aria-hidden="true"
          />

          {/* Address Bar Pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 border border-border/50 text-[11px] text-muted-foreground font-mono truncate">
            <Lock className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
            <span className="text-foreground">preview.foundry.dev</span>
            <span className="text-muted-foreground/60 truncate">/{slug}</span>
          </div>
        </div>

        {/* Right: Device Viewport Controls & Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center rounded-md bg-muted p-0.5 text-xs border border-border/40">
            <button
              type="button"
              onClick={() => onViewportModeChange("desktop")}
              className={cn(
                "p-1 rounded transition-all cursor-pointer",
                viewportMode === "desktop"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Desktop viewport (100%)"
              aria-label="Desktop viewport"
              aria-pressed={viewportMode === "desktop"}
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onViewportModeChange("tablet")}
              className={cn(
                "p-1 rounded transition-all cursor-pointer",
                viewportMode === "tablet"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Tablet viewport (768px)"
              aria-label="Tablet viewport"
              aria-pressed={viewportMode === "tablet"}
            >
              <Tablet className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onViewportModeChange("mobile")}
              className={cn(
                "p-1 rounded transition-all cursor-pointer",
                viewportMode === "mobile"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Mobile viewport (375px)"
              aria-label="Mobile viewport"
              aria-pressed={viewportMode === "mobile"}
            >
              <Smartphone className="h-3.5 w-3.5" />
            </button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleRefresh}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
            title="Refresh preview"
            aria-label="Refresh preview"
          >
            <RotateCw
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                isRefreshing && "animate-spin",
              )}
            />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground cursor-pointer hidden sm:inline-flex"
            title="Open in new window"
            aria-label="Open in new window"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* 2. Canvas Body: Either Code View or Interactive Preview */}
      {viewMode === "code" ? (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden border-t border-border bg-card">
          {/* File Tree Explorer (Left sub-panel) */}
          <div className="w-full md:w-64 border-r border-border bg-sidebar/10 p-3 overflow-y-auto shrink-0 select-none space-y-4">
            {/* App Directory */}
            {fileGroups.app.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-xs font-semibold text-foreground">
                  <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>app/</span>
                </div>
                <div className="pl-3 space-y-0.5 border-l border-border/40 ml-2">
                  {fileGroups.app.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedFilePath(file.path)}
                      className={cn(
                        "w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left transition-colors cursor-pointer truncate",
                        selectedFile?.path === file.path
                          ? "bg-accent text-foreground font-medium shadow-2xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                    >
                      <FileCode className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {file.path.replace("app/", "")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Components Directory */}
            {fileGroups.components.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-xs font-semibold text-foreground">
                  <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>components/</span>
                </div>
                <div className="pl-3 space-y-0.5 border-l border-border/40 ml-2">
                  {fileGroups.components.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedFilePath(file.path)}
                      className={cn(
                        "w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left transition-colors cursor-pointer truncate",
                        selectedFile?.path === file.path
                          ? "bg-accent text-foreground font-medium shadow-2xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                    >
                      <FileCode className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {file.path.replace("components/", "")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Lib Directory */}
            {fileGroups.lib.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-xs font-semibold text-foreground">
                  <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>lib/</span>
                </div>
                <div className="pl-3 space-y-0.5 border-l border-border/40 ml-2">
                  {fileGroups.lib.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedFilePath(file.path)}
                      className={cn(
                        "w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left transition-colors cursor-pointer truncate",
                        selectedFile?.path === file.path
                          ? "bg-accent text-foreground font-medium shadow-2xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                    >
                      <FileCode className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {file.path.replace("lib/", "")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Public Directory (if present) */}
            {fileGroups.public.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-xs font-semibold text-foreground">
                  <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>public/</span>
                </div>
                <div className="pl-3 space-y-0.5 border-l border-border/40 ml-2">
                  {fileGroups.public.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedFilePath(file.path)}
                      className={cn(
                        "w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left transition-colors cursor-pointer truncate",
                        selectedFile?.path === file.path
                          ? "bg-accent text-foreground font-medium shadow-2xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                    >
                      <FileCode className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {file.path.replace("public/", "")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Root-Level Configuration Files */}
            {fileGroups.rootConfig.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-border/40">
                <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <Settings className="h-3 w-3 shrink-0" />
                  <span>Root Config</span>
                </div>
                <div className="space-y-0.5">
                  {fileGroups.rootConfig.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedFilePath(file.path)}
                      className={cn(
                        "w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-left transition-colors cursor-pointer truncate",
                        selectedFile?.path === file.path
                          ? "bg-accent text-foreground font-medium shadow-2xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                    >
                      <FileJson className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono text-[11px]">
                        {file.path}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Code Viewer (Right sub-panel) */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
            {selectedFile ? (
              <>
                <div className="h-9 px-4 border-b border-border flex items-center justify-between shrink-0 bg-muted/20">
                  <div className="flex items-center gap-2 font-mono text-xs text-foreground">
                    <FileCode className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-semibold">{selectedFile.path}</span>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={handleCopyCode}
                    className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {hasCopied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="text-emerald-500">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </Button>
                </div>

                <div className="flex-1 min-h-0 overflow-auto p-4 font-mono text-xs select-text leading-relaxed bg-background/50">
                  <pre className="text-foreground whitespace-pre">
                    <code>{selectedFile.content}</code>
                  </pre>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                No file selected.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Preview Canvas */
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 min-h-0 flex items-center justify-center">
          {/* Dynamic Responsive Browser Frame Container */}
          <div
            className={cn(
              "h-full min-h-[460px] flex flex-col rounded-xl border border-border bg-card shadow-2xs overflow-hidden transition-all duration-300",
              viewportMode === "desktop" && "w-full",
              viewportMode === "tablet" && "w-[768px]",
              viewportMode === "mobile" && "w-[375px]",
            )}
          >
            {/* Browser Chrome Header */}
            <div className="h-8 px-3 border-b border-border/60 bg-muted/30 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-border" />
                <span className="h-2 w-2 rounded-full bg-border" />
                <span className="h-2 w-2 rounded-full bg-border" />
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
                <span>localhost:3000</span>
              </div>

              <div className="flex items-center gap-1.5">
                {isGenerating ? (
                  <>
                    <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
                    <span className="text-[10px] font-mono text-primary font-medium">
                      Generating
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"
                      aria-hidden="true"
                    />
                    <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
                      Ready
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Browser Frame Inner Content */}
            <div className="flex-1 overflow-y-auto p-6 sm:p-10 flex flex-col items-center justify-center text-center select-text">
              {isGenerating ? (
                <div className="space-y-4 max-w-md animate-pulse">
                  <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl border border-border bg-muted/50 text-foreground shadow-2xs">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    Generating your application...
                  </h2>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    NVIDIA hosted inference is analyzing your preferences,
                    generating layout components, and applying design tokens.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/50 text-foreground mb-4 shadow-2xs">
                    <Sparkles className="h-5 w-5" />
                  </div>

                  <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground mb-2">
                    {project?.name ?? "Your workspace starts here"}
                  </h2>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed text-balance mb-8 px-2 max-w-lg">
                    {project?.prompt
                      ? `Initialized with prompt: "${project.prompt}"`
                      : "Describe components, layouts, or pages in the chat on the left to transform this starter template into a complete application."}
                  </p>

                  {/* Active Template Status Card */}
                  <div className="w-full max-w-md rounded-xl border border-border/80 bg-muted/30 p-4 text-left mb-6 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        Active Files ({normalizedFiles.length})
                      </span>
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px]"
                      >
                        Next.js 16 + Base UI
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {normalizedFiles.slice(0, 7).map((f) => (
                        <span
                          key={f.path}
                          className="text-[10px] font-mono px-2 py-0.5 rounded bg-background border border-border/60 text-muted-foreground"
                        >
                          {f.path}
                        </span>
                      ))}
                      {normalizedFiles.length > 7 && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-background border border-border/60 text-muted-foreground">
                          +{normalizedFiles.length - 7} more
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Starter Suggestion Blueprint Cards */}
                  <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
                    {STARTER_TEMPLATES.map((item) => {
                      const IconComponent = item.icon;
                      return (
                        <div
                          key={item.title}
                          className="group rounded-xl border border-border/80 bg-muted/20 p-3.5 hover:bg-accent/40 hover:border-foreground/20 transition-all cursor-pointer shadow-2xs flex flex-col justify-between"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground">
                                <IconComponent className="h-3.5 w-3.5" />
                              </div>
                              <Badge
                                variant="secondary"
                                className="text-[9px] font-mono h-4 px-1.5"
                              >
                                {item.badge}
                              </Badge>
                            </div>

                            <h3 className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                              {item.title}
                            </h3>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              {item.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
