import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { project, runtimeLog } from "@/lib/db/schema";
import { eq, and, desc, lt } from "drizzle-orm";
import {
  redactSensitiveText,
  sanitizeStructuredDetails,
} from "@/lib/logging/redaction";

/**
 * Authenticated REST Endpoint for Foundry Runtime Diagnostics & Logs.
 * Handles client transport flushing (including navigator.sendBeacon and keepalive fetch)
 * and paginated diagnostic log retrieval.
 * Adheres strictly to AGENTS.md §5.1, §5.5, §7.1, §9, and Prompt §5, §6.
 */

// In-memory rate limiting map: projectId -> { count, resetAt }
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_REQUESTS_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(projectId: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(projectId);

  if (!record || now > record.resetAt) {
    rateLimitMap.set(projectId, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }

  if (record.count >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }

  record.count += 1;
  return true;
}

const LogItemSchema = z.object({
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

const PostPayloadSchema = z.object({
  logs: z.array(LogItemSchema).min(1).max(50),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/projects/[id]/logs
 * Securely ingests and persists a batch of runtime diagnostic logs.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized: Authentication required." },
      { status: 401 },
    );
  }

  const { id: projectId } = await context.params;
  const trimmedId = projectId?.trim();

  if (!trimmedId) {
    return NextResponse.json({ error: "Invalid project ID." }, { status: 400 });
  }

  // Rate-limiting check per project
  if (!checkRateLimit(trimmedId)) {
    return NextResponse.json(
      { error: "Too many log write requests. Please slow down." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 },
    );
  }

  const parsed = PostPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Payload failed schema validation.",
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }

  if (process.env.DATABASE_URL) {
    try {
      // 1. Verify Project Ownership
      const [proj] = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(eq(project.id, trimmedId), eq(project.ownerId, session.user.id)),
        )
        .limit(1);

      if (!proj) {
        return NextResponse.json(
          { error: "Project not found or permission denied." },
          { status: 403 },
        );
      }

      // 2. Prepare, sanitize, and insert rows
      const rows = parsed.data.logs.map((entry, idx) => ({
        id:
          entry.id ||
          `log_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
        projectId: trimmedId,
        userId: session.user.id,
        runtimeSessionId: entry.runtimeSessionId,
        operationId: entry.operationId || null,
        level: entry.level,
        source: entry.source,
        eventType: entry.eventType,
        message: redactSensitiveText(entry.message),
        details: sanitizeStructuredDetails(entry.details),
        occurredAt: entry.occurredAt ? new Date(entry.occurredAt) : new Date(),
        receivedAt: new Date(),
        sequenceNumber: entry.sequenceNumber ?? idx,
        processExitCode: entry.processExitCode ?? null,
        metadata: sanitizeStructuredDetails(entry.metadata),
      }));

      await db.insert(runtimeLog).values(rows);

      return NextResponse.json({
        success: true,
        persistedCount: rows.length,
      });
    } catch (err) {
      console.error("[Foundry API Logs POST] Error persisting logs:", err);
      return NextResponse.json(
        { error: "Database error persisting diagnostic logs." },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    success: true,
    persistedCount: parsed.data.logs.length,
  });
}

/**
 * GET /api/projects/[id]/logs
 * Retrieves paginated runtime diagnostic logs with filtering.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized: Authentication required." },
      { status: 401 },
    );
  }

  const { id: projectId } = await context.params;
  const trimmedId = projectId?.trim();

  if (!trimmedId) {
    return NextResponse.json({ error: "Invalid project ID." }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const level = searchParams.get("level") as
    "debug" | "info" | "warn" | "error" | null;
  const source = searchParams.get("source") as
    "webcontainer" | "installer" | "dev-server" | "client" | "backend" | null;
  const sessionId = searchParams.get("sessionId");
  const cursor = searchParams.get("cursor");
  const limitParam = parseInt(searchParams.get("limit") || "50", 10);
  const limit = Math.min(Math.max(isNaN(limitParam) ? 50 : limitParam, 1), 100);

  if (process.env.DATABASE_URL) {
    try {
      // 1. Verify Project Ownership
      const [proj] = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(eq(project.id, trimmedId), eq(project.ownerId, session.user.id)),
        )
        .limit(1);

      if (!proj) {
        return NextResponse.json(
          { error: "Project not found or permission denied." },
          { status: 403 },
        );
      }

      // 2. Build filters
      const conditions = [eq(runtimeLog.projectId, trimmedId)];
      if (level) {
        conditions.push(eq(runtimeLog.level, level));
      }
      if (source) {
        conditions.push(eq(runtimeLog.source, source));
      }
      if (sessionId) {
        conditions.push(eq(runtimeLog.runtimeSessionId, sessionId));
      }
      if (cursor) {
        const cursorDate = new Date(cursor);
        if (!isNaN(cursorDate.getTime())) {
          conditions.push(lt(runtimeLog.occurredAt, cursorDate));
        }
      }

      // 3. Query
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

      return NextResponse.json({
        success: true,
        logs: logsToReturn,
        nextCursor,
      });
    } catch (err) {
      console.error("[Foundry API Logs GET] Error querying logs:", err);
      return NextResponse.json(
        { error: "Database error querying diagnostic logs." },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    success: true,
    logs: [],
    nextCursor: null,
  });
}
