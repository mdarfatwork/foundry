import {
  WebContainer,
  configureAPIKey,
  type WebContainerProcess,
} from "@webcontainer/api";
import { buildFileSystemTree } from "./tree";
import type {
  WebContainerState,
  WebContainerListener,
  FileEntry,
} from "./types";
import { clientLogger } from "./logger";
import { redactSensitiveText } from "@/lib/logging/redaction";

/**
 * Singleton WebContainer Runtime Manager for Foundry.
 * Coordinates in-browser Node.js runtime boot, virtual filesystem mounting,
 * dependency caching, hot-reload incremental file syncing, Next.js dev server lifecycle,
 * persistent structured logging, and crash recovery.
 * Adheres strictly to AGENTS.md §1, §2, §5.1, §5.2, §5.3, and Prompt §3, §4, §5, §8.
 */

const MAX_LOG_LINES = 250;
const SERVER_READY_TIMEOUT_MS = 90_000;
const INSTALL_TIMEOUT_MS = 180_000;

/**
 * Identifies whether a hostname represents a local development or private network environment.
 * StackBlitz WebContainers do not require an API key on localhost or private networks.
 * Passing a domain-locked commercial API key on localhost triggers a referrer rejection error.
 */
export function isLocalOrPrivateHost(hostname: string): boolean {
  if (!hostname) return false;

  const normalized = hostname.trim().toLowerCase();

  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized === "0.0.0.0" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  // IPv4 Private Network Ranges (RFC 1918)
  if (
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(normalized)
  ) {
    return true;
  }

  return false;
}

/**
 * Ensures project files include required PostCSS dependencies for Tailwind CSS v4.
 * Injects @tailwindcss/postcss and postcss into package.json if missing,
 * preventing webpack module resolution errors in WebContainers.
 */
export function normalizeProjectFiles(
  files: readonly FileEntry[],
): readonly FileEntry[] {
  const pkgIndex = files.findIndex((f) => f.path === "package.json");
  if (pkgIndex === -1) return files;

  const pkgEntry = files[pkgIndex];
  try {
    const parsed = JSON.parse(pkgEntry.content);
    let modified = false;

    if (!parsed.devDependencies) {
      parsed.devDependencies = {};
    }

    if (
      !parsed.devDependencies["@tailwindcss/postcss"] &&
      !parsed.dependencies?.["@tailwindcss/postcss"]
    ) {
      parsed.devDependencies["@tailwindcss/postcss"] = "^4";
      modified = true;
    }

    if (
      !parsed.devDependencies["postcss"] &&
      !parsed.dependencies?.["postcss"]
    ) {
      parsed.devDependencies["postcss"] = "^8";
      modified = true;
    }

    // Ensure Next.js is present and pinned to 15.3.9 for WebContainer execution.
    // Next.js 16 App Router throws InvariantError (workStore uninitialized) in WebContainer
    // due to WASI AsyncLocalStorage context loss across asynchronous compilation boundaries.
    const currentNext =
      parsed.dependencies?.["next"] || parsed.devDependencies?.["next"];
    if (
      !currentNext ||
      typeof currentNext !== "string" ||
      currentNext.startsWith("16.") ||
      currentNext.startsWith("^16") ||
      currentNext.startsWith("~16")
    ) {
      if (!parsed.dependencies) parsed.dependencies = {};
      parsed.dependencies["next"] = "15.3.9";
      if (parsed.devDependencies?.["next"]) {
        delete parsed.devDependencies["next"];
      }
      modified = true;
    }

    // In Next 15, `--webpack` is an unknown CLI option and causes next dev to exit with code 1.
    // Ensure scripts.dev uses standard `next dev`.
    if (parsed.scripts?.dev && typeof parsed.scripts.dev === "string") {
      if (parsed.scripts.dev.includes("--webpack")) {
        parsed.scripts.dev =
          parsed.scripts.dev.replace(/\s*--webpack\b/g, "").trim() ||
          "next dev";
        modified = true;
      }
    }

    if (modified) {
      const nextFiles = [...files];
      nextFiles[pkgIndex] = {
        path: "package.json",
        content: JSON.stringify(parsed, null, 2),
      };
      return nextFiles;
    }
  } catch {
    // Malformed JSON - return untouched
  }

  return files;
}

class WebContainerRuntimeManager {
  private instance: WebContainer | null = null;
  private bootPromise: Promise<WebContainer> | null = null;
  private devProcess: WebContainerProcess | null = null;
  private installProcess: WebContainerProcess | null = null;
  private activePackageManager: "npm" | "pnpm" = "npm";
  private listeners: Set<WebContainerListener> = new Set();
  private serverReadyTimer: ReturnType<typeof setTimeout> | null = null;
  private installTimer: ReturnType<typeof setTimeout> | null = null;
  private hasAttachedListeners = false;
  private activeProjectId: string | null = null;

  private state: WebContainerState = {
    status: "idle",
    previewUrl: null,
    port: null,
    error: null,
    logs: [],
    isServerRunning: false,
    isInstalling: false,
    lastInstalledPackageJsonHash: null,
    runtimeSessionId: null,
    operationId: null,
    packageManager: "npm",
  };

  public getState(): WebContainerState {
    return this.state;
  }

  public subscribe(listener: WebContainerListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(patch: Partial<WebContainerState>): void {
    this.state = {
      ...this.state,
      ...patch,
      runtimeSessionId: clientLogger.getSessionId(),
    };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // Safe callback execution
      }
    }
  }

  public setProjectId(projectId: string): void {
    this.activeProjectId = projectId;
    clientLogger.setProjectContext(projectId);
    this.updateState({ runtimeSessionId: clientLogger.getSessionId() });
  }

  public appendLog(
    log: string,
    options?: {
      readonly level?: "debug" | "info" | "warn" | "error";
      readonly source?:
        "webcontainer" | "installer" | "dev-server" | "client" | "backend";
      readonly eventType?: string;
      readonly operationId?: string;
      readonly processExitCode?: number | null;
      readonly details?: unknown;
    },
  ): void {
    const sanitized = redactSensitiveText(log).trimEnd();
    if (!sanitized) return;

    // Persist to centralized logging transport
    clientLogger.log({
      level: options?.level ?? "info",
      source: options?.source ?? "webcontainer",
      eventType: options?.eventType ?? "runtime_output",
      message: sanitized,
      operationId: options?.operationId ?? this.state.operationId ?? undefined,
      processExitCode: options?.processExitCode,
      details: options?.details,
    });

    // In-memory ring buffer for immediate UI terminal display
    const currentLogs = this.state.logs;
    const nextLogs =
      currentLogs.length >= MAX_LOG_LINES
        ? [
            ...currentLogs.slice(currentLogs.length - MAX_LOG_LINES + 1),
            sanitized,
          ]
        : [...currentLogs, sanitized];

    this.updateState({ logs: nextLogs });
  }

  /**
   * Checks if the current browser environment supports cross-origin isolation.
   */
  public isSupported(): boolean {
    if (typeof window === "undefined") return false;
    return typeof window.crossOriginIsolated === "boolean"
      ? window.crossOriginIsolated
      : false;
  }

  private attachListeners(container: WebContainer): void {
    if (this.hasAttachedListeners) return;
    this.hasAttachedListeners = true;

    // Register global server-ready listener
    container.on("server-ready", (port, url) => {
      this.appendLog(
        `[Foundry WebContainer] Server ready at ${url} (port ${port})`,
        {
          level: "info",
          source: "dev-server",
          eventType: "server_ready",
          details: { port, url },
        },
      );
      if (this.serverReadyTimer) {
        clearTimeout(this.serverReadyTimer);
        this.serverReadyTimer = null;
      }
      this.updateState({
        status: "ready",
        previewUrl: url,
        port,
        isServerRunning: true,
        error: null,
      });
    });

    // Register port open/close events
    container.on("port", (port, type, url) => {
      if (type === "open") {
        this.appendLog(`[Foundry WebContainer] Port ${port} opened at ${url}`, {
          level: "info",
          source: "webcontainer",
          eventType: "port_open",
          details: { port, url },
        });
      } else {
        this.appendLog(`[Foundry WebContainer] Port ${port} closed.`, {
          level: "info",
          source: "webcontainer",
          eventType: "port_close",
          details: { port },
        });
      }
    });

    // Register internal error events
    container.on("error", ({ message }) => {
      this.appendLog(`[Foundry WebContainer ERROR] ${message}`, {
        level: "error",
        source: "webcontainer",
        eventType: "webcontainer_error",
        details: { message },
      });
      this.updateState({ error: message, status: "failed" });
    });
  }

  /**
   * Initializes and boots the singleton WebContainer instance.
   * Ensures only ONE instance is ever booted across the browser session.
   */
  public async getWebContainer(): Promise<WebContainer> {
    if (this.instance) {
      return this.instance;
    }

    // 1. Recover existing instance from WebContainer module static if already booted
    const livingInstance = (
      WebContainer as unknown as { _instance?: WebContainer | null }
    )._instance;
    if (livingInstance) {
      this.instance = livingInstance;
      this.attachListeners(livingInstance);
      this.appendLog(
        "[Foundry WebContainer] Connected to active in-browser runtime.",
        {
          level: "info",
          source: "webcontainer",
          eventType: "webcontainer_recovered",
        },
      );
      this.updateState({ status: "idle", error: null });
      return livingInstance;
    }

    if (globalForWebContainer.__foundry_boot_promise__) {
      return globalForWebContainer.__foundry_boot_promise__;
    }

    if (this.bootPromise) {
      return this.bootPromise;
    }

    if (!this.isSupported()) {
      const msg =
        "Cross-Origin Isolation is required to run in-browser WebContainers. Please ensure your browser supports SharedArrayBuffer and COOP/COEP headers are active.";
      this.updateState({
        status: "unsupported",
        error: msg,
      });
      this.appendLog(`[Foundry WebContainer Error] ${msg}`, {
        level: "error",
        source: "webcontainer",
        eventType: "isolation_missing",
      });
      throw new Error(msg);
    }

    this.updateState({
      status: "booting",
      error: null,
      operationId: "boot",
    });
    this.appendLog(
      "[Foundry WebContainer] Initializing in-browser Node.js runtime...",
      {
        level: "info",
        source: "webcontainer",
        eventType: "webcontainer_boot_start",
        operationId: "boot",
      },
    );

    const bootP = (async () => {
      try {
        const apiKey = process.env.NEXT_PUBLIC_WEBCONTAINER_API_KEY?.trim();
        const hostname =
          typeof window !== "undefined" ? window.location.hostname : "";
        const isLocal = isLocalOrPrivateHost(hostname);
        const forceKey =
          process.env.NEXT_PUBLIC_WEBCONTAINER_FORCE_KEY === "true";

        if (apiKey && (!isLocal || forceKey)) {
          try {
            configureAPIKey(apiKey);
            this.appendLog(
              "[Foundry WebContainer] WebContainer client key configured for production domain.",
              {
                level: "info",
                source: "webcontainer",
                eventType: "api_key_configured",
              },
            );
          } catch {
            // Ignore if already configured
          }
        } else if (isLocal) {
          this.appendLog(
            "[Foundry WebContainer] Running in local environment; using standard WebContainer runtime.",
            {
              level: "debug",
              source: "webcontainer",
              eventType: "local_runtime_selected",
            },
          );
        }

        const container = await WebContainer.boot({
          coep: "credentialless",
          workdirName: "foundry-app",
        });

        this.instance = container;
        this.attachListeners(container);

        this.appendLog(
          "[Foundry WebContainer] Browser runtime successfully booted.",
          {
            level: "info",
            source: "webcontainer",
            eventType: "webcontainer_boot_success",
            operationId: "boot",
          },
        );
        return container;
      } catch (err) {
        this.bootPromise = null;
        globalForWebContainer.__foundry_boot_promise__ = null;
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to boot in-browser WebContainer.";

        // If WebContainer reports it is already booted, recover the living instance
        const existingAfterError = (
          WebContainer as unknown as { _instance?: WebContainer | null }
        )._instance;
        if (
          existingAfterError ||
          msg.includes("Only a single WebContainer instance can be booted")
        ) {
          const recovered =
            existingAfterError ??
            (WebContainer as unknown as { _instance?: WebContainer | null })
              ._instance;
          if (recovered) {
            this.appendLog(
              "[Foundry WebContainer] Reconnected to living in-browser WebContainer runtime.",
              {
                level: "info",
                source: "webcontainer",
                eventType: "webcontainer_recovered",
              },
            );
            this.instance = recovered;
            this.attachListeners(recovered);
            this.updateState({ status: "idle", error: null });
            return recovered;
          }
        }

        if (msg.toLowerCase().includes("referrer")) {
          const origin =
            typeof window !== "undefined"
              ? window.location.origin
              : "current origin";
          this.appendLog(
            `[Foundry WebContainer Diagnostic] Referrer check failed for origin "${origin}". StackBlitz WebContainer API keys restrict allowed domains. For local development, remove NEXT_PUBLIC_WEBCONTAINER_API_KEY from .env.local. For production, add "${origin}" to allowed origins in your StackBlitz Developer Console.`,
            {
              level: "error",
              source: "webcontainer",
              eventType: "referrer_check_failed",
            },
          );
        }

        this.appendLog(`[Foundry WebContainer Boot Failure] ${msg}`, {
          level: "error",
          source: "webcontainer",
          eventType: "webcontainer_boot_failure",
          details: { error: msg },
        });
        this.updateState({ status: "failed", error: msg });
        throw err;
      } finally {
        globalForWebContainer.__foundry_boot_promise__ = null;
      }
    })();

    this.bootPromise = bootP;
    globalForWebContainer.__foundry_boot_promise__ = bootP;
    return bootP;
  }

  /**
   * Simple hash helper to detect whether package.json has meaningfully changed.
   */
  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return String(hash);
  }

  /**
   * Mounts all project files into the running WebContainer filesystem.
   */
  public async mountProjectFiles(files: readonly FileEntry[]): Promise<void> {
    const container = await this.getWebContainer();
    const normalizedFiles = normalizeProjectFiles(files);

    this.updateState({
      status: "mounting",
      operationId: "mount",
    });
    this.appendLog(
      `[Foundry WebContainer] Mounting ${normalizedFiles.length} project files...`,
      {
        level: "info",
        source: "webcontainer",
        eventType: "mount_start",
        operationId: "mount",
        details: { fileCount: normalizedFiles.length },
      },
    );

    try {
      const tree = buildFileSystemTree(normalizedFiles);
      await container.mount(tree);
      this.appendLog(
        "[Foundry WebContainer] Files mounted to virtual workspace.",
        {
          level: "info",
          source: "webcontainer",
          eventType: "mount_success",
          operationId: "mount",
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to mount files";
      this.appendLog(`[Foundry WebContainer Mount Error] ${msg}`, {
        level: "error",
        source: "webcontainer",
        eventType: "mount_error",
        operationId: "mount",
        details: { error: msg },
      });
      this.updateState({ status: "failed", error: msg });
      throw err;
    }
  }

  /**
   * Installs project dependencies using npm (the standard, native WebContainers package manager).
   * Only executes if dependencies have changed or forceInstall is true.
   */
  public async installDependencies(
    files: readonly FileEntry[],
    forceInstall = false,
  ): Promise<boolean> {
    const container = await this.getWebContainer();
    const normalizedFiles = normalizeProjectFiles(files);

    const packageJsonFile = normalizedFiles.find(
      (f) => f.path === "package.json",
    );
    const currentHash = packageJsonFile
      ? this.hashContent(packageJsonFile.content)
      : "no-pkg";

    // Skip installation if already installed with same package.json content
    if (
      !forceInstall &&
      this.state.lastInstalledPackageJsonHash === currentHash
    ) {
      this.appendLog(
        `[Foundry WebContainer] Dependencies up to date. Skipping ${this.activePackageManager} install.`,
        {
          level: "debug",
          source: "installer",
          eventType: "install_skipped_cached",
        },
      );
      return true;
    }

    if (this.state.isInstalling) {
      this.appendLog(
        `[Foundry WebContainer] ${this.activePackageManager} install is already in progress.`,
        {
          level: "warn",
          source: "installer",
          eventType: "install_already_running",
        },
      );
      return false;
    }

    this.updateState({
      status: "installing",
      isInstalling: true,
      error: null,
      operationId: "install",
    });

    const pm = this.activePackageManager;
    this.appendLog(
      `[Foundry WebContainer] Running ${pm} install --prefer-offline...`,
      {
        level: "info",
        source: "installer",
        eventType: "install_start",
        operationId: "install",
        details: { packageManager: pm },
      },
    );

    // Bounded timeout for dependency installation
    if (this.installTimer) {
      clearTimeout(this.installTimer);
    }
    this.installTimer = setTimeout(() => {
      if (this.state.isInstalling && this.installProcess) {
        this.appendLog(
          `[Foundry WebContainer] Installation timed out after ${INSTALL_TIMEOUT_MS / 1000}s. Terminating installer process...`,
          {
            level: "error",
            source: "installer",
            eventType: "install_timeout",
            operationId: "install",
          },
        );
        try {
          this.installProcess.kill();
        } catch {
          // Ignore
        }
      }
    }, INSTALL_TIMEOUT_MS);

    try {
      const args = ["install", "--prefer-offline", "--no-audit", "--no-fund"];
      const process = await container.spawn(pm, args);
      this.installProcess = process;

      // Stream stdout/stderr
      process.output.pipeTo(
        new WritableStream({
          write: (chunk) => {
            this.appendLog(chunk, {
              level: chunk.toLowerCase().includes("err") ? "warn" : "info",
              source: "installer",
              eventType: "install_output",
              operationId: "install",
            });
          },
        }),
      );

      const exitCode = await process.exit;
      this.installProcess = null;
      if (this.installTimer) {
        clearTimeout(this.installTimer);
        this.installTimer = null;
      }

      if (exitCode !== 0) {
        const errorMsg = `${pm} install failed with exit code ${exitCode}. Check terminal logs.`;
        this.appendLog(`[Foundry WebContainer] ${errorMsg}`, {
          level: "error",
          source: "installer",
          eventType: "install_failure",
          operationId: "install",
          processExitCode: exitCode,
          details: { exitCode },
        });
        this.updateState({
          status: "failed",
          error: errorMsg,
          isInstalling: false,
        });
        return false;
      }

      this.appendLog(
        `[Foundry WebContainer] Dependencies installed successfully via ${pm}.`,
        {
          level: "info",
          source: "installer",
          eventType: "install_success",
          operationId: "install",
          processExitCode: 0,
        },
      );
      this.updateState({
        isInstalling: false,
        lastInstalledPackageJsonHash: currentHash,
      });
      return true;
    } catch (err) {
      this.installProcess = null;
      if (this.installTimer) {
        clearTimeout(this.installTimer);
        this.installTimer = null;
      }
      const errorMsg =
        err instanceof Error
          ? err.message
          : "Failed to run dependency installation.";
      this.appendLog(`[Foundry WebContainer Install Error] ${errorMsg}`, {
        level: "error",
        source: "installer",
        eventType: "install_error",
        operationId: "install",
        details: { error: errorMsg },
      });
      this.updateState({
        status: "failed",
        error: errorMsg,
        isInstalling: false,
      });
      return false;
    }
  }

  /**
   * Starts or restarts the Next.js development server.
   */
  public async startDevServer(): Promise<void> {
    const container = await this.getWebContainer();

    // If a dev server process is already running, kill it first
    if (this.devProcess) {
      this.appendLog(
        "[Foundry WebContainer] Stopping previous dev server process...",
        {
          level: "info",
          source: "dev-server",
          eventType: "dev_server_terminate_previous",
        },
      );
      try {
        this.devProcess.kill();
      } catch {
        // Ignore kill errors
      }
      this.devProcess = null;
    }

    if (this.serverReadyTimer) {
      clearTimeout(this.serverReadyTimer);
      this.serverReadyTimer = null;
    }

    const pm = this.activePackageManager;
    this.updateState({
      status: "starting",
      isServerRunning: false,
      error: null,
      operationId: "start-server",
    });
    this.appendLog(
      `[Foundry WebContainer] Starting Next.js development server (${pm} run dev)...`,
      {
        level: "info",
        source: "dev-server",
        eventType: "dev_server_spawn",
        operationId: "start-server",
        details: { packageManager: pm },
      },
    );

    // Guard timeout: If server-ready doesn't fire within 90s, report actionable error
    this.serverReadyTimer = setTimeout(() => {
      if (this.state.status === "starting") {
        const timeoutMsg =
          "Development server took longer than 90 seconds to respond. Check terminal logs for compile errors or retry.";
        this.appendLog(`[Foundry WebContainer Timeout] ${timeoutMsg}`, {
          level: "error",
          source: "dev-server",
          eventType: "dev_server_timeout",
          operationId: "start-server",
        });
        this.updateState({
          status: "failed",
          error: timeoutMsg,
        });
      }
    }, SERVER_READY_TIMEOUT_MS);

    try {
      const process = await container.spawn(pm, ["run", "dev"]);
      this.devProcess = process;

      // Stream stdout/stderr
      process.output.pipeTo(
        new WritableStream({
          write: (chunk) => {
            const isErr =
              chunk.toLowerCase().includes("error") ||
              chunk.toLowerCase().includes("failed");
            this.appendLog(chunk, {
              level: isErr ? "warn" : "info",
              source: "dev-server",
              eventType: "dev_server_output",
              operationId: "start-server",
            });
          },
        }),
      );

      // Handle premature server exit
      process.exit.then((exitCode) => {
        if (this.devProcess === process) {
          this.devProcess = null;
          this.appendLog(
            `[Foundry WebContainer] Dev server process exited with code ${exitCode}.`,
            {
              level: exitCode === 0 ? "info" : "error",
              source: "dev-server",
              eventType: "dev_server_exit",
              processExitCode: exitCode,
              details: { exitCode },
            },
          );
          if (exitCode !== 0 && this.state.status !== "ready") {
            this.updateState({
              status: "failed",
              isServerRunning: false,
              error: `Next.js development server exited with code ${exitCode}.`,
            });
          } else {
            this.updateState({ isServerRunning: false });
          }
        }
      });
    } catch (err) {
      if (this.serverReadyTimer) {
        clearTimeout(this.serverReadyTimer);
        this.serverReadyTimer = null;
      }
      const errorMsg =
        err instanceof Error
          ? err.message
          : "Failed to spawn development server.";
      this.appendLog(`[Foundry WebContainer Dev Server Error] ${errorMsg}`, {
        level: "error",
        source: "dev-server",
        eventType: "dev_server_spawn_error",
        details: { error: errorMsg },
      });
      this.updateState({
        status: "failed",
        error: errorMsg,
        isServerRunning: false,
      });
    }
  }

  /**
   * Applies file changes to the running filesystem.
   * Leverages Next.js hot module replacement (HMR) without restarting the container.
   */
  public async syncFiles(updatedFiles: readonly FileEntry[]): Promise<void> {
    if (!this.instance) {
      return;
    }

    const normalizedFiles = normalizeProjectFiles(updatedFiles);
    let packageJsonChanged = false;

    for (const file of normalizedFiles) {
      const cleanPath = file.path.replace(/\\/g, "/").replace(/^\/+/, "");
      if (cleanPath === "package.json") {
        packageJsonChanged = true;
      }

      // Ensure directory exists before writing file
      const dirIndex = cleanPath.lastIndexOf("/");
      if (dirIndex !== -1) {
        const dir = cleanPath.slice(0, dirIndex);
        try {
          await this.instance.fs.mkdir(dir, { recursive: true });
        } catch {
          // Directory already exists
        }
      }

      try {
        await this.instance.fs.writeFile(cleanPath, file.content);
        this.appendLog(`[Foundry Hot Reload] Synced ${cleanPath}`, {
          level: "debug",
          source: "client",
          eventType: "file_synced",
          details: { path: cleanPath },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Write error";
        this.appendLog(
          `[Foundry WebContainer] Failed to write ${cleanPath}: ${msg}`,
          {
            level: "error",
            source: "webcontainer",
            eventType: "file_write_error",
            details: { path: cleanPath, error: msg },
          },
        );
      }
    }

    // If package.json was modified, trigger dependency check & reinstall
    if (packageJsonChanged) {
      this.appendLog(
        "[Foundry WebContainer] package.json was modified. Reinstalling dependencies...",
        {
          level: "info",
          source: "installer",
          eventType: "package_json_changed",
        },
      );
      const installed = await this.installDependencies(normalizedFiles, true);
      if (installed) {
        await this.startDevServer();
      }
    }
  }

  /**
   * Full start or restore lifecycle:
   * Boots container -> mounts files -> installs dependencies (if needed) -> starts dev server.
   */
  public async startWorkspace(
    files: readonly FileEntry[],
    projectId?: string,
  ): Promise<void> {
    if (projectId) {
      this.setProjectId(projectId);
    }

    if (!this.isSupported()) {
      const msg =
        "WebContainers require Cross-Origin Isolation (COOP & COEP headers). Please check your browser or network.";
      this.updateState({
        status: "unsupported",
        error: msg,
      });
      return;
    }

    try {
      const normalizedFiles = normalizeProjectFiles(files);
      await this.getWebContainer();
      await this.mountProjectFiles(normalizedFiles);
      const installed = await this.installDependencies(normalizedFiles);
      if (installed) {
        await this.startDevServer();
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to start workspace preview.";
      this.updateState({ status: "failed", error: msg });
    }
  }

  /**
   * Recovers a failed workspace by re-initializing the runtime session,
   * cleaning previous processes, re-mounting files, and retrying installation/startup.
   */
  public async recoverWorkspace(
    files: readonly FileEntry[],
    forceInstall = false,
  ): Promise<void> {
    clientLogger.createNewSession();
    this.updateState({
      status: "recovering",
      error: null,
      runtimeSessionId: clientLogger.getSessionId(),
    });

    this.appendLog(
      "[Foundry WebContainer] Initiating workspace recovery attempt...",
      {
        level: "info",
        source: "client",
        eventType: "recovery_attempt",
        details: { forceInstall },
      },
    );

    // Stop current dev process if any
    if (this.devProcess) {
      try {
        this.devProcess.kill();
      } catch {
        // Ignore
      }
      this.devProcess = null;
    }

    try {
      const normalizedFiles = normalizeProjectFiles(files);
      await this.getWebContainer();
      await this.mountProjectFiles(normalizedFiles);
      const installed = await this.installDependencies(
        normalizedFiles,
        forceInstall,
      );
      if (installed) {
        await this.startDevServer();
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Workspace recovery failed.";
      this.appendLog(`[Foundry WebContainer Recovery Failed] ${msg}`, {
        level: "error",
        source: "client",
        eventType: "recovery_failed",
        details: { error: msg },
      });
      this.updateState({ status: "failed", error: msg });
    }
  }

  /**
   * Restarts the development server without reinstalling dependencies.
   */
  public async restartServer(): Promise<void> {
    this.appendLog(
      "[Foundry WebContainer] User requested dev server restart.",
      {
        level: "info",
        source: "client",
        eventType: "restart_requested",
      },
    );
    await this.startDevServer();
  }

  /**
   * Teardown action when user leaves the workspace completely.
   */
  public teardown(): void {
    if (this.serverReadyTimer) {
      clearTimeout(this.serverReadyTimer);
      this.serverReadyTimer = null;
    }

    if (this.installTimer) {
      clearTimeout(this.installTimer);
      this.installTimer = null;
    }

    if (this.devProcess) {
      try {
        this.devProcess.kill();
      } catch {
        // Ignore
      }
      this.devProcess = null;
    }

    if (this.installProcess) {
      try {
        this.installProcess.kill();
      } catch {
        // Ignore
      }
      this.installProcess = null;
    }

    this.hasAttachedListeners = false;
    if (this.instance) {
      try {
        this.instance.teardown();
      } catch {
        // Ignore
      }
      this.instance = null;
      this.bootPromise = null;
    }

    // Flush any pending logs before stopping
    void clientLogger.flush();

    this.updateState({
      status: "stopped",
      previewUrl: null,
      port: null,
      error: null,
      isServerRunning: false,
      isInstalling: false,
      lastInstalledPackageJsonHash: null,
    });
  }
}

const globalForWebContainer = globalThis as unknown as {
  __foundry_runtime_manager__?: WebContainerRuntimeManager;
  __foundry_boot_promise__?: Promise<WebContainer> | null;
};

// Global browser singleton (persisted on globalThis to prevent instance destruction across HMR)
export const runtimeManager =
  globalForWebContainer.__foundry_runtime_manager__ ??
  (globalForWebContainer.__foundry_runtime_manager__ =
    new WebContainerRuntimeManager());
