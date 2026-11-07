/**
 * Type definitions for Foundry's WebContainer browser runtime.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2, §5.3, and Prompt §3, §9, §10.
 */

export type WebContainerStatus =
  | "idle"
  | "unsupported"
  | "booting"
  | "mounting"
  | "installing"
  | "starting-server"
  | "ready"
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
};

export type FileEntry = {
  readonly path: string;
  readonly content: string;
};

export type WebContainerListener = (state: WebContainerState) => void;
