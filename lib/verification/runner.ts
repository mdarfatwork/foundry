import type { WebContainer } from "@webcontainer/api";
import type {
  VerificationResult,
  VerificationStage,
  VerificationStageResult,
  VerificationDiagnostic,
  VerificationStatus,
  SmokeTestSummary,
} from "./types";
import {
  parseTypeScriptDiagnostics,
  parseESLintDiagnostics,
  parseNextBuildDiagnostics,
  deduplicateDiagnostics,
  stripAnsi,
} from "./parser";
import { redactSensitiveText } from "@/lib/logging/redaction";

/**
 * WebContainer verification runner for AI-generated applications.
 * Executes manifest checks, dependency verification, TypeScript validation,
 * ESLint static analysis, Next.js production builds, and aggregates diagnostics.
 * Adheres strictly to AGENTS.md §1, §2, §5.1, §5.2, §5.3 and Project Prompt §5, §7, §8.
 */

export type FileRecord = Readonly<{
  path: string;
  content: string;
}>;

export type SpawnCommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}>;

/**
 * Spawns a CLI command inside the running WebContainer with timeout protection.
 */
export async function runWebContainerCommand(
  container: WebContainer,
  command: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<SpawnCommandResult> {
  const startTime = Date.now();
  let stdout = "";
  const stderr = "";

  const process = await container.spawn(command, args);

  const stdoutPromise = process.output.pipeTo(
    new WritableStream({
      write(chunk) {
        stdout += chunk;
      },
    }),
  );

  const timeoutPromise = new Promise<number>((_, reject) => {
    const timer = setTimeout(() => {
      try {
        process.kill();
      } catch {
        // Ignore kill errors
      }
      reject(
        new Error(
          `Command '${command} ${args.join(" ")}' timed out after ${timeoutMs / 1000}s`,
        ),
      );
    }, timeoutMs);

    process.exit.then(() => clearTimeout(timer));
  });

  try {
    const exitCode = await Promise.race([process.exit, timeoutPromise]);
    await stdoutPromise.catch(() => {});
    return {
      exitCode,
      stdout: redactSensitiveText(stdout),
      stderr: redactSensitiveText(stderr),
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    await stdoutPromise.catch(() => {});
    return {
      exitCode: -1,
      stdout: redactSensitiveText(stdout),
      stderr: redactSensitiveText(
        stderr +
          "\n" +
          (err instanceof Error ? err.message : "Execution failed"),
      ),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Stage 1: File completeness and package manifest validation.
 */
export function verifyManifestAndFiles(
  files: readonly FileRecord[],
): VerificationStageResult {
  const start = Date.now();
  const diagnostics: VerificationDiagnostic[] = [];

  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) {
    diagnostics.push({
      id: "manifest_missing_pkg",
      severity: "fatal",
      source: "manifest",
      message: "Generated project is missing a root package.json file.",
      fixable: true,
      suggestedFix: "Ensure package.json is included in the project template.",
      timestamp: Date.now(),
    });
  } else {
    try {
      const parsed = JSON.parse(pkg.content);

      if (!parsed.dependencies?.next && !parsed.devDependencies?.next) {
        diagnostics.push({
          id: "manifest_missing_next",
          severity: "fatal",
          source: "manifest",
          file: "package.json",
          message: "package.json is missing the 'next' dependency.",
          fixable: true,
          timestamp: Date.now(),
        });
      }

      if (!parsed.dependencies?.react || !parsed.dependencies?.["react-dom"]) {
        diagnostics.push({
          id: "manifest_missing_react",
          severity: "fatal",
          source: "manifest",
          file: "package.json",
          message:
            "package.json is missing 'react' or 'react-dom' dependencies.",
          fixable: true,
          timestamp: Date.now(),
        });
      }

      // Check required scripts
      if (!parsed.scripts?.build) {
        diagnostics.push({
          id: "manifest_missing_build_script",
          severity: "error",
          source: "manifest",
          file: "package.json",
          message: "package.json is missing a 'build' script ('next build').",
          fixable: true,
          timestamp: Date.now(),
        });
      }
    } catch {
      diagnostics.push({
        id: "manifest_invalid_json",
        severity: "fatal",
        source: "manifest",
        file: "package.json",
        message: "package.json contains invalid JSON syntax.",
        fixable: true,
        timestamp: Date.now(),
      });
    }
  }

  // Check required entry points
  const pageFile = files.find((f) => f.path === "app/page.tsx");
  if (!pageFile) {
    diagnostics.push({
      id: "entry_missing_page",
      severity: "fatal",
      source: "manifest",
      message:
        "Generated project is missing mandatory entry point 'app/page.tsx'.",
      fixable: true,
      timestamp: Date.now(),
    });
  } else if (!pageFile.content.includes("export default")) {
    diagnostics.push({
      id: "entry_no_default_export",
      severity: "error",
      source: "manifest",
      file: "app/page.tsx",
      message: "'app/page.tsx' must have a default export component.",
      fixable: true,
      timestamp: Date.now(),
    });
  }

  const layoutFile = files.find((f) => f.path === "app/layout.tsx");
  if (!layoutFile) {
    diagnostics.push({
      id: "entry_missing_layout",
      severity: "error",
      source: "manifest",
      message: "Generated project is missing root layout 'app/layout.tsx'.",
      fixable: true,
      timestamp: Date.now(),
    });
  }

  const hasFatal = diagnostics.some((d) => d.severity === "fatal");
  const hasError = diagnostics.some((d) => d.severity === "error");

  return {
    stage: "manifest",
    status: hasFatal || hasError ? "failed" : "passed",
    durationMs: Date.now() - start,
    diagnostics,
  };
}

/**
 * Stage 2: TypeScript validation (`tsc --noEmit`).
 */
export async function runTypecheckStage(
  container: WebContainer,
): Promise<VerificationStageResult> {
  const cmdRes = await runWebContainerCommand(
    container,
    "npx",
    ["tsc", "--noEmit"],
    45_000,
  );
  const combinedOutput = `${cmdRes.stdout}\n${cmdRes.stderr}`;
  const diagnostics = parseTypeScriptDiagnostics(combinedOutput);

  const hasErrors = diagnostics.some((d) => d.severity === "error");
  const hasWarnings = diagnostics.some((d) => d.severity === "warning");

  // If command failed with non-zero exit code but regex didn't extract specific lines, capture fallback
  if (cmdRes.exitCode !== 0 && diagnostics.length === 0) {
    const errorSnippet =
      stripAnsi(combinedOutput).slice(-500).trim() ||
      "TypeScript compiler exited with non-zero status.";
    return {
      stage: "typecheck",
      status: "failed",
      durationMs: cmdRes.durationMs,
      diagnostics: [
        {
          id: `ts_failure_exit_${cmdRes.exitCode}`,
          severity: "error",
          source: "typescript",
          message: `TypeScript check failed with code ${cmdRes.exitCode}: ${errorSnippet}`,
          code: "TSC_CHECK_FAILED",
          fixable: true,
          timestamp: Date.now(),
        },
      ],
      output: combinedOutput.slice(0, 4000),
    };
  }

  return {
    stage: "typecheck",
    status:
      cmdRes.exitCode !== 0 || hasErrors
        ? "failed"
        : hasWarnings
          ? "warning"
          : "passed",
    durationMs: cmdRes.durationMs,
    diagnostics,
    output: combinedOutput.slice(0, 4000),
  };
}

/**
 * Stage 3: Linting and static analysis (`eslint`).
 */
export async function runLintStage(
  container: WebContainer,
): Promise<VerificationStageResult> {
  const cmdRes = await runWebContainerCommand(
    container,
    "npx",
    ["eslint", "app", "components", "lib", "--format", "stylish"],
    35_000,
  );
  const combinedOutput = `${cmdRes.stdout}\n${cmdRes.stderr}`;
  const diagnostics = parseESLintDiagnostics(combinedOutput);

  const hasErrors = diagnostics.some((d) => d.severity === "error");
  const hasWarnings = diagnostics.some((d) => d.severity === "warning");

  // If command failed with non-zero exit code but regex didn't extract specific lines, capture fallback
  if (cmdRes.exitCode !== 0 && diagnostics.length === 0) {
    const errorSnippet =
      stripAnsi(combinedOutput).slice(-500).trim() ||
      "ESLint process exited with non-zero status.";
    return {
      stage: "lint",
      status: "failed",
      durationMs: cmdRes.durationMs,
      diagnostics: [
        {
          id: `eslint_failure_exit_${cmdRes.exitCode}`,
          severity: "error",
          source: "eslint",
          message: `ESLint check failed with code ${cmdRes.exitCode}: ${errorSnippet}`,
          code: "ESLINT_CHECK_FAILED",
          fixable: true,
          timestamp: Date.now(),
        },
      ],
      output: combinedOutput.slice(0, 4000),
    };
  }

  return {
    stage: "lint",
    status:
      cmdRes.exitCode !== 0 || hasErrors
        ? "failed"
        : hasWarnings
          ? "warning"
          : "passed",
    durationMs: cmdRes.durationMs,
    diagnostics,
    output: combinedOutput.slice(0, 4000),
  };
}

/**
 * Fast verification pipeline (TypeScript + ESLint only).
 * Routine generation and repair MUST only run TypeScript checking and ESLint.
 * Next.js production build (`next build`) is NOT run during normal generation or automatic repair.
 */
export async function runFastVerificationPipeline(
  container: WebContainer,
  files: readonly FileRecord[],
): Promise<{
  manifest: VerificationStageResult;
  typecheck?: VerificationStageResult;
  lint?: VerificationStageResult;
}> {
  const manifest = verifyManifestAndFiles(files);
  if (manifest.status === "failed") {
    return { manifest };
  }

  const typecheck = await runTypecheckStage(container);
  const lint = await runLintStage(container);

  return { manifest, typecheck, lint };
}

/**
 * Stage 4: Production build (`next build --webpack`).
 * WebContainers run in a browser WebAssembly virtual sandbox without native
 * Turbopack binary bindings, so --webpack is mandatory for Next.js 16.
 */
export async function runBuildStage(
  container: WebContainer,
): Promise<VerificationStageResult> {
  const cmdRes = await runWebContainerCommand(
    container,
    "npx",
    ["next", "build", "--webpack"],
    90_000,
  );
  const combinedOutput = `${cmdRes.stdout}\n${cmdRes.stderr}`;
  const diagnostics = parseNextBuildDiagnostics(combinedOutput);

  const isFailed =
    cmdRes.exitCode !== 0 || diagnostics.some((d) => d.severity === "error");

  // If command failed but regex didn't extract specific lines, create fallback diagnostic
  if (cmdRes.exitCode !== 0 && diagnostics.length === 0) {
    const errorSnippet = combinedOutput.slice(-500).trim();
    return {
      stage: "build",
      status: "failed",
      durationMs: cmdRes.durationMs,
      diagnostics: [
        {
          id: `build_failure_exit_${cmdRes.exitCode}`,
          severity: "error",
          source: "build",
          message: `Next.js production build exited with code ${cmdRes.exitCode}: ${errorSnippet}`,
          code: "NEXT_BUILD_FAILED",
          fixable: true,
          timestamp: Date.now(),
        },
      ],
      output: combinedOutput.slice(0, 4000),
    };
  }

  return {
    stage: "build",
    status: isFailed ? "failed" : "passed",
    durationMs: cmdRes.durationMs,
    diagnostics,
    output: combinedOutput.slice(0, 4000),
  };
}

/**
 * Assembles aggregated verification status and diagnostic counts.
 */
export function aggregateVerificationResult(
  projectId: string,
  stages: Readonly<Partial<Record<VerificationStage, VerificationStageResult>>>,
  browserDiagnostics: readonly VerificationDiagnostic[] = [],
  smokeSummary?: SmokeTestSummary,
  repairAttempts = 0,
  repairApplied = false,
): VerificationResult {
  const allDiagnostics: VerificationDiagnostic[] = [];

  for (const stageResult of Object.values(stages)) {
    if (stageResult?.diagnostics) {
      allDiagnostics.push(...stageResult.diagnostics);
    }
  }

  allDiagnostics.push(...browserDiagnostics);

  const deduplicated = deduplicateDiagnostics(allDiagnostics);

  let errorCount = 0;
  let warningCount = 0;

  for (const d of deduplicated) {
    if (d.severity === "error" || d.severity === "fatal") {
      errorCount++;
    } else if (d.severity === "warning") {
      warningCount++;
    }
  }

  // Check if any stage failed
  const anyStageFailed = Object.values(stages).some(
    (s) => s?.status === "failed",
  );

  // Check smoke tests
  const smokeFailed = smokeSummary ? !smokeSummary.passed : false;

  let status: VerificationStatus = "verified";
  if (anyStageFailed || errorCount > 0 || smokeFailed) {
    status = "failed";
  } else if (warningCount > 0) {
    status = "verified_with_warnings";
  }

  const totalDurationMs = Object.values(stages).reduce(
    (acc, s) => acc + (s?.durationMs ?? 0),
    0,
  );

  return {
    id: `ver_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    projectId,
    status,
    passed: status === "verified" || status === "verified_with_warnings",
    hasWarnings: warningCount > 0,
    errorCount,
    warningCount,
    stages,
    diagnostics: deduplicated,
    smokeSummary,
    repairAttempts,
    repairApplied,
    totalDurationMs,
    timestamp: Date.now(),
  };
}
