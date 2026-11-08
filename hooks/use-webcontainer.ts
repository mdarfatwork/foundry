"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { runtimeManager } from "@/lib/webcontainer/runtime-manager";
import { clientLogger, type LoggerState } from "@/lib/webcontainer/logger";
import type { WebContainerState, FileEntry } from "@/lib/webcontainer/types";

/**
 * React hook connecting UI components to Foundry's singleton WebContainer browser runtime.
 * Guarantees zero hydration mismatch, handles background execution, and syncs terminal logs.
 * Adheres strictly to AGENTS.md §5.1, §5.4, and Prompt §3, §4, §5.
 */
export function useWebContainer() {
  const [state, setState] = useState<WebContainerState>(() =>
    runtimeManager.getState(),
  );
  const [loggerState, setLoggerState] = useState<LoggerState>(() =>
    clientLogger.getState(),
  );
  const [, startTransition] = useTransition();

  useEffect(() => {
    // Subscribe to state updates from the singleton runtimeManager
    const unsubscribeRuntime = runtimeManager.subscribe((nextState) => {
      startTransition(() => {
        setState(nextState);
      });
    });

    const unsubscribeLogger = clientLogger.subscribe((nextLoggerState) => {
      startTransition(() => {
        setLoggerState(nextLoggerState);
      });
    });

    return () => {
      unsubscribeRuntime();
      unsubscribeLogger();
    };
  }, []);

  const setProjectId = useCallback((projectId: string) => {
    runtimeManager.setProjectId(projectId);
  }, []);

  const startWorkspace = useCallback(
    async (files: readonly FileEntry[], projectId?: string) => {
      await runtimeManager.startWorkspace(files, projectId);
    },
    [],
  );

  const recoverWorkspace = useCallback(
    async (files: readonly FileEntry[], forceInstall = false) => {
      await runtimeManager.recoverWorkspace(files, forceInstall);
    },
    [],
  );

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
    runtimeSessionId: state.runtimeSessionId,
    operationId: state.operationId,
    packageManager: state.packageManager,
    isSupported: runtimeManager.isSupported(),
    loggerState,
    setProjectId,
    startWorkspace,
    recoverWorkspace,
    restartServer,
    syncFiles,
    reinstallDependencies,
  };
}
