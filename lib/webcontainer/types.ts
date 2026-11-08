/**
 * Type definitions for Foundry's WebContainer browser runtime.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2, §5.3, and Prompt §3, §4, §5, §8.
 */

export type WebContainerStatus =
  | "idle"
  | "booting"
  | "mounting"
  | "installing"
  | "starting"
  | "ready"
  | "recovering"
  | "failed"
  | "stopped"
  | "unsupported"
  // Legacy aliases supported for full backward compatibility
  | "starting-server"
  | "error";

export type WebContainerState = {
  readonly status: WebContainerStatus;
  readonly previewUrl: string | null;
  readonly port: number | null;
  readonly error: string | null;
  readonly logs: readonly string[];
  readonly isServerRunning: boolean;
  readonly isInstalling: boolean;
  readonly lastInstalledPackageJsonHash: string | null;
  readonly runtimeSessionId: string | null;
  readonly operationId: string | null;
  readonly packageManager: "npm" | "pnpm";
};

export type FileEntry = {
  readonly path: string;
  readonly content: string;
};

export type WebContainerListener = (state: WebContainerState) => void;
