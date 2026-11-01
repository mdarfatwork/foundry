"use server";

import { eq, desc, and } from "drizzle-orm";
import { requireUser, type AuthUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { project, type Project } from "@/lib/db/schema";

/**
 * Server Actions for Foundry Projects.
 * Powered by Drizzle ORM with strict authorization and tenant isolation.
 * Adheres to AGENTS.md §7.1, §9, and Prompt §8.
 */

export type ProjectRecord = Project;

export type ActionResponse<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string; readonly code: string };

/**
 * Creates a new project owned exclusively by the authenticated user.
 */
export async function createProjectAction(
  name: string,
  description?: string,
): Promise<ActionResponse<ProjectRecord>> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to create a project.",
    };
  }

  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 100) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "Project name must be between 1 and 100 characters.",
    };
  }

  const projectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  if (process.env.DATABASE_URL) {
    try {
      const [inserted] = await db
        .insert(project)
        .values({
          id: projectId,
          name: trimmedName,
          description: description?.trim() || null,
          ownerId: user.id,
        })
        .returning();

      return {
        success: true,
        data: inserted,
      };
    } catch (err) {
      console.error("[Foundry Actions] Database error creating project:", err);
      return {
        success: false,
        code: "DATABASE_ERROR",
        error: "Failed to persist project in database.",
      };
    }
  }

  return {
    success: true,
    data: {
      id: projectId,
      name: trimmedName,
      description: description?.trim() || null,
      prompt: null,
      ownerId: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

/**
 * Retrieves all projects owned by the currently authenticated user.
 * Enforces tenant isolation: Never returns another user's projects.
 */
export async function getUserProjectsAction(): Promise<
  ActionResponse<readonly ProjectRecord[]>
> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to view your projects.",
    };
  }

  if (process.env.DATABASE_URL) {
    try {
      const rows = await db
        .select()
        .from(project)
        .where(eq(project.ownerId, user.id))
        .orderBy(desc(project.createdAt));

      return {
        success: true,
        data: rows,
      };
    } catch (err) {
      console.error("[Foundry Actions] Database error querying projects:", err);
      return {
        success: false,
        code: "DATABASE_ERROR",
        error: "Unable to retrieve projects from database.",
      };
    }
  }

  return {
    success: true,
    data: [],
  };
}

/**
 * Retrieves a single project by ID, strictly enforcing user ownership.
 * Returns NOT_FOUND if the project does not exist or belongs to another user.
 */
export async function getProjectByIdAction(
  projectId: string,
): Promise<ActionResponse<ProjectRecord>> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to view this project.",
    };
  }

  const trimmedId = projectId?.trim();
  if (!trimmedId) {
    return {
      success: false,
      code: "INVALID_INPUT",
      error: "Valid project ID is required.",
    };
  }

  if (process.env.DATABASE_URL) {
    try {
      const [record] = await db
        .select()
        .from(project)
        .where(and(eq(project.id, trimmedId), eq(project.ownerId, user.id)))
        .limit(1);

      if (!record) {
        return {
          success: false,
          code: "NOT_FOUND",
          error: "Project not found or you lack permission to view it.",
        };
      }

      return {
        success: true,
        data: record,
      };
    } catch (err) {
      console.error("[Foundry Actions] Database error querying project:", err);
      return {
        success: false,
        code: "DATABASE_ERROR",
        error: "Unable to retrieve project from database.",
      };
    }
  }

  return {
    success: false,
    code: "NOT_FOUND",
    error: "Project not found or database unconfigured.",
  };
}

/**
 * Direct server-side data access helper for Server Components.
 * Strictly verifies that the requested project belongs to the given user ID.
 */
export async function getProjectByIdForUser(
  projectId: string,
  userId: string,
): Promise<ProjectRecord | null> {
  const trimmedId = projectId?.trim();
  const trimmedUserId = userId?.trim();
  if (!trimmedId || !trimmedUserId) {
    return null;
  }

  if (process.env.DATABASE_URL) {
    try {
      const [record] = await db
        .select()
        .from(project)
        .where(
          and(eq(project.id, trimmedId), eq(project.ownerId, trimmedUserId)),
        )
        .limit(1);

      return record ?? null;
    } catch (err) {
      console.error(
        "[Foundry Actions] Database error querying project for user:",
        err,
      );
      return null;
    }
  }

  return null;
}

/**
 * Deletes a project with strict ownership verification.
 * Prevents unauthorized users from deleting resources they do not own.
 */
export async function deleteProjectAction(
  projectId: string,
): Promise<ActionResponse<{ readonly deletedId: string }>> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to delete a project.",
    };
  }

  if (process.env.DATABASE_URL) {
    try {
      const deleted = await db
        .delete(project)
        .where(and(eq(project.id, projectId), eq(project.ownerId, user.id)))
        .returning({ id: project.id });

      if (deleted.length === 0) {
        return {
          success: false,
          code: "FORBIDDEN",
          error: "Project not found or you lack permission to delete it.",
        };
      }
    } catch (err) {
      console.error("[Foundry Actions] Database error deleting project:", err);
      return {
        success: false,
        code: "DATABASE_ERROR",
        error: "Failed to delete project.",
      };
    }
  }

  return {
    success: true,
    data: { deletedId: projectId },
  };
}
