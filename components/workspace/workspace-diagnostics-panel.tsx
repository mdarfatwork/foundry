"use client";

import { useState, useCallback, useTransition } from "react";
import {
  Terminal,
  Database,
  RotateCw,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Filter,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getProjectRuntimeLogsAction,
  type RuntimeLogRecord,
} from "@/app/actions/project-logs";
import type { VerificationResult } from "@/lib/verification/types";
import { cn } from "@/lib/utils";

type DiagnosticsTab = "live" | "persisted";

type WorkspaceDiagnosticsPanelProps = Readonly<{
  projectId: string;
  liveLogs: readonly string[];
  verificationResult?: VerificationResult | null;
  onClose: () => void;
  onTriggerRepair?: () => void;
  isRepairing?: boolean;
  className?: string;
}>;

export function WorkspaceDiagnosticsPanel({
  projectId,
  liveLogs,
  verificationResult,
  onClose,
  onTriggerRepair,
  isRepairing = false,
  className,
}: WorkspaceDiagnosticsPanelProps) {
  const [activeTab, setActiveTab] = useState<DiagnosticsTab>("live");
  const [persistedLogs, setPersistedLogs] = useState<
    readonly RuntimeLogRecord[]
  >([]);
  const [isLoadingPersisted, setIsLoadingPersisted] = useState(false);
  const [persistedError, setPersistedError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Filters for Persisted Logs
  const [levelFilter, setLevelFilter] = useState<
    "all" | "error" | "warn" | "info" | "debug"
  >("all");
  const [sourceFilter, setSourceFilter] = useState<
    "all" | "webcontainer" | "installer" | "dev-server" | "client"
  >("all");

  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [hasCopiedLive, setHasCopiedLive] = useState(false);
  const [, startTransition] = useTransition();

  const fetchPersistedLogs = useCallback(
    async (
      cursor?: string,
      overrideLevel?: typeof levelFilter,
      overrideSource?: typeof sourceFilter,
    ) => {
      if (!projectId) return;
      setIsLoadingPersisted(true);
      setPersistedError(null);

      const targetLevel =
        overrideLevel !== undefined ? overrideLevel : levelFilter;
      const targetSource =
        overrideSource !== undefined ? overrideSource : sourceFilter;

      const res = await getProjectRuntimeLogsAction(projectId, {
        level: targetLevel === "all" ? undefined : targetLevel,
        source: targetSource === "all" ? undefined : targetSource,
        cursor,
        limit: 30,
      });

      startTransition(() => {
        setIsLoadingPersisted(false);
        if (res.success) {
          if (cursor) {
            setPersistedLogs((prev) => [...prev, ...res.data.logs]);
          } else {
            setPersistedLogs(res.data.logs);
          }
          setNextCursor(res.data.nextCursor);
        } else {
          setPersistedError(res.error);
        }
      });
    },
    [projectId, levelFilter, sourceFilter],
  );

  const handleCopyLive = async () => {
    if (liveLogs.length === 0) return;
    try {
      await navigator.clipboard.writeText(liveLogs.join("\n"));
      setHasCopiedLive(true);
      setTimeout(() => setHasCopiedLive(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  const errorCount = verificationResult?.errorCount ?? 0;

  return (
    <div
      className={cn(
        "h-72 border-t border-border bg-card text-foreground font-sans flex flex-col shrink-0 select-text z-20 shadow-lg",
        className,
      )}
      aria-label="Workspace diagnostics and terminal panel"
    >
      {/* Top Header Bar */}
      <div className="h-8 px-3 border-b border-border/60 bg-muted/30 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-2">
          {/* Focused Tab Switcher: Live Terminal & Persisted Logs */}
          <div className="flex items-center rounded-md bg-muted p-0.5 text-xs border border-border/40">
            <button
              type="button"
              onClick={() => setActiveTab("live")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-all cursor-pointer font-medium",
                activeTab === "live"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Terminal className="h-3 w-3 text-emerald-500" />
              <span>Live Terminal ({liveLogs.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("persisted");
                void fetchPersistedLogs();
              }}
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-all cursor-pointer font-medium",
                activeTab === "persisted"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Database className="h-3 w-3 text-primary" />
              <span>Persisted Logs</span>
            </button>
          </div>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-1.5">
          {onTriggerRepair && errorCount > 0 && (
            <Button
              type="button"
              size="xs"
              variant="destructive"
              onClick={onTriggerRepair}
              disabled={isRepairing}
              className="gap-1 text-xs cursor-pointer"
            >
              <Sparkles className="h-3 w-3" />
              <span>
                {isRepairing ? "Repairing..." : `Auto-Repair (${errorCount})`}
              </span>
            </Button>
          )}

          {activeTab === "live" && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleCopyLive}
              className="gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {hasCopiedLive ? (
                <>
                  <Check className="h-3 w-3 text-emerald-500" />
                  <span className="text-emerald-500">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Copy</span>
                </>
              )}
            </Button>
          )}

          {activeTab === "persisted" && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => fetchPersistedLogs()}
              disabled={isLoadingPersisted}
              className="gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <RotateCw
                className={cn(
                  "h-3 w-3",
                  isLoadingPersisted && "animate-spin text-primary",
                )}
              />
              <span>Refresh</span>
            </Button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 cursor-pointer text-xs"
            title="Close diagnostics panel"
            aria-label="Close diagnostics panel"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main Panel Content */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === "live" ? (
          /* Live Terminal View with Actionable Error Banner */
          <div className="flex-1 flex flex-col min-h-0">
            {verificationResult?.status === "failed" &&
              verificationResult.diagnostics.length > 0 && (
                <div className="bg-destructive/10 border-b border-destructive/20 px-3 py-1.5 text-xs flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2 text-destructive font-mono truncate min-w-0">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-semibold shrink-0">
                      Validation Issue:
                    </span>
                    <span className="truncate">
                      {verificationResult.diagnostics[0].file
                        ? `${verificationResult.diagnostics[0].file}${verificationResult.diagnostics[0].line ? `:${verificationResult.diagnostics[0].line}` : ""}: `
                        : ""}
                      {verificationResult.diagnostics[0].message}
                    </span>
                  </div>
                  {onTriggerRepair && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={onTriggerRepair}
                      disabled={isRepairing}
                      className="shrink-0 h-6 text-[11px] gap-1 text-destructive border-destructive/30 hover:bg-destructive/10 cursor-pointer"
                    >
                      <Sparkles className="h-2.5 w-2.5" />
                      <span>Repair</span>
                    </Button>
                  )}
                </div>
              )}

            <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed bg-black/95 text-zinc-300 select-text space-y-0.5">
              {liveLogs.length === 0 ? (
                <div className="text-muted-foreground italic">
                  No process output recorded yet.
                </div>
              ) : (
                liveLogs.map((log, idx) => (
                  <div
                    key={`${idx}_${log.slice(0, 10)}`}
                    className={cn(
                      "whitespace-pre-wrap break-words",
                      log.includes("ERROR") || log.includes("failed")
                        ? "text-rose-400 font-semibold"
                        : log.includes("ready") || log.includes("Synced")
                          ? "text-emerald-400"
                          : "text-zinc-300",
                    )}
                  >
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* Persisted Logs DB View */
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Filter Bar */}
            <div className="h-8 px-3 border-b border-border/40 bg-muted/20 flex items-center justify-between gap-2 shrink-0 select-none text-xs">
              <div className="flex items-center gap-2">
                <Filter className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground text-[11px]">
                  Level:
                </span>
                <select
                  value={levelFilter}
                  onChange={(e) => {
                    const nextLvl = e.target.value as typeof levelFilter;
                    setLevelFilter(nextLvl);
                    void fetchPersistedLogs(undefined, nextLvl, sourceFilter);
                  }}
                  className="bg-background text-foreground text-xs rounded border border-border px-1.5 py-0.5 cursor-pointer"
                >
                  <option value="all">All Levels</option>
                  <option value="error">Errors</option>
                  <option value="warn">Warnings</option>
                  <option value="info">Info</option>
                  <option value="debug">Debug</option>
                </select>

                <span className="text-muted-foreground text-[11px] ml-2">
                  Source:
                </span>
                <select
                  value={sourceFilter}
                  onChange={(e) => {
                    const nextSrc = e.target.value as typeof sourceFilter;
                    setSourceFilter(nextSrc);
                    void fetchPersistedLogs(undefined, levelFilter, nextSrc);
                  }}
                  className="bg-background text-foreground text-xs rounded border border-border px-1.5 py-0.5 cursor-pointer"
                >
                  <option value="all">All Sources</option>
                  <option value="webcontainer">WebContainer</option>
                  <option value="installer">Installer</option>
                  <option value="dev-server">Dev Server</option>
                  <option value="client">Client</option>
                </select>
              </div>

              <span className="text-[11px] text-muted-foreground">
                Showing {persistedLogs.length} events
              </span>
            </div>

            {/* Logs List */}
            <div className="flex-1 overflow-y-auto p-3 text-xs space-y-1">
              {persistedError ? (
                <div className="p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-xs">
                  {persistedError}
                </div>
              ) : persistedLogs.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground italic">
                  {isLoadingPersisted
                    ? "Loading persisted logs from database..."
                    : "No runtime logs found for this project."}
                </div>
              ) : (
                persistedLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const isError = log.level === "error";
                  const isWarn = log.level === "warn";

                  return (
                    <div
                      key={log.id}
                      className={cn(
                        "border rounded p-1.5 text-xs transition-colors",
                        isError
                          ? "bg-destructive/5 border-destructive/30 text-destructive"
                          : isWarn
                            ? "bg-amber-500/5 border-amber-500/30 text-amber-700 dark:text-amber-300"
                            : "border-border/60 bg-card hover:bg-muted/40",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedLogId(isExpanded ? null : log.id)
                        }
                        className="w-full flex items-center justify-between text-left gap-2 cursor-pointer font-mono"
                      >
                        <div className="flex items-center gap-2 truncate">
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0" />
                          )}
                          <span
                            className={cn(
                              "text-[10px] font-bold uppercase",
                              isError
                                ? "text-destructive"
                                : isWarn
                                  ? "text-amber-500"
                                  : "text-muted-foreground",
                            )}
                          >
                            [{log.level}]
                          </span>
                          <span className="text-muted-foreground text-[10px]">
                            {log.source}:
                          </span>
                          <span className="truncate text-foreground">
                            {log.message}
                          </span>
                        </div>

                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(log.occurredAt).toLocaleTimeString()}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="mt-2 pt-2 border-t border-border/40 font-mono text-[11px] space-y-1 text-muted-foreground">
                          {log.details && (
                            <div>
                              <span className="font-semibold text-foreground">
                                Details:
                              </span>{" "}
                              <pre className="bg-muted p-1.5 rounded mt-0.5 whitespace-pre-wrap break-words text-foreground">
                                {typeof log.details === "string"
                                  ? log.details
                                  : JSON.stringify(log.details, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {nextCursor && (
                <div className="pt-2 text-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => fetchPersistedLogs(nextCursor)}
                    disabled={isLoadingPersisted}
                    className="text-xs"
                  >
                    Load More Events
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
