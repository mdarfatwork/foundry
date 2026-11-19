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
import { WorkspaceDiagnosticsPanel } from "./workspace-diagnostics-panel";
import type { ProjectRecord, ProjectFileRecord } from "@/app/actions/project";
import type { FileModification } from "@/lib/ai/types";
import type {
  VerificationResult,
  VerificationStage,
  VerificationStageResult,
  VerificationDiagnostic,
  SmokeTestSummary,
} from "@/lib/verification/types";
import {
  classifyBrowserDiagnostic,
  deduplicateDiagnostics,
} from "@/lib/verification/parser";
import {
  verifyManifestAndFiles,
  runTypecheckStage,
  runLintStage,
  aggregateVerificationResult,
} from "@/lib/verification/runner";
import { canAttemptRepair } from "@/lib/verification/repair";
import {
  recordVerificationRunAction,
  repairVerificationErrorsAction,
} from "@/app/actions/verification";
import { runtimeManager } from "@/lib/webcontainer/runtime-manager";
import { computeFileTreeHash } from "@/lib/crypto-hash";
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
  onFilesUpdated?: (updatedFiles: readonly FileModification[]) => void;
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
  onFilesUpdated,
}: WorkspaceCanvasProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [selectedFilePath, setSelectedFilePath] =
    useState<string>("app/page.tsx");
  const [hasCopiedCode, setHasCopiedCode] = useState(false);
  const [isRefreshingIframe, setIsRefreshingIframe] = useState(false);
  const [terminalExplicitState, setTerminalExplicitState] = useState<
    boolean | null
  >(null);

  // Verification & self-repair pipeline states
  const [verificationResult, setVerificationResult] =
    useState<VerificationResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairAttempts, setRepairAttempts] = useState(0);
  const [browserDiagnostics, setBrowserDiagnostics] = useState<
    readonly VerificationDiagnostic[]
  >([]);
  const [smokeSummary, setSmokeSummary] = useState<
    SmokeTestSummary | undefined
  >(undefined);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activeSlugRef = useRef<string | null>(null);
  const previousFilesKeyRef = useRef<string>("");
  const isVerifyingRef = useRef(false);
  const isRepairingRef = useRef(false);
  const validationRunIdRef = useRef(0);
  const lastVerifiedFilesKeyRef = useRef<string>("");

  // WebContainer browser runtime controller
  const {
    status,
    previewUrl,
    error: runtimeError,
    logs,
    isSupported,
    startWorkspace,
    recoverWorkspace,
    restartServer,
    syncFiles,
  } = useWebContainer();

  // Listen for browser runtime diagnostics & smoke test results from preview iframe
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "FOUNDRY_PREVIEW_DIAGNOSTIC") {
        const diag = classifyBrowserDiagnostic(data);
        setBrowserDiagnostics((prev) =>
          deduplicateDiagnostics([...prev, diag]),
        );
      } else if (data.type === "FOUNDRY_PREVIEW_SMOKE_RESULT" && data.summary) {
        setSmokeSummary(data.summary);
      }
    };

    window.addEventListener("message", handleWindowMessage);
    return () => window.removeEventListener("message", handleWindowMessage);
  }, []);

  // Derive terminal visibility: explicit user toggle takes precedence; otherwise opens on error/failure
  const showTerminal =
    terminalExplicitState ?? (status === "failed" || status === "error");

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

  // Coordinate WebContainer workspace startup and incremental file syncing
  useEffect(() => {
    if (!isSupported || normalizedFiles.length === 0) return;

    const currentFilesKey = computeFileTreeHash(normalizedFiles);

    // Case 1: First mount or project changed -> start workspace
    if (activeSlugRef.current !== slug) {
      activeSlugRef.current = slug;
      previousFilesKeyRef.current = currentFilesKey;
      validationRunIdRef.current++;
      startWorkspace(normalizedFiles, project?.id);
      return;
    }

    // Case 2: Subsequent file updates in the same project -> sync files incrementally (HMR)
    if (previousFilesKeyRef.current !== currentFilesKey) {
      previousFilesKeyRef.current = currentFilesKey;
      // Invalidate running verification when files change
      validationRunIdRef.current++;
      syncFiles(normalizedFiles);
    }
  }, [
    slug,
    normalizedFiles,
    startWorkspace,
    syncFiles,
    isSupported,
    project?.id,
  ]);

  // Autonomous self-repair trigger: when WebContainer reports an internal compile/runtime error
  const lastReportedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      (status === "failed" || status === "error") &&
      runtimeError &&
      onRequestFixError &&
      !isGenerating &&
      lastReportedErrorRef.current !== runtimeError
    ) {
      const isInternalCodeError =
        /failed to compile/i.test(runtimeError) ||
        /syntaxerror/i.test(runtimeError) ||
        /unhandled runtime error/i.test(runtimeError) ||
        /module not found/i.test(runtimeError) ||
        /cannot find module/i.test(runtimeError);

      if (isInternalCodeError) {
        lastReportedErrorRef.current = runtimeError;
        onRequestFixError(runtimeError);
      }
    }
  }, [status, runtimeError, onRequestFixError, isGenerating]);

  const projectId = project?.id || slug;
  const handleTriggerSelfRepairRef = useRef<
    (diags?: readonly VerificationDiagnostic[]) => Promise<void>
  >(async () => {});
  const executeVerificationRef = useRef<() => Promise<void>>(async () => {});

  // Core Fast Verification Pipeline Executor (TypeScript + ESLint only; no production build)
  const executeVerification = useCallback(async () => {
    if (isVerifyingRef.current || normalizedFiles.length === 0) return;

    const filesKey = computeFileTreeHash(normalizedFiles);

    // Avoid redundant verification if this exact set of files was already verified
    if (
      lastVerifiedFilesKeyRef.current === filesKey &&
      verificationResult !== null &&
      verificationResult.passed
    ) {
      return;
    }

    const currentRunId = ++validationRunIdRef.current;
    isVerifyingRef.current = true;
    setIsVerifying(true);

    const stages: Partial<Record<VerificationStage, VerificationStageResult>> =
      {};

    try {
      // Stage 1: Manifest & entry point check
      const manifestRes = verifyManifestAndFiles(normalizedFiles);
      stages.manifest = manifestRes;

      if (currentRunId !== validationRunIdRef.current) return;

      if (manifestRes.status === "failed") {
        const aggregated = aggregateVerificationResult(
          projectId,
          stages,
          browserDiagnostics,
          smokeSummary,
          repairAttempts,
        );
        if (currentRunId !== validationRunIdRef.current) return;
        lastVerifiedFilesKeyRef.current = filesKey;
        setVerificationResult(aggregated);
        void recordVerificationRunAction({
          projectId,
          verification: aggregated,
        });
        return;
      }

      // Stage 2: WebContainer Fast Verification (TypeScript + ESLint only)
      let container = null;
      try {
        container = await runtimeManager.getWebContainer();
      } catch {
        // Container not available yet
      }

      if (currentRunId !== validationRunIdRef.current) return;

      if (container) {
        // TypeScript check (tsc --noEmit)
        const tsRes = await runTypecheckStage(container);
        if (currentRunId !== validationRunIdRef.current) return;
        stages.typecheck = tsRes;

        // ESLint check (eslint app components lib --format stylish)
        const lintRes = await runLintStage(container);
        if (currentRunId !== validationRunIdRef.current) return;
        stages.lint = lintRes;
      }

      // Stage 3: Aggregate results (No build stage during routine generation or repair)
      const finalResult = aggregateVerificationResult(
        projectId,
        stages,
        browserDiagnostics,
        smokeSummary,
        repairAttempts,
      );

      if (currentRunId !== validationRunIdRef.current) return;

      lastVerifiedFilesKeyRef.current = filesKey;
      setVerificationResult(finalResult);

      // Log genuine error diagnostics to WebContainer runtime terminal
      if (
        finalResult.status === "failed" &&
        finalResult.diagnostics.length > 0
      ) {
        for (const diag of finalResult.diagnostics) {
          if (diag.severity === "error" || diag.severity === "fatal") {
            const loc = diag.file
              ? ` (${diag.file}${diag.line ? `:${diag.line}` : ""})`
              : "";
            runtimeManager.appendLog(
              `[Foundry ${diag.source.toUpperCase()} ERROR]${loc} ${diag.message}`,
              {
                level: "error",
                source: "webcontainer",
                eventType: "validation_error",
              },
            );
          }
        }
      }

      // Persist verification run in background
      void recordVerificationRunAction({
        projectId,
        verification: finalResult,
      });

      // Stage 4: Trigger Bounded Self-Repair if fixable errors exist (max 2 attempts)
      if (
        finalResult.status === "failed" &&
        canAttemptRepair(finalResult.diagnostics, repairAttempts, 2) &&
        !isRepairingRef.current
      ) {
        await handleTriggerSelfRepairRef.current(finalResult.diagnostics);
      }
    } finally {
      if (currentRunId === validationRunIdRef.current) {
        setIsVerifying(false);
        isVerifyingRef.current = false;
      }
    }
  }, [
    normalizedFiles,
    verificationResult,
    projectId,
    browserDiagnostics,
    smokeSummary,
    repairAttempts,
  ]);

  const handleTriggerSelfRepair = useCallback(
    async (diagnosticsToFix?: readonly VerificationDiagnostic[]) => {
      const diags = diagnosticsToFix ?? verificationResult?.diagnostics ?? [];
      if (diags.length === 0 || isRepairingRef.current) return;

      isRepairingRef.current = true;
      setIsRepairing(true);
      const nextAttempt = repairAttempts + 1;
      setRepairAttempts(nextAttempt);

      try {
        const repairRes = await repairVerificationErrorsAction({
          projectId,
          diagnostics: diags,
          currentFiles: normalizedFiles,
          attemptNumber: nextAttempt,
        });

        if (repairRes.success && repairRes.data.updatedFiles.length > 0) {
          if (onFilesUpdated) {
            onFilesUpdated(repairRes.data.updatedFiles);
          }
          await syncFiles(repairRes.data.updatedFiles);

          // Automatically re-verify fixed code with TS + ESLint
          setTimeout(() => {
            void executeVerificationRef.current();
          }, 800);
        } else if (onRequestFixError && diags.length > 0) {
          // If automatic bounded repair could not resolve it, notify user in chat
          onRequestFixError(diags.map((d) => d.message).join("\n"));
        }
      } catch (err) {
        console.error("[Foundry Self-Repair] Repair failed:", err);
      } finally {
        setIsRepairing(false);
        isRepairingRef.current = false;
      }
    },
    [
      verificationResult,
      repairAttempts,
      projectId,
      normalizedFiles,
      onFilesUpdated,
      syncFiles,
      onRequestFixError,
    ],
  );

  useEffect(() => {
    executeVerificationRef.current = executeVerification;
  }, [executeVerification]);

  useEffect(() => {
    handleTriggerSelfRepairRef.current = handleTriggerSelfRepair;
  }, [handleTriggerSelfRepair]);

  // Trigger verification when dev server is ready or when generation concludes
  const previousIsGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    if (status === "ready" && normalizedFiles.length > 0 && !isGenerating) {
      const timer = setTimeout(() => {
        void executeVerification();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [status, executeVerification, normalizedFiles.length, isGenerating]);

  useEffect(() => {
    if (
      previousIsGeneratingRef.current &&
      !isGenerating &&
      normalizedFiles.length > 0
    ) {
      setRepairAttempts(0);
      // Invalidate obsolete runs and reset verification status so stale results are discarded
      validationRunIdRef.current++;
      setVerificationResult(null);
      const timer = setTimeout(() => {
        void executeVerification();
      }, 1000);
      return () => clearTimeout(timer);
    }
    previousIsGeneratingRef.current = isGenerating;
  }, [isGenerating, executeVerification, normalizedFiles.length]);

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
                  ) : isRepairing ? (
                    <>
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-500" />
                      <span className="text-[10px] font-mono text-amber-500 font-medium">
                        Repairing Code ({repairAttempts}/2)
                      </span>
                    </>
                  ) : isVerifying ? (
                    <>
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
                      <span className="text-[10px] font-mono text-primary font-medium">
                        Validating (TS + ESLint)
                      </span>
                    </>
                  ) : verificationResult?.status === "failed" ? (
                    <>
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-destructive"
                        aria-hidden="true"
                      />
                      <span className="text-[10px] font-mono text-destructive font-medium">
                        Validation Failed
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
                  ) : status === "starting" || status === "starting-server" ? (
                    <>
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-500" />
                      <span className="text-[10px] font-mono text-amber-500 font-medium">
                        Starting Next.js
                      </span>
                    </>
                  ) : status === "waiting-ready" ? (
                    <>
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-500" />
                      <span className="text-[10px] font-mono text-amber-500 font-medium">
                        Waiting for Readiness
                      </span>
                    </>
                  ) : status === "recovering" ? (
                    <>
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-500" />
                      <span className="text-[10px] font-mono text-amber-500 font-medium">
                        Recovering
                      </span>
                    </>
                  ) : status === "ready" ? (
                    verificationResult && verificationResult.passed ? (
                      <>
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"
                          aria-hidden="true"
                        />
                        <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                          Preview Ready
                        </span>
                      </>
                    ) : (
                      <>
                        <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
                        <span className="text-[10px] font-mono text-primary font-medium">
                          Validating (TS + ESLint)
                        </span>
                      </>
                    )
                  ) : status === "crashed" ? (
                    <>
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-destructive"
                        aria-hidden="true"
                      />
                      <span className="text-[10px] font-mono text-destructive font-medium">
                        Server Crashed
                      </span>
                    </>
                  ) : status === "failed" || status === "error" ? (
                    <>
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-destructive"
                        aria-hidden="true"
                      />
                      <span className="text-[10px] font-mono text-destructive font-medium">
                        Startup Failed
                      </span>
                    </>
                  ) : status === "stopped" ? (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      Stopped
                    </span>
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
              <div
                key="browser-frame-inner"
                className="flex-1 w-full h-full relative overflow-hidden bg-background flex flex-col"
              >
                {/* Validation Failure Banner: displays real error & affected file while preserving iframe preview */}
                {verificationResult?.status === "failed" &&
                verificationResult.diagnostics.length > 0 ? (
                  <div
                    key="validation-failure-banner"
                    className="bg-destructive/10 border-b border-destructive/20 px-3 py-2 flex items-center justify-between gap-3 shrink-0 z-10 text-xs"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="font-medium text-destructive flex items-center gap-1.5 flex-wrap">
                          <span>Validation Failed:</span>
                          {verificationResult.diagnostics[0].file && (
                            <span className="font-mono text-[11px] bg-destructive/15 px-1 py-0.5 rounded text-destructive">
                              {verificationResult.diagnostics[0].file}
                              {verificationResult.diagnostics[0].line
                                ? `:${verificationResult.diagnostics[0].line}`
                                : ""}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-destructive/90 font-mono truncate mt-0.5">
                          {verificationResult.diagnostics[0].message}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {canAttemptRepair(
                        verificationResult.diagnostics,
                        repairAttempts,
                        2,
                      ) ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="destructive"
                          onClick={() => void handleTriggerSelfRepair()}
                          disabled={isRepairing}
                          className="gap-1 text-xs cursor-pointer"
                        >
                          <Sparkles className="h-3 w-3" />
                          <span>
                            {isRepairing ? "Repairing..." : "Auto-Repair"}
                          </span>
                        </Button>
                      ) : onRequestFixError ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="destructive"
                          onClick={() =>
                            onRequestFixError(
                              verificationResult.diagnostics[0].message,
                            )
                          }
                          className="gap-1 text-xs cursor-pointer"
                        >
                          <Sparkles className="h-3 w-3" />
                          <span>Ask to Fix</span>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {status === "ready" && previewUrl ? (
                  <div
                    key="preview-iframe-wrapper"
                    className="w-full flex-1 relative overflow-hidden"
                  >
                    <iframe
                      ref={iframeRef}
                      src={previewUrl}
                      className="w-full h-full border-0 bg-background"
                      title="Foundry Application Preview"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                    />
                  </div>
                ) : status === "unsupported" ? (
                  <div
                    key="status-unsupported"
                    className="h-full p-8 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4"
                  >
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
                ) : status === "crashed" ||
                  status === "failed" ||
                  status === "error" ? (
                  <div
                    key="status-error"
                    className="h-full p-8 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4 select-text"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10 text-destructive shadow-2xs">
                      <AlertCircle className="h-6 w-6" />
                    </div>
                    <h3 className="text-base font-semibold text-foreground">
                      {status === "crashed"
                        ? "Development Server Crashed"
                        : "Preview Startup Failed"}
                    </h3>
                    <p className="text-xs text-destructive leading-relaxed font-mono bg-destructive/10 p-2.5 rounded border border-destructive/20 text-left w-full break-words">
                      {runtimeError ||
                        (status === "crashed"
                          ? "The development server process terminated unexpectedly."
                          : "The development server failed to start.")}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => recoverWorkspace(normalizedFiles)}
                        className="gap-1.5 text-xs"
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                        <span>Retry Preview</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => recoverWorkspace(normalizedFiles, true)}
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
                  /* Loading State (Booting / Mounting / Installing / Starting Dev Server / Waiting / Recovering) */
                  <div
                    key="status-loading"
                    className="h-full p-8 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4"
                  >
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
                              : status === "starting" ||
                                  status === "starting-server"
                                ? "Starting Next.js development server..."
                                : status === "waiting-ready"
                                  ? "Waiting for development server readiness..."
                                  : status === "recovering"
                                    ? "Recovering workspace and restarting preview..."
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

        {/* 3. Collapsible WebContainer Diagnostics & Terminal Drawer */}
        {showTerminal && (
          <WorkspaceDiagnosticsPanel
            projectId={project?.id || slug}
            liveLogs={logs}
            verificationResult={verificationResult}
            isRepairing={isRepairing}
            onTriggerRepair={() => void handleTriggerSelfRepair()}
            onClose={() => setTerminalExplicitState(false)}
          />
        )}
      </div>
    </section>
  );
}
