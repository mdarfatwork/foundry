/**
 * Core type definitions for Foundry's AI-generated code verification and self-repair pipeline.
 * Adheres to AGENTS.md §1, §5.2, §5.3, and Project Prompt §5, §6, §8, §9.
 */

export type VerificationStatus =
  "idle" | "verifying" | "verified" | "verified_with_warnings" | "failed";

export type VerificationStage =
  | "manifest"
  | "dependencies"
  | "typecheck"
  | "lint"
  | "build"
  | "preview"
  | "runtime"
  | "smoke"
  | "repair"
  | "completed";

export type DiagnosticSeverity = "fatal" | "error" | "warning" | "info";

export type DiagnosticSource =
  | "manifest"
  | "typescript"
  | "eslint"
  | "build"
  | "dev_server"
  | "browser_console"
  | "react_warning"
  | "runtime_exception"
  | "network"
  | "smoke_test"
  | "toolchain";

export type VerificationDiagnostic = Readonly<{
  id: string;
  severity: DiagnosticSeverity;
  source: DiagnosticSource;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  stack?: string;
  componentStack?: string;
  fixable: boolean;
  suggestedFix?: string;
  timestamp: number;
}>;

export type VerificationStageStatus =
  "pending" | "running" | "passed" | "warning" | "failed" | "skipped";

export type VerificationStageResult = Readonly<{
  stage: VerificationStage;
  status: VerificationStageStatus;
  durationMs: number;
  diagnostics: readonly VerificationDiagnostic[];
  output?: string;
  details?: Record<string, unknown>;
}>;

export type SmokeTestItem = Readonly<{
  id: string;
  name: string;
  status: "passed" | "failed" | "skipped";
  message?: string;
  selector?: string;
}>;

export type SmokeTestSummary = Readonly<{
  passed: boolean;
  items: readonly SmokeTestItem[];
  durationMs: number;
}>;

export type VerificationResult = Readonly<{
  id: string;
  projectId: string;
  status: VerificationStatus;
  passed: boolean;
  hasWarnings: boolean;
  errorCount: number;
  warningCount: number;
  currentStage?: VerificationStage;
  stages: Readonly<Partial<Record<VerificationStage, VerificationStageResult>>>;
  diagnostics: readonly VerificationDiagnostic[];
  smokeSummary?: SmokeTestSummary;
  repairAttempts: number;
  repairApplied: boolean;
  totalDurationMs: number;
  timestamp: number;
}>;

export type BrowserDiagnosticPayload = Readonly<{
  type: "FOUNDRY_PREVIEW_DIAGNOSTIC";
  source: "react_warning" | "runtime_exception" | "browser_console" | "network";
  severity: "error" | "warn" | "info";
  message: string;
  stack?: string;
  componentStack?: string;
  url?: string;
  line?: number;
  column?: number;
  timestamp: number;
}>;

export type BrowserSmokeTestPayload = Readonly<{
  type: "FOUNDRY_PREVIEW_SMOKE_RESULT";
  summary: SmokeTestSummary;
  timestamp: number;
}>;

export type VerificationPipelineOptions = Readonly<{
  skipBuild?: boolean;
  skipLint?: boolean;
  skipSmokeTests?: boolean;
  maxRepairAttempts?: number;
  runtimeInspectionDurationMs?: number;
  onStageChange?: (
    stage: VerificationStage,
    status: VerificationStageStatus,
  ) => void;
  onDiagnostic?: (diagnostic: VerificationDiagnostic) => void;
}>;
