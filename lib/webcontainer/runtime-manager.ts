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

/**
 * Singleton WebContainer Runtime Manager for Foundry.
 * Coordinates in-browser Node.js runtime boot, file mounting, dependency caching,
 * hot-reload incremental file syncing, Next.js dev server lifecycle, and terminal logs.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2, §5.3, and Prompt §3, §9, §10.
 */

const MAX_LOG_LINES = 250;
const SERVER_READY_TIMEOUT_MS = 90_000;

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

    // Ensure Next.js is pinned to stable 15.3.9 to prevent in-browser WebContainer
    // invariant errors (Invariant: Expected workStore to be initialized in Next 16)
    if (
      parsed.dependencies?.["next"] &&
      (parsed.dependencies["next"].startsWith("16.") ||
        parsed.dependencies["next"].startsWith("^16") ||
        parsed.dependencies["next"] === "16.4.3")
    ) {
      parsed.dependencies["next"] = "15.3.9";
      modified = true;
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
  private activePackageManager: "pnpm" | "npm" = "pnpm";
  private listeners: Set<WebContainerListener> = new Set();
  private serverReadyTimer: ReturnType<typeof setTimeout> | null = null;
  private hasAttachedListeners = false;

  private state: WebContainerState = {
    status: "idle",
    previewUrl: null,
    port: null,
    error: null,
    logs: [],
    isServerRunning: false,
    isInstalling: false,
    lastInstalledPackageJsonHash: null,
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
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public appendLog(log: string): void {
    // Redact sensitive patterns from visible runtime logs
    const sanitized = log
      .replace(/nvapi-[a-zA-Z0-9_-]+/g, "[REDACTED_API_KEY]")
      .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED_SECRET]")
      .replace(/postgres:\/\/[^@]+@/g, "postgres://[REDACTED_DB_CREDENTIALS]@")
      .trimEnd();

    if (!sanitized) return;

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
        this.appendLog(`[Foundry WebContainer] Port ${port} opened at ${url}`);
      } else {
        this.appendLog(`[Foundry WebContainer] Port ${port} closed.`);
      }
    });

    // Register internal error events
    container.on("error", ({ message }) => {
      this.appendLog(`[Foundry WebContainer ERROR] ${message}`);
      this.updateState({ error: message });
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
      this.updateState({
        status: "unsupported",
        error:
          "Cross-Origin Isolation is required to run in-browser WebContainers. Please ensure your browser supports SharedArrayBuffer and COOP/COEP headers are active.",
      });
      throw new Error("Cross-Origin Isolation not supported in this browser.");
    }

    this.updateState({ status: "booting", error: null });
    this.appendLog(
      "[Foundry WebContainer] Initializing in-browser Node.js runtime...",
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
            );
          } catch {
            // Ignore if already configured
          }
        } else if (isLocal) {
          this.appendLog(
            "[Foundry WebContainer] Running in local environment; using standard WebContainer runtime.",
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
        );
        return container;
      } catch (err) {
        this.bootPromise = null;
        globalForWebContainer.__foundry_boot_promise__ = null;
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to boot in-browser WebContainer.";

        // If WebContainer reports it is already booted, recover the living instance!
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
          );
        }

        this.appendLog(`[Foundry WebContainer Boot Failure] ${msg}`);
        this.updateState({ status: "error", error: msg });
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

    this.updateState({ status: "mounting" });
    this.appendLog(
      `[Foundry WebContainer] Mounting ${normalizedFiles.length} project files...`,
    );

    const tree = buildFileSystemTree(normalizedFiles);
    await container.mount(tree);
    this.appendLog(
      "[Foundry WebContainer] Files mounted to virtual workspace.",
    );
  }

  /**
   * Installs project dependencies using pnpm (with graceful npm fallback).
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
      );
      return true;
    }

    if (this.state.isInstalling) {
      this.appendLog(
        `[Foundry WebContainer] ${this.activePackageManager} install is already in progress.`,
      );
      return false;
    }

    this.updateState({ status: "installing", isInstalling: true, error: null });
    this.appendLog(
      "[Foundry WebContainer] Running pnpm install --prefer-offline...",
    );

    try {
      let pm: "pnpm" | "npm" = "pnpm";
      let process: WebContainerProcess;

      try {
        process = await container.spawn("pnpm", [
          "install",
          "--prefer-offline",
          "--no-frozen-lockfile",
        ]);
        this.activePackageManager = "pnpm";
      } catch (pnpmSpawnErr) {
        this.appendLog(
          `[Foundry WebContainer] pnpm spawn failed (${pnpmSpawnErr instanceof Error ? pnpmSpawnErr.message : "error"}), falling back to npm install...`,
        );
        pm = "npm";
        this.activePackageManager = "npm";
        process = await container.spawn("npm", [
          "install",
          "--no-audit",
          "--no-fund",
          "--prefer-offline",
        ]);
      }

      this.installProcess = process;

      // Stream stdout/stderr
      process.output.pipeTo(
        new WritableStream({
          write: (chunk) => {
            this.appendLog(chunk);
          },
        }),
      );

      let exitCode = await process.exit;
      this.installProcess = null;

      // If pnpm failed with non-zero exit code, fallback to npm once
      if (exitCode !== 0 && pm === "pnpm") {
        this.appendLog(
          `[Foundry WebContainer] pnpm install exited with code ${exitCode}. Retrying with npm install fallback...`,
        );
        pm = "npm";
        this.activePackageManager = "npm";

        const fallbackProcess = await container.spawn("npm", [
          "install",
          "--no-audit",
          "--no-fund",
          "--prefer-offline",
        ]);
        this.installProcess = fallbackProcess;

        fallbackProcess.output.pipeTo(
          new WritableStream({
            write: (chunk) => {
              this.appendLog(chunk);
            },
          }),
        );

        exitCode = await fallbackProcess.exit;
        this.installProcess = null;
      }

      if (exitCode !== 0) {
        const errorMsg = `${pm} install failed with exit code ${exitCode}. Check terminal logs.`;
        this.appendLog(`[Foundry WebContainer] ${errorMsg}`);
        this.updateState({
          status: "error",
          error: errorMsg,
          isInstalling: false,
        });
        return false;
      }

      this.appendLog(
        `[Foundry WebContainer] Dependencies installed successfully via ${pm}.`,
      );
      this.updateState({
        isInstalling: false,
        lastInstalledPackageJsonHash: currentHash,
      });
      return true;
    } catch (err) {
      this.installProcess = null;
      const errorMsg =
        err instanceof Error
          ? err.message
          : "Failed to run dependency installation.";
      this.appendLog(`[Foundry WebContainer Install Error] ${errorMsg}`);
      this.updateState({
        status: "error",
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
      status: "starting-server",
      isServerRunning: false,
      error: null,
    });
    this.appendLog(
      `[Foundry WebContainer] Starting Next.js development server (${pm} run dev)...`,
    );

    // Guard timeout: If server-ready doesn't fire within 90s, report actionable error
    this.serverReadyTimer = setTimeout(() => {
      if (this.state.status === "starting-server") {
        const timeoutMsg =
          "Development server took longer than 90 seconds to respond. Check terminal logs for compile errors or retry.";
        this.appendLog(`[Foundry WebContainer Timeout] ${timeoutMsg}`);
        this.updateState({
          status: "error",
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
            this.appendLog(chunk);
          },
        }),
      );

      // Handle premature server exit
      process.exit.then((exitCode) => {
        if (this.devProcess === process) {
          this.devProcess = null;
          this.appendLog(
            `[Foundry WebContainer] Dev server process exited with code ${exitCode}.`,
          );
          if (exitCode !== 0 && this.state.status !== "ready") {
            this.updateState({
              status: "error",
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
      this.appendLog(`[Foundry WebContainer Dev Server Error] ${errorMsg}`);
      this.updateState({
        status: "error",
        error: errorMsg,
        isServerRunning: false,
      });
    }
  }

  /**
   * Applies AI-generated file changes to the running filesystem.
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
        this.appendLog(`[Foundry Hot Reload] Synced ${cleanPath}`);
      } catch (err) {
        this.appendLog(
          `[Foundry WebContainer] Failed to write ${cleanPath}: ${err instanceof Error ? err.message : "Write error"}`,
        );
      }
    }

    // If package.json was modified by AI, trigger dependency check & reinstall
    if (packageJsonChanged) {
      this.appendLog(
        "[Foundry WebContainer] package.json was modified. Reinstalling dependencies...",
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
  public async startWorkspace(files: readonly FileEntry[]): Promise<void> {
    if (!this.isSupported()) {
      this.updateState({
        status: "unsupported",
        error:
          "WebContainers require Cross-Origin Isolation (COOP & COEP headers). Please check your browser or network.",
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
      this.updateState({ status: "error", error: msg });
    }
  }

  /**
   * Restarts the development server without reinstalling dependencies.
   */
  public async restartServer(): Promise<void> {
    this.appendLog("[Foundry WebContainer] User requested dev server restart.");
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

    this.updateState({
      status: "idle",
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
