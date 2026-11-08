/**
 * Centralized WebContainer Client Logger and Log Transport for Foundry.
 * Manages an in-memory queue of structured diagnostic logs, handles debounce batching,
 * immediate flushing on errors, page unload flushing, client-side secret redaction,
 * and reliable background delivery to Foundry's persistent database.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2, §5.3, and Prompt §5, §8.
 */

import {
  redactSensitiveText,
  sanitizeStructuredDetails,
} from "@/lib/logging/redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSource =
  "webcontainer" | "installer" | "dev-server" | "client" | "backend";

export type ClientLogEntry = {
  readonly id: string;
  readonly projectId: string;
  readonly runtimeSessionId: string;
  readonly operationId?: string;
  readonly level: LogLevel;
  readonly source: LogSource;
  readonly eventType: string;
  readonly message: string;
  readonly details?: string | null;
  readonly occurredAt: string; // ISO string
  readonly sequenceNumber: number;
  readonly processExitCode?: number | null;
  readonly metadata?: string | null;
};

export type LoggerState = {
  readonly isPersisting: boolean;
  readonly lastPersistedAt: string | null;
  readonly persistenceError: string | null;
  readonly queuedCount: number;
  readonly totalSent: number;
};

export type LoggerListener = (state: LoggerState) => void;

const MAX_QUEUE_SIZE = 500;
const BATCH_SIZE = 25;
const FLUSH_INTERVAL_MS = 2000;
const MAX_RETRIES = 3;

export class WebContainerLogger {
  private queue: ClientLogEntry[] = [];
  private sequenceCounter = 0;
  private currentProjectId: string | null = null;
  private currentSessionId: string = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;
  private retryCount = 0;
  private listeners: Set<LoggerListener> = new Set();
  private hasRegisteredUnload = false;

  private state: LoggerState = {
    isPersisting: false,
    lastPersistedAt: null,
    persistenceError: null,
    queuedCount: 0,
    totalSent: 0,
  };

  constructor() {
    this.registerUnloadHandler();
  }

  public setProjectContext(projectId: string): void {
    if (this.currentProjectId !== projectId) {
      // Flush remaining logs for previous project if any
      if (this.queue.length > 0) {
        void this.flush();
      }
      this.currentProjectId = projectId;
      this.currentSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      this.sequenceCounter = 0;
    }
  }

  public createNewSession(): string {
    this.currentSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.sequenceCounter = 0;
    return this.currentSessionId;
  }

  public getSessionId(): string {
    return this.currentSessionId;
  }

  public getState(): LoggerState {
    return this.state;
  }

  public subscribe(listener: LoggerListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(patch: Partial<LoggerState>): void {
    this.state = { ...this.state, ...patch, queuedCount: this.queue.length };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // Safe callback execution
      }
    }
  }

  /**
   * Enqueues a new structured log entry. Redacts sensitive secrets immediately.
   */
  public log(entry: {
    readonly level: LogLevel;
    readonly source: LogSource;
    readonly eventType: string;
    readonly message: string;
    readonly details?: unknown;
    readonly operationId?: string;
    readonly processExitCode?: number | null;
    readonly metadata?: unknown;
    readonly occurredAt?: Date;
  }): void {
    const projectId = this.currentProjectId;
    if (!projectId) {
      // Can't persist without a project context; ignore quietly
      return;
    }

    const sanitizedMessage = redactSensitiveText(entry.message);
    if (!sanitizedMessage.trim()) return;

    this.sequenceCounter += 1;
    const logItem: ClientLogEntry = {
      id: `log_${Date.now()}_${this.sequenceCounter}_${Math.random().toString(36).slice(2, 6)}`,
      projectId,
      runtimeSessionId: this.currentSessionId,
      operationId: entry.operationId,
      level: entry.level,
      source: entry.source,
      eventType: entry.eventType,
      message: sanitizedMessage,
      details: sanitizeStructuredDetails(entry.details),
      occurredAt: (entry.occurredAt ?? new Date()).toISOString(),
      sequenceNumber: this.sequenceCounter,
      processExitCode: entry.processExitCode ?? null,
      metadata: sanitizeStructuredDetails(entry.metadata),
    };

    // If queue is full, drop oldest non-error logs to prevent browser memory exhaustion
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      const dropIdx = this.queue.findIndex(
        (item) => item.level === "debug" || item.level === "info",
      );
      if (dropIdx !== -1) {
        this.queue.splice(dropIdx, 1);
      } else {
        this.queue.shift();
      }
    }

    this.queue.push(logItem);
    this.updateState({});

    // Immediate flush for errors or warnings
    if (entry.level === "error" || entry.level === "warn") {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.timer || this.isFlushing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Flushes queued logs to the Foundry server persistence endpoint.
   */
  public async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0 || !this.currentProjectId) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.isFlushing = true;
    this.updateState({ isPersisting: true });

    const batch = this.queue.slice(0, BATCH_SIZE);
    const projectId = this.currentProjectId;

    try {
      const response = await fetch(`/api/projects/${projectId}/logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ logs: batch }),
      });

      if (!response.ok) {
        throw new Error(
          `Transport HTTP ${response.status}: ${response.statusText}`,
        );
      }

      // Success: Remove sent batch from queue
      this.queue.splice(0, batch.length);
      this.retryCount = 0;
      this.updateState({
        isPersisting: false,
        lastPersistedAt: new Date().toISOString(),
        persistenceError: null,
        totalSent: this.state.totalSent + batch.length,
      });

      // If more remain in queue, flush next batch
      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    } catch (err) {
      this.retryCount += 1;
      const errorMsg =
        err instanceof Error
          ? err.message
          : "Failed to persist logs to backend";

      this.updateState({
        isPersisting: false,
        persistenceError: `Sync warning: ${errorMsg} (attempt ${this.retryCount}/${MAX_RETRIES})`,
      });

      // Transient backoff if retries remaining
      if (this.retryCount < MAX_RETRIES) {
        const delay = Math.pow(2, this.retryCount) * 1000;
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, delay);
      } else {
        // Reset retry count but keep logs in memory
        this.retryCount = 0;
      }
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Flushes remaining logs on window unload using navigator.sendBeacon or keepalive fetch.
   */
  private registerUnloadHandler(): void {
    if (typeof window === "undefined" || this.hasRegisteredUnload) return;
    this.hasRegisteredUnload = true;

    const handleUnload = () => {
      if (this.queue.length === 0 || !this.currentProjectId) return;

      const batch = this.queue.slice(0, BATCH_SIZE);
      const url = `/api/projects/${this.currentProjectId}/logs`;
      const payload = JSON.stringify({ logs: batch });

      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {
          // Ignore unload errors
        });
      }
    };

    window.addEventListener("pagehide", handleUnload);
    window.addEventListener("beforeunload", handleUnload);
  }
}

export const clientLogger = new WebContainerLogger();
