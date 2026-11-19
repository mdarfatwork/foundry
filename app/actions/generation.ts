"use server";

import { eq, desc } from "drizzle-orm";
import { requireUser, type AuthUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  project,
  projectFile,
  generationJob,
  message,
  projectVersion,
  runtimeLog,
} from "@/lib/db/schema";
import { getProjectByIdForUser, type ActionResponse } from "./project";
import { generateWebsite, assessClarification } from "@/lib/ai/unified";
import { inspectReferenceWebsite } from "@/lib/ai/references";
import { validateGeneratedFiles } from "@/lib/ai/validator";
import type {
  FileModification,
  ClarificationQuestion,
  ClarificationPayload,
  DesignReference,
  UrlReference,
  AIProvider,
} from "@/lib/ai/types";

/**
 * Server Actions for AI Website Generation & Clarification.
 * Orchestrates adaptive MCQ clarification, job tracking, NVIDIA model calling,
 * untrusted code validation, transactional persistence, and version snapshotting.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2, §7.1, §9, and Prompt §2, §3, §4, §5.
 */

export type GenerationActionResult =
  | {
      readonly type: "generated";
      readonly summary: string;
      readonly details: readonly string[];
      readonly updatedFiles: readonly FileModification[];
    }
  | {
      readonly type: "clarification";
      readonly messageId: string;
      readonly originalPrompt: string;
      readonly questions: readonly ClarificationQuestion[];
    };

const MIN_PROMPT_LENGTH = 3;
const MAX_PROMPT_LENGTH = 3000;

export type GenerationOptions = {
  readonly skipClarification?: boolean;
  readonly references?: readonly DesignReference[];
  readonly provider?: AIProvider;
  readonly model?: string;
};

/**
 * Executes the core code generation workflow, untrusted validation, and persistence.
 */
async function executeGeneration(
  projectId: string,
  user: AuthUser,
  promptToRun: string,
  recordUserMessage = true,
  options?: GenerationOptions,
): Promise<ActionResponse<GenerationActionResult>> {
  const trimmedId = projectId.trim();
  const trimmedPrompt = promptToRun.trim();

  // 1. Authorize: Verify Project Ownership (Strict Tenant Isolation)
  const proj = await getProjectByIdForUser(trimmedId, user.id);
  if (!proj) {
    return {
      success: false,
      code: "NOT_FOUND",
      error: "Project not found or you lack permission to generate for it.",
    };
  }

  // 2. Concurrency Control: Prevent concurrent generations from corrupting project state
  if (proj.generationStatus === "generating") {
    const isStale =
      proj.updatedAt &&
      Date.now() - new Date(proj.updatedAt).getTime() > 120_000;

    if (!isStale) {
      return {
        success: false,
        code: "CONCURRENT_GENERATION",
        error:
          "A generation is already in progress for this project. Please wait for it to complete.",
      };
    }
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const userMsgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // 3. Mark Project as Generating, Record Job, and optionally persist User Message
  if (process.env.DATABASE_URL) {
    try {
      await db
        .update(project)
        .set({
          generationStatus: "generating",
          updatedAt: new Date(),
        })
        .where(eq(project.id, trimmedId));

      await db.insert(generationJob).values({
        id: jobId,
        projectId: trimmedId,
        prompt: trimmedPrompt,
        status: "running",
        startedAt: new Date(),
      });

      if (recordUserMessage) {
        await db.insert(message).values({
          id: userMsgId,
          projectId: trimmedId,
          role: "user",
          content: trimmedPrompt,
        });
      }
    } catch (err) {
      console.error(
        "[Foundry Generation] Failed to initialize generation job in database:",
        err,
      );
      return {
        success: false,
        code: "DATABASE_ERROR",
        error: "Failed to initialize generation state.",
      };
    }
  }

  // 4. Load Current Project Files & Conversation History for Context
  let existingFiles: FileModification[] = [];
  let previousMessages: Array<{ role: "user" | "assistant"; content: string }> =
    [];
  if (process.env.DATABASE_URL) {
    try {
      const rows = await db
        .select({ path: projectFile.path, content: projectFile.content })
        .from(projectFile)
        .where(eq(projectFile.projectId, trimmedId));

      existingFiles = rows;

      const messageRows = await db
        .select({
          id: message.id,
          role: message.role,
          content: message.content,
        })
        .from(message)
        .where(eq(message.projectId, trimmedId))
        .orderBy(desc(message.createdAt))
        .limit(8);

      messageRows.reverse();

      // Exclude the current user message just inserted so it is not duplicated in previousMessages
      previousMessages = messageRows
        .filter(
          (m) =>
            m.id !== userMsgId && (m.role === "user" || m.role === "assistant"),
        )
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
    } catch (err) {
      console.error(
        "[Foundry Generation] Failed to load existing files or context:",
        err,
      );
    }
  }

  // 5. Invoke Multi-Provider Inference API with safe timeout
  const aiResult = await generateWebsite({
    prompt: trimmedPrompt,
    existingFiles,
    previousMessages,
    references: options?.references,
    provider: options?.provider,
    model: options?.model,
  });

  // 6. Handle AI Provider Failure (Preserves Existing Project Files)
  if (!aiResult.success) {
    if (process.env.DATABASE_URL) {
      try {
        await db
          .update(generationJob)
          .set({
            status: "failed",
            error: aiResult.error,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(generationJob.id, jobId));

        await db
          .update(project)
          .set({
            generationStatus: "failed",
            updatedAt: new Date(),
          })
          .where(eq(project.id, trimmedId));

        await db.insert(message).values({
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          projectId: trimmedId,
          role: "assistant",
          content: `I couldn't complete that generation request: ${aiResult.error.replace(/\.+$/, "")}. Your previous project files were preserved.`,
        });

        await db.insert(runtimeLog).values({
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          projectId: trimmedId,
          userId: user.id,
          runtimeSessionId: jobId,
          operationId: "generation",
          level: "error",
          source: "backend",
          eventType: "generation_failure",
          message: `Generation failed: ${aiResult.error}`,
          details: JSON.stringify({
            code: aiResult.code,
            provider: aiResult.provider ?? "unknown",
            model: aiResult.model ?? "unknown",
            latencyMs: aiResult.latencyMs,
            retries: aiResult.retries,
          }),
          occurredAt: new Date(),
        });
      } catch (dbErr) {
        console.error(
          "[Foundry Generation] Database error recording generation failure:",
          dbErr,
        );
      }
    }

    return {
      success: false,
      code: aiResult.code,
      error: aiResult.error,
    };
  }

  // 7. Validate AI Output Before Saving (Zero-Trust Sandbox Gate)
  const validation = validateGeneratedFiles(aiResult.output.files, {
    existingFiles,
    requiredSections: aiResult.designBrief?.sections,
  });
  if (!validation.valid) {
    if (process.env.DATABASE_URL) {
      try {
        await db
          .update(generationJob)
          .set({
            status: "failed",
            error: validation.error,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(generationJob.id, jobId));

        await db
          .update(project)
          .set({
            generationStatus: "failed",
            updatedAt: new Date(),
          })
          .where(eq(project.id, trimmedId));

        await db.insert(message).values({
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          projectId: trimmedId,
          role: "assistant",
          content: `Safety validation rejected the proposed code changes: ${validation.error}. Previous project files were preserved.`,
        });

        await db.insert(runtimeLog).values({
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          projectId: trimmedId,
          userId: user.id,
          runtimeSessionId: jobId,
          operationId: "generation",
          level: "error",
          source: "backend",
          eventType: "validation_failure",
          message: `Code safety validation failed: ${validation.error}`,
          occurredAt: new Date(),
        });
      } catch (dbErr) {
        console.error(
          "[Foundry Generation] Database error recording validation failure:",
          dbErr,
        );
      }
    }

    return {
      success: false,
      code: "VALIDATION_FAILED",
      error: validation.error,
    };
  }

  // 8. Transactionally Persist Validated Files, Snapshot Version, and Assistant Response
  if (process.env.DATABASE_URL) {
    try {
      await db.transaction(async (tx) => {
        // a. Upsert validated files
        for (const file of validation.files) {
          await tx
            .insert(projectFile)
            .values({
              id: `file_${trimmedId}_${Math.random().toString(36).substring(2, 9)}`,
              projectId: trimmedId,
              path: file.path,
              content: file.content,
            })
            .onConflictDoUpdate({
              target: [projectFile.projectId, projectFile.path],
              set: {
                content: file.content,
                updatedAt: new Date(),
              },
            });
        }

        // b. Query current complete file set to construct version snapshot
        const allCurrentFiles = await tx
          .select({ path: projectFile.path, content: projectFile.content })
          .from(projectFile)
          .where(eq(projectFile.projectId, trimmedId));

        const snapshotMap: Record<string, string> = {};
        for (const f of allCurrentFiles) {
          snapshotMap[f.path] = f.content;
        }

        // c. Determine next version number
        const existingVersions = await tx
          .select({ id: projectVersion.id })
          .from(projectVersion)
          .where(eq(projectVersion.projectId, trimmedId));

        const nextVerNumber = `v${existingVersions.length + 1}`;

        // d. Record new Version Snapshot
        await tx.insert(projectVersion).values({
          id: `ver_${trimmedId}_${nextVerNumber}`,
          projectId: trimmedId,
          versionNumber: nextVerNumber,
          prompt: trimmedPrompt,
          snapshot: JSON.stringify(snapshotMap),
        });

        // e. Mark Job Succeeded
        await tx
          .update(generationJob)
          .set({
            status: "succeeded",
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(generationJob.id, jobId));

        // f. Update Project Status (generation complete; awaiting verification)
        await tx
          .update(project)
          .set({
            generationStatus: "generated",
            updatedAt: new Date(),
          })
          .where(eq(project.id, trimmedId));

        // g. Persist Assistant Response Message
        await tx.insert(message).values({
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          projectId: trimmedId,
          role: "assistant",
          content: aiResult.output.summary,
          details:
            aiResult.output.details.length > 0
              ? JSON.stringify(aiResult.output.details)
              : null,
        });

        // h. Persist Internal Diagnostic Log
        await tx.insert(runtimeLog).values({
          id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          projectId: trimmedId,
          userId: user.id,
          runtimeSessionId: jobId,
          operationId: "generation",
          level: "info",
          source: "backend",
          eventType: "generation_success",
          message: `Generation succeeded using ${aiResult.provider}:${aiResult.model} in ${aiResult.latencyMs ?? 0}ms`,
          details: JSON.stringify({
            provider: aiResult.provider,
            model: aiResult.model,
            latencyMs: aiResult.latencyMs,
            retries: aiResult.retries,
            routeReason: aiResult.routeReason,
            usage: aiResult.usage,
            fileCount: aiResult.output.files.length,
          }),
          occurredAt: new Date(),
        });
      });
    } catch (txErr) {
      console.error(
        "[Foundry Generation] Transaction error saving generated files:",
        txErr,
      );
      return {
        success: false,
        code: "DATABASE_ERROR",
        error: "Failed to save generated files into project database.",
      };
    }
  }

  return {
    success: true,
    data: {
      type: "generated",
      summary: aiResult.output.summary,
      details: aiResult.output.details,
      updatedFiles: validation.files,
    },
  };
}

/**
 * Primary user prompt entrypoint.
 * Assesses whether clarification is needed or proceeds straight to generation.
 */
export async function generateProjectCodeAction(
  projectId: string,
  prompt: string,
  options?: GenerationOptions,
): Promise<ActionResponse<GenerationActionResult>> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to generate code.",
    };
  }

  const trimmedId = projectId?.trim();
  if (!trimmedId) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "Project ID is required.",
    };
  }

  const trimmedPrompt = prompt?.trim();
  if (!trimmedPrompt || trimmedPrompt.length < MIN_PROMPT_LENGTH) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: `Prompt must be at least ${MIN_PROMPT_LENGTH} characters.`,
    };
  }

  if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: `Prompt cannot exceed ${MAX_PROMPT_LENGTH} characters.`,
    };
  }

  // 1. Authorize: Verify Project Ownership (Strict Tenant Isolation)
  const proj = await getProjectByIdForUser(trimmedId, user.id);
  if (!proj) {
    return {
      success: false,
      code: "NOT_FOUND",
      error: "Project not found or you lack permission to generate for it.",
    };
  }

  // 2. Concurrency Control
  if (proj.generationStatus === "generating") {
    const isStale =
      proj.updatedAt &&
      Date.now() - new Date(proj.updatedAt).getTime() > 120_000;

    if (!isStale) {
      return {
        success: false,
        code: "CONCURRENT_GENERATION",
        error:
          "A generation is already in progress for this project. Please wait for it to complete.",
      };
    }
  }

  // 3. Check if Clarification is requested and necessary
  if (!options?.skipClarification) {
    const clarification = await assessClarification(
      trimmedPrompt,
      options?.references,
    );

    if (
      clarification.needsClarification &&
      clarification.questions.length > 0
    ) {
      const userMsgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const assistantMsgId = `msg_${Date.now() + 1}_${Math.random().toString(36).substring(2, 7)}`;

      const payload: ClarificationPayload = {
        type: "clarification",
        questions: clarification.questions,
        originalPrompt: trimmedPrompt,
        answered: false,
        references: options?.references,
      };

      if (process.env.DATABASE_URL) {
        try {
          // Persist user prompt
          await db.insert(message).values({
            id: userMsgId,
            projectId: trimmedId,
            role: "user",
            content: trimmedPrompt,
          });

          // Persist assistant question card
          await db.insert(message).values({
            id: assistantMsgId,
            projectId: trimmedId,
            role: "assistant",
            content:
              "To help tailor the design and features, please pick your preferred options:",
            details: JSON.stringify(payload),
          });
        } catch (dbErr) {
          console.error(
            "[Foundry Clarification] Failed to persist clarification message:",
            dbErr,
          );
        }
      }

      return {
        success: true,
        data: {
          type: "clarification",
          messageId: assistantMsgId,
          originalPrompt: trimmedPrompt,
          questions: clarification.questions,
        },
      };
    }
  }

  // 4. Generate directly if clarification not needed or skipped
  return executeGeneration(trimmedId, user, trimmedPrompt, true, options);
}

/**
 * Submits answers to clarification questions and triggers generation with the enriched brief.
 */
export async function submitClarificationAnswersAction(
  projectId: string,
  messageId: string,
  originalPrompt: string,
  answers: Record<string, readonly string[]>,
  references?: readonly DesignReference[],
  provider?: AIProvider,
  model?: string,
): Promise<ActionResponse<GenerationActionResult>> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to submit preferences.",
    };
  }

  const trimmedId = projectId?.trim();
  const trimmedPrompt = originalPrompt?.trim();
  if (!trimmedId || !trimmedPrompt) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "Project ID and prompt are required.",
    };
  }

  // Authorize: Verify Project Ownership
  const proj = await getProjectByIdForUser(trimmedId, user.id);
  if (!proj) {
    return {
      success: false,
      code: "NOT_FOUND",
      error: "Project not found or you lack permission to modify it.",
    };
  }

  // 1. Build answer summary strings
  const formattedChoices: string[] = [];
  for (const [qId, selectedOptions] of Object.entries(answers)) {
    if (selectedOptions.length > 0) {
      formattedChoices.push(`- ${qId}: ${selectedOptions.join(", ")}`);
    }
  }

  const answerSummaryText =
    formattedChoices.length > 0
      ? formattedChoices.join("\n")
      : "Selected default Foundry preferences.";

  let resolvedReferences = references;

  // 2. Mark the clarification message in DB as answered
  if (process.env.DATABASE_URL && messageId) {
    try {
      const [existingMsg] = await db
        .select()
        .from(message)
        .where(eq(message.id, messageId))
        .limit(1);

      if (existingMsg && existingMsg.details) {
        try {
          const parsed = JSON.parse(existingMsg.details);
          parsed.answered = true;
          parsed.answers = answers;
          if (!resolvedReferences && parsed.references) {
            resolvedReferences = parsed.references;
          }
          await db
            .update(message)
            .set({ details: JSON.stringify(parsed) })
            .where(eq(message.id, messageId));
        } catch {
          // Ignore JSON parse error
        }
      }

      // Record a user message documenting their choices
      await db.insert(message).values({
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        projectId: trimmedId,
        role: "user",
        content: `Design preferences selected:\n${answerSummaryText}`,
      });
    } catch (dbErr) {
      console.error(
        "[Foundry Clarification] Failed to update answered status in DB:",
        dbErr,
      );
    }
  }

  // 3. Construct the comprehensive, enriched generation brief
  const finalBrief = `${trimmedPrompt}\n\nSelected Design & Section Preferences:\n${answerSummaryText}`;

  // 4. Execute generation without recording another duplicate user prompt
  return executeGeneration(trimmedId, user, finalBrief, false, {
    references: resolvedReferences,
    provider,
    model,
  });
}

/**
 * Inspects a user-supplied inspiration website URL with SSRF guards.
 */
export async function inspectReferenceUrlAction(
  url: string,
): Promise<ActionResponse<UrlReference>> {
  try {
    await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to inspect reference URLs.",
    };
  }

  const trimmedUrl = url?.trim();
  if (!trimmedUrl) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "URL is required.",
    };
  }

  const result = await inspectReferenceWebsite(trimmedUrl);
  return {
    success: true,
    data: result,
  };
}

/**
 * Automatically repairs internal compilation, syntax, or runtime errors in project code.
 * Routes to the error_repair task on an eligible free coding model.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2 and Prompt §2, §4, §5.
 */
export async function repairProjectCodeAction(
  projectId: string,
  errorDescription: string,
): Promise<ActionResponse<GenerationActionResult>> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to repair code.",
    };
  }

  const trimmedId = projectId?.trim();
  const trimmedError = errorDescription?.trim();
  if (!trimmedId || !trimmedError) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "Project ID and error description are required.",
    };
  }

  const proj = await getProjectByIdForUser(trimmedId, user.id);
  if (!proj) {
    return {
      success: false,
      code: "NOT_FOUND",
      error: "Project not found or you lack permission to modify it.",
    };
  }

  const repairSessionId = `repair_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const repairPrompt = `The Next.js 16 application failed inside the preview environment with this internal error:

${trimmedError.slice(0, 3000)}

Please analyze the error, locate the affected file, fix the syntax/import/runtime issue, and return the corrected file(s).`;

  if (process.env.DATABASE_URL) {
    try {
      await db.insert(runtimeLog).values({
        id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        projectId: trimmedId,
        userId: user.id,
        runtimeSessionId: repairSessionId,
        operationId: "auto-repair",
        level: "warn",
        source: "backend",
        eventType: "auto_repair_started",
        message: `Autonomous self-repair started for internal error: ${trimmedError.slice(0, 200)}`,
        details: JSON.stringify({ error: trimmedError.slice(0, 1000) }),
        occurredAt: new Date(),
      });
    } catch {
      // Non-blocking log insert
    }
  }

  const result = await executeGeneration(trimmedId, user, repairPrompt, false);

  if (process.env.DATABASE_URL) {
    try {
      await db.insert(runtimeLog).values({
        id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        projectId: trimmedId,
        userId: user.id,
        runtimeSessionId: repairSessionId,
        operationId: "auto-repair",
        level: result.success ? "info" : "error",
        source: "backend",
        eventType: result.success
          ? "auto_repair_succeeded"
          : "auto_repair_failed",
        message: result.success
          ? "Autonomous self-repair successfully resolved the internal error."
          : `Autonomous self-repair failed: ${result.error}`,
        occurredAt: new Date(),
      });
    } catch {
      // Non-blocking log insert
    }
  }

  return result;
}
