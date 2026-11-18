"use server";

import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { verificationRun, runtimeLog } from "@/lib/db/schema";
import { getProjectByIdForUser, type ActionResponse } from "./project";
import { validateGeneratedFiles } from "@/lib/ai/validator";
import {
  buildRepairSystemPrompt,
  buildRepairUserPrompt,
} from "@/lib/ai/prompts";
import { extractStructuredOutput } from "@/lib/ai/parse";
import {
  createLanguageModelFromRegistry,
  redactSecrets,
} from "@/lib/ai/providers";
import { selectModelForTask } from "@/lib/ai/router";
import { resolveRegistryModelId } from "@/lib/ai/registry";
import { generateText } from "ai";
import {
  formatDiagnosticsReport,
  selectRelevantFilesForDiagnostics,
} from "@/lib/verification/repair";
import type {
  VerificationResult,
  VerificationDiagnostic,
} from "@/lib/verification/types";
import type { FileModification } from "@/lib/ai/types";

/**
 * Server Actions for Mandatory Verification and Bounded Self-Repair.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2, §7, §9 and Project Prompt §5, §6, §9.
 */

export type RecordVerificationInput = Readonly<{
  projectId: string;
  verification: VerificationResult;
  generationJobId?: string;
  runtimeSessionId?: string;
}>;

export type RepairVerificationInput = Readonly<{
  projectId: string;
  diagnostics: readonly VerificationDiagnostic[];
  currentFiles: readonly FileModification[];
  attemptNumber: number;
}>;

export type RepairActionResult = Readonly<{
  summary: string;
  details: readonly string[];
  updatedFiles: readonly FileModification[];
  attemptNumber: number;
}>;

/**
 * Persists a completed or updated verification run to the database.
 * Non-blocking: returns gracefully if database is unavailable.
 */
export async function recordVerificationRunAction(
  input: RecordVerificationInput,
): Promise<ActionResponse<{ recorded: boolean; id: string }>> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to record verification runs.",
    };
  }

  const trimmedProjectId = input.projectId?.trim();
  if (!trimmedProjectId) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "Project ID is required.",
    };
  }

  // Authorize project ownership
  const proj = await getProjectByIdForUser(trimmedProjectId, user.id);
  if (!proj) {
    return {
      success: false,
      code: "NOT_FOUND",
      error: "Project not found or you lack permission to access it.",
    };
  }

  const ver = input.verification;
  const runId =
    ver.id || `ver_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  if (process.env.DATABASE_URL) {
    try {
      // 1. Insert or update verificationRun record
      await db
        .insert(verificationRun)
        .values({
          id: runId,
          projectId: trimmedProjectId,
          generationJobId: input.generationJobId,
          runtimeSessionId: input.runtimeSessionId,
          status: ver.status,
          stage: ver.currentStage ?? "completed",
          errorCount: ver.errorCount,
          warningCount: ver.warningCount,
          diagnostics: JSON.stringify(ver.diagnostics.slice(0, 50)),
          stageMetrics: JSON.stringify(ver.stages),
          repairAttempts: ver.repairAttempts,
          repairSuccess: ver.repairApplied,
          completedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: verificationRun.id,
          set: {
            status: ver.status,
            stage: ver.currentStage ?? "completed",
            errorCount: ver.errorCount,
            warningCount: ver.warningCount,
            diagnostics: JSON.stringify(ver.diagnostics.slice(0, 50)),
            stageMetrics: JSON.stringify(ver.stages),
            repairAttempts: ver.repairAttempts,
            repairSuccess: ver.repairApplied,
            completedAt: new Date(),
          },
        });

      // 2. Insert summary runtime log (idempotent)
      await db
        .insert(runtimeLog)
        .values({
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          projectId: trimmedProjectId,
          userId: user.id,
          runtimeSessionId: input.runtimeSessionId || runId,
          operationId: "verification",
          level:
            ver.status === "failed"
              ? "error"
              : ver.status === "verified_with_warnings"
                ? "warn"
                : "info",
          source: "backend",
          eventType: "verification_completed",
          message: `Verification ${ver.status}: ${ver.errorCount} errors, ${ver.warningCount} warnings, ${ver.repairAttempts} repairs`,
          details: JSON.stringify({
            status: ver.status,
            errorCount: ver.errorCount,
            warningCount: ver.warningCount,
            repairAttempts: ver.repairAttempts,
            totalDurationMs: ver.totalDurationMs,
          }),
          occurredAt: new Date(),
        })
        .onConflictDoNothing();
    } catch (err) {
      console.error(
        "[Foundry Verification] Non-blocking database persistence error:",
        err,
      );
      // Safe non-blocking return
      return {
        success: true,
        data: { recorded: false, id: runId },
      };
    }
  }

  return {
    success: true,
    data: { recorded: true, id: runId },
  };
}

/**
 * Executes a targeted, bounded self-repair for verified diagnostics.
 * Operates only on affected files using the existing Vercel AI SDK free-model routing.
 */
export async function repairVerificationErrorsAction(
  input: RepairVerificationInput,
): Promise<ActionResponse<RepairActionResult>> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to repair code.",
    };
  }

  const trimmedProjectId = input.projectId?.trim();
  if (!trimmedProjectId) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "Project ID is required.",
    };
  }

  // Authorize project ownership
  const proj = await getProjectByIdForUser(trimmedProjectId, user.id);
  if (!proj) {
    return {
      success: false,
      code: "NOT_FOUND",
      error: "Project not found or you lack permission to modify it.",
    };
  }

  if (input.diagnostics.length === 0) {
    return {
      success: false,
      code: "NO_ERRORS",
      error: "No actionable diagnostics provided for repair.",
    };
  }

  // Select only files relevant to the reported errors
  const relevantFiles = selectRelevantFilesForDiagnostics(
    input.diagnostics,
    input.currentFiles,
  );
  const diagnosticsReport = formatDiagnosticsReport(input.diagnostics);

  const systemPrompt = buildRepairSystemPrompt();
  const userPrompt = buildRepairUserPrompt({
    diagnosticsReport,
    relevantFiles,
  });

  const selection = selectModelForTask("error_repair");
  if ("error" in selection) {
    return {
      success: false,
      code: "NO_FREE_PROVIDER",
      error: selection.error,
    };
  }

  const modelId = resolveRegistryModelId(selection.model);
  const languageModel = createLanguageModelFromRegistry(selection.model);

  try {
    const { text } = await generateText({
      model: languageModel,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.1,
      maxOutputTokens: selection.model.maxOutputTokens,
      abortSignal: AbortSignal.timeout(60_000),
    });

    const parsed = extractStructuredOutput(text);

    // Validate generated files through zero-trust sandbox validator
    const validation = validateGeneratedFiles(parsed.files);
    if (!validation.valid) {
      return {
        success: false,
        code: "VALIDATION_FAILED",
        error: `Repair validation rejected files: ${validation.error}`,
      };
    }

    // Persist repair audit log
    if (process.env.DATABASE_URL) {
      try {
        await db.insert(runtimeLog).values({
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          projectId: trimmedProjectId,
          userId: user.id,
          runtimeSessionId: `repair_att_${input.attemptNumber}`,
          operationId: "self_repair",
          level: "info",
          source: "backend",
          eventType: "self_repair_executed",
          message: `Self-repair attempt ${input.attemptNumber} completed via ${modelId}`,
          details: JSON.stringify({
            attemptNumber: input.attemptNumber,
            model: modelId,
            repairedFiles: validation.files.map((f) => f.path),
            summary: parsed.summary,
          }),
          occurredAt: new Date(),
        });
      } catch {
        // Non-blocking log persistence
      }
    }

    return {
      success: true,
      data: {
        summary: parsed.summary,
        details: parsed.details,
        updatedFiles: validation.files,
        attemptNumber: input.attemptNumber,
      },
    };
  } catch (err) {
    const errorMsg =
      err instanceof Error
        ? redactSecrets(err.message)
        : "Self-repair model invocation failed.";
    return {
      success: false,
      code: "REPAIR_FAILED",
      error: errorMsg,
    };
  }
}
