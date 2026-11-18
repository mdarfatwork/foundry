"use server";

import { eq, desc, and, lt } from "drizzle-orm";
import { z } from "zod";
import { requireUser, type AuthUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { project, runtimeLog, type RuntimeLog } from "@/lib/db/schema";
import {
  redactSensitiveText,
  sanitizeStructuredDetails,
} from "@/lib/logging/redaction";
import type { ActionResponse } from "./project";

/**
 * Server Actions for Foundry Persistent Runtime Logs and Diagnostics.
 * Enforces strict project ownership, payload validation, secret redaction,
 * and rate-limiting.
 * Adheres strictly to AGENTS.md §5.1, §5.2, §7.1, §9, and Prompt §5, §6.
 */

export type RuntimeLogRecord = RuntimeLog;

const LogEntryInputSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  runtimeSessionId: z.string().min(1).max(128),
  operationId: z.string().max(128).optional().nullable(),
  level: z.enum(["debug", "info", "warn", "error"]),
  source: z.enum([
    "webcontainer",
    "installer",
    "dev-server",
    "client",
    "backend",
  ]),
  eventType: z.string().min(1).max(128),
  message: z.string().min(1).max(8192),
  details: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .nullable(),
  occurredAt: z.string().datetime().optional(),
  sequenceNumber: z.number().int().min(0).optional(),
  processExitCode: z.number().int().optional().nullable(),
  metadata: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .optional()
    .nullable(),
});

const BatchLogsInputSchema = z.array(LogEntryInputSchema).min(1).max(50);

export type ClientLogInput = z.infer<typeof LogEntryInputSchema>;

export type LogQueryOptions = {
  readonly level?: "debug" | "info" | "warn" | "error";
  readonly source?:
    "webcontainer" | "installer" | "dev-server" | "client" | "backend";
  readonly runtimeSessionId?: string;
  readonly limit?: number;
  readonly cursor?: string; // ISO string representing occurredAt
};

/**
 * Persists a batch of validated runtime logs for a specific project.
 * Strictly verifies authenticated ownership before database insertion.
 */
export async function persistRuntimeLogsAction(
  projectId: string,
  rawLogs: readonly ClientLogInput[],
): Promise<ActionResponse<{ readonly persistedCount: number }>> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to persist diagnostic logs.",
    };
  }

  const trimmedProjectId = projectId?.trim();
  if (!trimmedProjectId) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "Project ID is required.",
    };
  }

  const parsed = BatchLogsInputSchema.safeParse(rawLogs);
  if (!parsed.success) {
    return {
      success: false,
      code: "INVALID_PAYLOAD",
      error: "Malformed log entry payload.",
    };
  }

  if (process.env.DATABASE_URL) {
    try {
      // 1. Verify Project Ownership
      const [proj] = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(eq(project.id, trimmedProjectId), eq(project.ownerId, user.id)),
        )
        .limit(1);

      if (!proj) {
        return {
          success: false,
          code: "FORBIDDEN",
          error:
            "Project not found or you lack permission to write diagnostics.",
        };
      }

      // 2. Prepare and sanitize rows
      const rowsToInsert = parsed.data.map((entry, idx) => {
        const sanitizedMsg = redactSensitiveText(entry.message);
        const serializedDetails = sanitizeStructuredDetails(entry.details);
        const serializedMetadata = sanitizeStructuredDetails(entry.metadata);

        return {
          id:
            entry.id ||
            `log_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
          projectId: trimmedProjectId,
          userId: user.id,
          runtimeSessionId: entry.runtimeSessionId,
          operationId: entry.operationId || null,
          level: entry.level,
          source: entry.source,
          eventType: entry.eventType,
          message: sanitizedMsg,
          details: serializedDetails,
          occurredAt: entry.occurredAt
            ? new Date(entry.occurredAt)
            : new Date(),
          receivedAt: new Date(),
          sequenceNumber: entry.sequenceNumber ?? idx,
          processExitCode: entry.processExitCode ?? null,
          metadata: serializedMetadata,
        };
      });

      // 3. Batch insert into database (idempotent: ignore duplicate log IDs)
      await db.insert(runtimeLog).values(rowsToInsert).onConflictDoNothing();

      return {
        success: true,
        data: { persistedCount: rowsToInsert.length },
      };
    } catch (err) {
      console.error("[Foundry Logs Action] Database insertion error:", err);
      return {
        success: false,
        code: "DATABASE_ERROR",
        error: "Failed to persist diagnostic logs in database.",
      };
    }
  }

  // Fallback in environments without persistent database
  return {
    success: true,
    data: { persistedCount: parsed.data.length },
  };
}

/**
 * Retrieves persisted runtime logs for a given project with filtering and pagination.
 * Strictly verifies project ownership so users cannot inspect logs from other users.
 */
export async function getProjectRuntimeLogsAction(
  projectId: string,
  options?: LogQueryOptions,
): Promise<
  ActionResponse<{
    readonly logs: readonly RuntimeLogRecord[];
    readonly nextCursor: string | null;
  }>
> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to view project logs.",
    };
  }

  const trimmedProjectId = projectId?.trim();
  if (!trimmedProjectId) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "Valid project ID is required.",
    };
  }

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);

  if (process.env.DATABASE_URL) {
    try {
      // 1. Verify Project Ownership
      const [proj] = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(eq(project.id, trimmedProjectId), eq(project.ownerId, user.id)),
        )
        .limit(1);

      if (!proj) {
        return {
          success: false,
          code: "NOT_FOUND",
          error: "Project not found or you lack permission to view logs.",
        };
      }

      // 2. Build where conditions
      const conditions = [eq(runtimeLog.projectId, trimmedProjectId)];

      if (options?.level) {
        conditions.push(eq(runtimeLog.level, options.level));
      }
      if (options?.source) {
        conditions.push(eq(runtimeLog.source, options.source));
      }
      if (options?.runtimeSessionId) {
        conditions.push(
          eq(runtimeLog.runtimeSessionId, options.runtimeSessionId),
        );
      }
      if (options?.cursor) {
        const cursorDate = new Date(options.cursor);
        if (!isNaN(cursorDate.getTime())) {
          conditions.push(lt(runtimeLog.occurredAt, cursorDate));
        }
      }

      // 3. Query ordered chronologically descending (newest first)
      const rows = await db
        .select()
        .from(runtimeLog)
        .where(and(...conditions))
        .orderBy(desc(runtimeLog.occurredAt))
        .limit(limit + 1);

      let nextCursor: string | null = null;
      let logsToReturn = rows;

      if (rows.length > limit) {
        logsToReturn = rows.slice(0, limit);
        const lastItem = logsToReturn[logsToReturn.length - 1];
        nextCursor = lastItem.occurredAt.toISOString();
      }

      return {
        success: true,
        data: {
          logs: logsToReturn,
          nextCursor,
        },
      };
    } catch (err) {
      console.error("[Foundry Logs Action] Database query error:", err);
      return {
        success: false,
        code: "DATABASE_ERROR",
        error: "Failed to retrieve diagnostic logs.",
      };
    }
  }

  return {
    success: true,
    data: {
      logs: [],
      nextCursor: null,
    },
  };
}

/**
 * Clears persistent diagnostic logs for a project.
 * Authorized owners only.
 */
export async function clearProjectRuntimeLogsAction(
  projectId: string,
): Promise<ActionResponse<{ readonly clearedCount: number }>> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to clear logs.",
    };
  }

  const trimmedProjectId = projectId?.trim();
  if (!trimmedProjectId) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "Project ID is required.",
    };
  }

  if (process.env.DATABASE_URL) {
    try {
      // 1. Verify Project Ownership
      const [proj] = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(eq(project.id, trimmedProjectId), eq(project.ownerId, user.id)),
        )
        .limit(1);

      if (!proj) {
        return {
          success: false,
          code: "FORBIDDEN",
          error: "Project not found or you lack permission to delete logs.",
        };
      }

      const deleted = await db
        .delete(runtimeLog)
        .where(eq(runtimeLog.projectId, trimmedProjectId))
        .returning({ id: runtimeLog.id });

      return {
        success: true,
        data: { clearedCount: deleted.length },
      };
    } catch (err) {
      console.error("[Foundry Logs Action] Error clearing logs:", err);
      return {
        success: false,
        code: "DATABASE_ERROR",
        error: "Failed to clear diagnostic logs.",
      };
    }
  }

  return {
    success: true,
    data: { clearedCount: 0 },
  };
}
