"use client";

import { useState, useCallback, useTransition } from "react";
import {
  Terminal,
  Database,
  RotateCw,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Filter,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getProjectRuntimeLogsAction,
  type RuntimeLogRecord,
} from "@/app/actions/project-logs";
import type { LoggerState } from "@/lib/webcontainer/logger";
import { cn } from "@/lib/utils";

type DiagnosticsTab = "live" | "persisted";

type WorkspaceDiagnosticsPanelProps = Readonly<{
  projectId: string;
  liveLogs: readonly string[];
  loggerState: LoggerState;
  onClose: () => void;
  className?: string;
}>;

export function WorkspaceDiagnosticsPanel({
  projectId,
  liveLogs,
  loggerState,
  onClose,
  className,
}: WorkspaceDiagnosticsPanelProps) {
  const [activeTab, setActiveTab] = useState<DiagnosticsTab>("live");
  const [persistedLogs, setPersistedLogs] = useState<
    readonly RuntimeLogRecord[]
  >([]);
  const [isLoadingPersisted, setIsLoadingPersisted] = useState(false);
  const [persistedError, setPersistedError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // Filters
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
      // Ignore
    }
  };

  return (
    <div
      className={cn(
        "h-64 border-t border-border bg-card text-foreground font-sans flex flex-col shrink-0 select-text z-20 shadow-lg",
        className,
      )}
      aria-label="Workspace diagnostics and terminal panel"
    >
      {/* Top Header Bar */}
      <div className="h-8 px-3 border-b border-border/60 bg-muted/30 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-2">
          {/* Tab Switcher */}
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
              <span>Persisted Logs (DB)</span>
            </button>
          </div>

          {/* Sync indicator pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono bg-muted/60 text-muted-foreground border border-border/40">
            {loggerState.persistenceError ? (
              <>
                <XCircle className="h-3 w-3 text-rose-500" />
                <span className="text-rose-500 truncate max-w-[200px]">
                  {loggerState.persistenceError}
                </span>
              </>
            ) : loggerState.isPersisting ? (
              <>
                <RotateCw className="h-2.5 w-2.5 animate-spin text-primary" />
                <span>Syncing logs...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
                <span>DB Synced ({loggerState.totalSent} sent)</span>
              </>
            )}
          </div>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-1.5">
          {activeTab === "live" ? (
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
          ) : (
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
          /* Live Terminal View */
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

              <span className="text-[10px] text-muted-foreground font-mono">
                {persistedLogs.length} records
              </span>
            </div>

            {/* Persisted Logs List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-background select-text font-mono text-xs">
              {isLoadingPersisted && persistedLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <RotateCw className="h-3.5 w-3.5 animate-spin text-primary" />
                  <span>
                    Loading persisted diagnostic logs from database...
                  </span>
                </div>
              ) : persistedError ? (
                <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
                  <p className="font-semibold">Failed to load logs</p>
                  <p className="text-[11px] opacity-90">{persistedError}</p>
                </div>
              ) : persistedLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No persisted diagnostic logs found matching criteria.
                </div>
              ) : (
                persistedLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <div
                      key={log.id}
                      className="border border-border/60 rounded-md bg-card/60 p-2 text-[11px] transition-colors hover:bg-muted/30"
                    >
                      <div
                        className="flex items-start justify-between gap-2 cursor-pointer"
                        onClick={() =>
                          setExpandedLogId(isExpanded ? null : log.id)
                        }
                      >
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <button
                            type="button"
                            className="mt-0.5 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </button>

                          {/* Level Badge */}
                          {log.level === "error" ? (
                            <Badge
                              variant="destructive"
                              className="px-1 py-0 text-[9px] uppercase font-mono gap-1 shrink-0"
                            >
                              <AlertCircle className="h-2.5 w-2.5" />
                              <span>ERR</span>
                            </Badge>
                          ) : log.level === "warn" ? (
                            <Badge
                              variant="outline"
                              className="px-1 py-0 text-[9px] uppercase font-mono gap-1 text-amber-500 border-amber-500/40 shrink-0"
                            >
                              <AlertTriangle className="h-2.5 w-2.5" />
                              <span>WARN</span>
                            </Badge>
                          ) : log.level === "info" ? (
                            <Badge
                              variant="outline"
                              className="px-1 py-0 text-[9px] uppercase font-mono gap-1 text-emerald-500 border-emerald-500/40 shrink-0"
                            >
                              <Info className="h-2.5 w-2.5" />
                              <span>INFO</span>
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="px-1 py-0 text-[9px] uppercase font-mono gap-1 text-muted-foreground shrink-0"
                            >
                              <Bug className="h-2.5 w-2.5" />
                              <span>DBG</span>
                            </Badge>
                          )}

                          {/* Source Badge */}
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono shrink-0">
                            {log.source}
                          </span>

                          {/* Event type */}
                          <span className="text-[10px] text-foreground font-semibold shrink-0">
                            {log.eventType}
                          </span>

                          {/* Message snippet */}
                          <span className="truncate text-muted-foreground flex-1">
                            {log.message}
                          </span>
                        </div>

                        {/* Timestamp */}
                        <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                          {new Date(log.occurredAt).toLocaleTimeString()}
                        </span>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="mt-2 pt-2 border-t border-border/40 pl-5 space-y-1.5 text-[11px] font-mono select-text">
                          <div className="whitespace-pre-wrap break-words text-foreground bg-muted/40 p-2 rounded border border-border/40">
                            {log.message}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                            <div>
                              <span className="font-semibold text-foreground">
                                Session ID:
                              </span>{" "}
                              {log.runtimeSessionId}
                            </div>
                            <div>
                              <span className="font-semibold text-foreground">
                                Time:
                              </span>{" "}
                              {new Date(log.occurredAt).toISOString()}
                            </div>
                            {log.operationId && (
                              <div>
                                <span className="font-semibold text-foreground">
                                  Operation:
                                </span>{" "}
                                {log.operationId}
                              </div>
                            )}
                            {log.processExitCode !== null && (
                              <div>
                                <span className="font-semibold text-foreground">
                                  Exit Code:
                                </span>{" "}
                                {log.processExitCode}
                              </div>
                            )}
                          </div>

                          {log.details && (
                            <div>
                              <span className="text-[10px] font-semibold text-foreground block mb-0.5">
                                Structured Details:
                              </span>
                              <pre className="p-2 rounded bg-black/80 text-emerald-400 text-[10px] overflow-auto max-h-32">
                                {(() => {
                                  try {
                                    return JSON.stringify(
                                      JSON.parse(log.details),
                                      null,
                                      2,
                                    );
                                  } catch {
                                    return log.details;
                                  }
                                })()}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {/* Load More Button */}
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
                    Load More Logs
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
