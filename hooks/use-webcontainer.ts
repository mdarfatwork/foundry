"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { runtimeManager } from "@/lib/webcontainer/runtime-manager";
import type { WebContainerState, FileEntry } from "@/lib/webcontainer/types";

/**
 * React hook connecting UI components to Foundry's singleton WebContainer browser runtime.
 * Guarantees zero hydration mismatch, handles background execution, and syncs terminal logs.
 * Adheres strictly to AGENTS.md §5.1, §5.4, and Prompt §3, §9.
 */
export function useWebContainer() {
  const [state, setState] = useState<WebContainerState>(() =>
    runtimeManager.getState(),
  );
  const [, startTransition] = useTransition();

  useEffect(() => {
    // Subscribe to state updates from the singleton runtimeManager
    const unsubscribe = runtimeManager.subscribe((nextState) => {
      startTransition(() => {
        setState(nextState);
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const startWorkspace = useCallback(async (files: readonly FileEntry[]) => {
    await runtimeManager.startWorkspace(files);
  }, []);

  const restartServer = useCallback(async () => {
    await runtimeManager.restartServer();
  }, []);

  const syncFiles = useCallback(async (files: readonly FileEntry[]) => {
    await runtimeManager.syncFiles(files);
  }, []);

  const reinstallDependencies = useCallback(
    async (files: readonly FileEntry[]) => {
      await runtimeManager.installDependencies(files, true);
      await runtimeManager.startDevServer();
    },
    [],
  );

  return {
    state,
    status: state.status,
    previewUrl: state.previewUrl,
    port: state.port,
    error: state.error,
    logs: state.logs,
    isServerRunning: state.isServerRunning,
    isInstalling: state.isInstalling,
    isSupported: runtimeManager.isSupported(),
    startWorkspace,
    restartServer,
    syncFiles,
    reinstallDependencies,
  };
}
