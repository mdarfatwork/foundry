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
