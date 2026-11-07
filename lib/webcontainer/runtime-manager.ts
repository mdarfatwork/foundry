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

class WebContainerRuntimeManager {
  private instance: WebContainer | null = null;
  private bootPromise: Promise<WebContainer> | null = null;
  private devProcess: WebContainerProcess | null = null;
  private installProcess: WebContainerProcess | null = null;
  private listeners: Set<WebContainerListener> = new Set();
  private serverReadyTimer: ReturnType<typeof setTimeout> | null = null;

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

  /**
   * Initializes and boots the singleton WebContainer instance.
   * Ensures only ONE instance is ever booted across the browser session.
   */
  public async getWebContainer(): Promise<WebContainer> {
    if (this.instance) {
      return this.instance;
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

    this.bootPromise = (async () => {
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
            this.appendLog(
              `[Foundry WebContainer] Port ${port} opened at ${url}`,
            );
          } else {
            this.appendLog(`[Foundry WebContainer] Port ${port} closed.`);
          }
        });

        // Register internal error events
        container.on("error", ({ message }) => {
          this.appendLog(`[Foundry WebContainer ERROR] ${message}`);
          this.updateState({ error: message });
        });

        this.appendLog(
          "[Foundry WebContainer] Browser runtime successfully booted.",
        );
        return container;
      } catch (err) {
        this.bootPromise = null;
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to boot in-browser WebContainer.";

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
      }
    })();

    return this.bootPromise;
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

    this.updateState({ status: "mounting" });
    this.appendLog(
      `[Foundry WebContainer] Mounting ${files.length} project files...`,
    );

    const tree = buildFileSystemTree(files);
    await container.mount(tree);
    this.appendLog(
      "[Foundry WebContainer] Files mounted to virtual workspace.",
    );
  }

  /**
   * Installs project dependencies using npm.
   * Only executes if dependencies have changed or forceInstall is true.
   */
  public async installDependencies(
    files: readonly FileEntry[],
    forceInstall = false,
  ): Promise<boolean> {
    const container = await this.getWebContainer();

    const packageJsonFile = files.find((f) => f.path === "package.json");
    const currentHash = packageJsonFile
      ? this.hashContent(packageJsonFile.content)
      : "no-pkg";

    // Skip installation if already installed with same package.json content
    if (
      !forceInstall &&
      this.state.lastInstalledPackageJsonHash === currentHash
    ) {
      this.appendLog(
        "[Foundry WebContainer] Dependencies up to date. Skipping npm install.",
      );
      return true;
    }

    if (this.state.isInstalling) {
      this.appendLog(
        "[Foundry WebContainer] npm install is already in progress.",
      );
      return false;
    }

    this.updateState({ status: "installing", isInstalling: true, error: null });
    this.appendLog(
      "[Foundry WebContainer] Running npm install --no-audit --no-fund --prefer-offline...",
    );

    try {
      const process = await container.spawn("npm", [
        "install",
        "--no-audit",
        "--no-fund",
        "--prefer-offline",
      ]);
      this.installProcess = process;

      // Stream stdout/stderr
      process.output.pipeTo(
        new WritableStream({
          write: (chunk) => {
            this.appendLog(chunk);
          },
        }),
      );

      const exitCode = await process.exit;
      this.installProcess = null;

      if (exitCode !== 0) {
        const errorMsg = `npm install failed with exit code ${exitCode}. Check terminal logs.`;
        this.appendLog(`[Foundry WebContainer] ${errorMsg}`);
        this.updateState({
          status: "error",
          error: errorMsg,
          isInstalling: false,
        });
        return false;
      }

      this.appendLog(
        "[Foundry WebContainer] Dependencies installed successfully.",
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

    this.updateState({
      status: "starting-server",
      isServerRunning: false,
      error: null,
    });
    this.appendLog(
      "[Foundry WebContainer] Starting Next.js development server (npm run dev)...",
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
      const process = await container.spawn("npm", ["run", "dev"]);
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

    let packageJsonChanged = false;

    for (const file of updatedFiles) {
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
      const installed = await this.installDependencies(updatedFiles, true);
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
      await this.getWebContainer();
      await this.mountProjectFiles(files);
      const installed = await this.installDependencies(files);
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

// Global browser singleton
export const runtimeManager = new WebContainerRuntimeManager();
