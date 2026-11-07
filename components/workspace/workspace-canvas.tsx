"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
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
  Loader2,
  FileJson,
  Settings,
  Terminal,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWebContainer } from "@/hooks/use-webcontainer";
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
  onRequestFixError?: (errorDescription: string) => void;
}>;

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
 * Runs the generated Next.js application inside WebContainers in the browser.
 * Provides live iframe preview, responsive viewports, Next.js code explorer,
 * dependency status, dev server controls, and collapsible terminal logs.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.3, §5.4 and Prompt §3, §9, §10.
 */
export function WorkspaceCanvas({
  project,
  files = [],
  slug = "new",
  viewportMode,
  onViewportModeChange,
  className,
  isGenerating = false,
  onRequestFixError,
}: WorkspaceCanvasProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [selectedFilePath, setSelectedFilePath] =
    useState<string>("app/page.tsx");
  const [hasCopiedCode, setHasCopiedCode] = useState(false);
  const [hasCopiedLogs, setHasCopiedLogs] = useState(false);
  const [isRefreshingIframe, setIsRefreshingIframe] = useState(false);
  const [terminalExplicitState, setTerminalExplicitState] = useState<
    boolean | null
  >(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const terminalLogsEndRef = useRef<HTMLDivElement>(null);
  const activeSlugRef = useRef<string | null>(null);
  const previousFilesKeyRef = useRef<string>("");

  // WebContainer browser runtime controller
  const {
    status,
    previewUrl,
    error: runtimeError,
    logs,
    isSupported,
    startWorkspace,
    restartServer,
    syncFiles,
    reinstallDependencies,
  } = useWebContainer();

  // Derive terminal visibility: explicit user toggle takes precedence; otherwise opens on error
  const showTerminal = terminalExplicitState ?? status === "error";

  // Normalize files list to guarantee valid POSIX relative paths
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

  // Auto-scroll terminal to bottom when new logs arrive
  useEffect(() => {
    if (showTerminal && terminalLogsEndRef.current) {
      terminalLogsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, showTerminal]);

  // Coordinate WebContainer workspace startup and incremental file syncing
  useEffect(() => {
    if (!isSupported || normalizedFiles.length === 0) return;

    const currentFilesKey = normalizedFiles
      .map((f) => `${f.path}:${f.content.length}`)
      .join("|");

    // Case 1: First mount or project changed -> start workspace
    if (activeSlugRef.current !== slug) {
      activeSlugRef.current = slug;
      previousFilesKeyRef.current = currentFilesKey;
      startWorkspace(normalizedFiles);
      return;
    }

    // Case 2: Subsequent file updates in the same project -> sync files incrementally (HMR)
    if (previousFilesKeyRef.current !== currentFilesKey) {
      previousFilesKeyRef.current = currentFilesKey;
      syncFiles(normalizedFiles);
    }
  }, [slug, normalizedFiles, startWorkspace, syncFiles, isSupported]);

  const handleRefreshIframe = useCallback(() => {
    setIsRefreshingIframe(true);
    if (iframeRef.current && previewUrl) {
      // Reload iframe without restarting container
      iframeRef.current.src = previewUrl;
    }
    setTimeout(() => setIsRefreshingIframe(false), 600);
  }, [previewUrl]);

  const handleCopyCode = async () => {
    if (!selectedFile) return;
    try {
      await navigator.clipboard.writeText(selectedFile.content);
      setHasCopiedCode(true);
      setTimeout(() => setHasCopiedCode(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  const handleCopyLogs = async () => {
    if (logs.length === 0) return;
    try {
      await navigator.clipboard.writeText(logs.join("\n"));
      setHasCopiedLogs(true);
      setTimeout(() => setHasCopiedLogs(false), 2000);
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
            <span
              className="text-muted-foreground/60 truncate"
              title={project?.name || slug}
            >
              /
              {project?.name
                ? project.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")
                : slug}
            </span>
          </div>
        </div>

        {/* Right: Runtime Controls, Device Viewports, Terminal Toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Terminal / Build Output Toggle */}
          <button
            type="button"
            onClick={() => setTerminalExplicitState(!showTerminal)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer border",
              showTerminal
                ? "bg-foreground text-background border-foreground font-medium"
                : "bg-muted/60 text-muted-foreground border-border/60 hover:text-foreground hover:bg-muted",
              status === "error" &&
                !showTerminal &&
                "border-destructive/60 text-destructive animate-pulse",
            )}
            title="Toggle WebContainer terminal logs"
          >
            <Terminal className="h-3 w-3" />
            <span className="text-[11px] hidden sm:inline">Logs</span>
            {logs.length > 0 && (
              <span className="text-[9px] opacity-80">({logs.length})</span>
            )}
            {showTerminal ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
          </button>

          <div
            className="h-3.5 w-px bg-border/60 shrink-0 hidden sm:block"
            aria-hidden="true"
          />

          {/* Viewport presets */}
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

          {/* Refresh iframe button */}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleRefreshIframe}
            disabled={!previewUrl || status !== "ready"}
            className="text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-30"
            title="Refresh preview iframe"
            aria-label="Refresh preview iframe"
          >
            <RotateCw
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                isRefreshingIframe && "animate-spin",
              )}
            />
          </Button>

          {/* Restart dev server button */}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => restartServer()}
            disabled={status === "booting" || status === "installing"}
            className="text-muted-foreground hover:text-foreground cursor-pointer hidden sm:inline-flex disabled:opacity-30"
            title="Restart development server"
            aria-label="Restart development server"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>

          {/* Open in new tab if previewUrl exists */}
          {previewUrl && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => window.open(previewUrl, "_blank")}
              className="text-muted-foreground hover:text-foreground cursor-pointer hidden sm:inline-flex"
              title="Open preview in new tab"
              aria-label="Open in new window"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* 2. Main Body: Either Code Explorer or Live Browser Preview */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
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

              {/* Public Directory */}
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
                      className="gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {hasCopiedCode ? (
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
          /* Live Browser Preview Surface */
          <div className="flex-1 overflow-y-auto p-2 sm:p-4 min-h-0 flex items-center justify-center">
            {/* Dynamic Responsive Browser Frame */}
            <div
              className={cn(
                "h-full min-h-[460px] flex flex-col rounded-xl border border-border bg-card shadow-2xs overflow-hidden transition-all duration-300",
                viewportMode === "desktop" && "w-full",
                viewportMode === "tablet" && "w-[768px]",
                viewportMode === "mobile" && "w-[375px]",
              )}
            >
              {/* Browser Chrome Bar */}
              <div className="h-8 px-3 border-b border-border/60 bg-muted/30 flex items-center justify-between shrink-0 select-none">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-border" />
                  <span className="h-2 w-2 rounded-full bg-border" />
                  <span className="h-2 w-2 rounded-full bg-border" />
                </div>

                <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
                  <span>
                    {previewUrl ? new URL(previewUrl).host : "localhost:3000"}
                  </span>
                </div>

                {/* Live Status Pill */}
                <div className="flex items-center gap-1.5">
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
                      <span className="text-[10px] font-mono text-primary font-medium">
                        Generating Code
                      </span>
                    </>
                  ) : status === "booting" ? (
                    <>
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                      <span className="text-[10px] font-mono text-muted-foreground">
                        Booting Node
                      </span>
                    </>
                  ) : status === "mounting" ? (
                    <>
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                      <span className="text-[10px] font-mono text-muted-foreground">
                        Mounting Files
                      </span>
                    </>
                  ) : status === "installing" ? (
                    <>
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
                      <span className="text-[10px] font-mono text-primary font-medium">
                        Installing npm
                      </span>
                    </>
                  ) : status === "starting-server" ? (
                    <>
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-500" />
                      <span className="text-[10px] font-mono text-amber-500 font-medium">
                        Starting Next.js
                      </span>
                    </>
                  ) : status === "ready" ? (
                    <>
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"
                        aria-hidden="true"
                      />
                      <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                        Preview Ready
                      </span>
                    </>
                  ) : status === "error" ? (
                    <>
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-destructive"
                        aria-hidden="true"
                      />
                      <span className="text-[10px] font-mono text-destructive font-medium">
                        Runtime Error
                      </span>
                    </>
                  ) : status === "unsupported" ? (
                    <>
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-amber-500"
                        aria-hidden="true"
                      />
                      <span className="text-[10px] font-mono text-amber-500 font-medium">
                        Isolation Required
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      Idle
                    </span>
                  )}
                </div>
              </div>

              {/* Browser Frame Inner: Iframe or Loading/Error Overlay */}
              <div className="flex-1 w-full h-full relative overflow-hidden bg-background">
                {status === "ready" && previewUrl ? (
                  <iframe
                    ref={iframeRef}
                    src={previewUrl}
                    className="w-full h-full border-0 bg-background"
                    title="Foundry Application Preview"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                  />
                ) : status === "unsupported" ? (
                  <div className="h-full p-8 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-500 shadow-2xs">
                      <ShieldAlert className="h-6 w-6" />
                    </div>
                    <h3 className="text-base font-semibold text-foreground">
                      Cross-Origin Isolation Required
                    </h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      WebContainers run an in-browser Node.js runtime and
                      require SharedArrayBuffer with Cross-Origin Opener Policy
                      (COOP) and Cross-Origin Embedder Policy (COEP).
                    </p>
                    <p className="text-[11px] text-muted-foreground font-mono bg-muted/60 p-2 rounded border border-border">
                      COOP: same-origin | COEP: credentialless
                    </p>
                  </div>
                ) : status === "error" ? (
                  <div className="h-full p-8 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4 select-text">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10 text-destructive shadow-2xs">
                      <AlertCircle className="h-6 w-6" />
                    </div>
                    <h3 className="text-base font-semibold text-foreground">
                      Preview Execution Error
                    </h3>
                    <p className="text-xs text-destructive leading-relaxed font-mono bg-destructive/10 p-2.5 rounded border border-destructive/20 text-left w-full break-words">
                      {runtimeError ||
                        "The development server or build process failed to run."}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => startWorkspace(normalizedFiles)}
                        className="gap-1.5 text-xs"
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                        <span>Retry Preview</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => reinstallDependencies(normalizedFiles)}
                        className="gap-1.5 text-xs"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Reinstall npm</span>
                      </Button>
                      {onRequestFixError && runtimeError && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => onRequestFixError(runtimeError)}
                          className="gap-1.5 text-xs"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Ask Foundry to Fix</span>
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Loading State (Booting / Installing / Starting Dev Server) */
                  <div className="h-full p-8 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/50 text-foreground shadow-2xs">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="text-sm font-semibold text-foreground">
                        {status === "booting"
                          ? "Booting in-browser Node.js runtime..."
                          : status === "mounting"
                            ? "Mounting project files..."
                            : status === "installing"
                              ? "Installing project dependencies with npm..."
                              : status === "starting-server"
                                ? "Starting Next.js development server..."
                                : "Preparing live preview..."}
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Executing safely inside your browser using
                        WebContainers.
                      </p>
                    </div>

                    {logs.length > 0 && (
                      <p className="text-[11px] font-mono text-muted-foreground/80 truncate max-w-xs bg-muted/40 px-2 py-1 rounded border border-border/40">
                        {logs[logs.length - 1]}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 3. Collapsible WebContainer Terminal Drawer */}
        {showTerminal && (
          <div className="h-52 border-t border-border bg-black/95 text-emerald-400 font-mono text-xs flex flex-col shrink-0 select-text z-20 shadow-lg">
            {/* Terminal Header */}
            <div className="h-7 px-3 border-b border-border/40 bg-white/5 flex items-center justify-between shrink-0 text-muted-foreground select-none">
              <div className="flex items-center gap-2 text-[11px]">
                <Terminal className="h-3 w-3 text-emerald-400" />
                <span className="font-semibold text-foreground">
                  WebContainer Process Output
                </span>
                <span className="text-[10px] text-muted-foreground">
                  ({logs.length} lines)
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyLogs}
                  className="px-2 py-0.5 rounded text-[10px] hover:bg-white/10 text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1"
                >
                  {hasCopiedLogs ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setTerminalExplicitState(false)}
                  className="px-1.5 py-0.5 rounded text-[11px] hover:bg-white/10 text-muted-foreground hover:text-foreground cursor-pointer"
                  title="Close terminal drawer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Terminal Output Stream */}
            <div className="flex-1 overflow-y-auto p-3 space-y-0.5 font-mono text-[11px] leading-relaxed select-text">
              {logs.length === 0 ? (
                <div className="text-muted-foreground italic">
                  No process output recorded yet.
                </div>
              ) : (
                logs.map((log, idx) => (
                  <div
                    key={`${idx}_${log.slice(0, 10)}`}
                    className={cn(
                      "whitespace-pre-wrap break-words",
                      log.includes("ERROR") || log.includes("failed")
                        ? "text-rose-400"
                        : log.includes("ready") || log.includes("Synced")
                          ? "text-emerald-400"
                          : "text-zinc-300",
                    )}
                  >
                    {log}
                  </div>
                ))
              )}
              <div ref={terminalLogsEndRef} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
