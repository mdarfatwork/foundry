"use server";

import { eq, desc, and } from "drizzle-orm";
import { requireUser, type AuthUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  project,
  projectFile,
  conversation,
  message,
  projectVersion,
  type Project,
  type ProjectFile,
  type Message,
  type ProjectVersion,
} from "@/lib/db/schema";
import {
  getStarterTemplateFiles,
  STARTER_TEMPLATE_ID,
} from "@/lib/templates/starter-nextjs";

/**
 * Server Actions for Foundry Projects.
 * Powered by Drizzle ORM with strict authorization and tenant isolation.
 * Adheres to AGENTS.md §7.1, §9, and Prompt §3, §4.
 */

export type ProjectRecord = Project;
export type ProjectFileRecord = ProjectFile;
export type ProjectMessageRecord = Message;
export type ProjectVersionRecord = ProjectVersion;

export type ActionResponse<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string; readonly code: string };

/**
 * Creates a new project owned exclusively by the authenticated user.
 * Atomically initializes the project record, persistent starter files,
 * an initial version snapshot, and a scoped conversation with a welcome message.
 */
export async function createProjectAction(
  name: string,
  description?: string,
  initialPrompt?: string,
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
  const starterFiles = getStarterTemplateFiles(trimmedName);

  if (process.env.DATABASE_URL) {
    try {
      // Execute atomically in a database transaction
      const insertedProject = await db.transaction(async (tx) => {
        // 1. Insert Project Record
        const [proj] = await tx
          .insert(project)
          .values({
            id: projectId,
            name: trimmedName,
            description: description?.trim() || null,
            prompt: initialPrompt?.trim() || null,
            generationStatus: "idle",
            template: STARTER_TEMPLATE_ID,
            ownerId: user.id,
          })
          .returning();

        // 2. Insert Persistent Starter Files
        const fileValues = starterFiles.map((file, idx) => ({
          id: `file_${projectId}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
          projectId,
          path: file.path,
          content: file.content,
        }));

        await tx.insert(projectFile).values(fileValues);

        // 3. Create Initial Version Snapshot (v1)
        const snapshotMap: Record<string, string> = {};
        for (const f of starterFiles) {
          snapshotMap[f.path] = f.content;
        }

        await tx.insert(projectVersion).values({
          id: `ver_${projectId}_v1`,
          projectId,
          versionNumber: "v1",
          prompt: "Initial Next.js + shadcn/ui template",
          snapshot: JSON.stringify(snapshotMap),
        });

        // 4. Create Scoped Project Conversation
        const convId = `conv_${projectId}_main`;
        await tx.insert(conversation).values({
          id: convId,
          projectId,
          title: "Main Conversation",
        });

        // 5. Create Initial Assistant Welcome Message
        await tx.insert(message).values({
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          projectId,
          conversationId: convId,
          role: "assistant",
          content:
            "Welcome to your Foundry workspace! I've set up your Next.js application with Tailwind CSS and Base UI components. Describe what you'd like to build, or request specific layouts, components, and visual themes.",
          details: JSON.stringify([
            "Initialized Next.js 16 App Router foundation",
            "Configured Tailwind CSS v4 semantic tokens",
            "Added Base UI button, card, and badge components",
            "Ready to generate custom pages and components",
          ]),
        });

        return proj;
      });

      return {
        success: true,
        data: insertedProject,
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

  // Fallback in environments without configured database (e.g. mock unit tests)
  return {
    success: true,
    data: {
      id: projectId,
      name: trimmedName,
      description: description?.trim() || null,
      prompt: initialPrompt?.trim() || null,
      generationStatus: "idle",
      template: STARTER_TEMPLATE_ID,
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
 * Retrieves all persistent source files for a given project, strictly verifying ownership.
 */
export async function getProjectFilesAction(
  projectId: string,
): Promise<ActionResponse<readonly ProjectFileRecord[]>> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to view project files.",
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
      // 1. Verify Project Ownership
      const proj = await getProjectByIdForUser(trimmedId, user.id);
      if (!proj) {
        return {
          success: false,
          code: "NOT_FOUND",
          error: "Project not found or you lack permission to view its files.",
        };
      }

      // 2. Fetch Files
      const files = await db
        .select()
        .from(projectFile)
        .where(eq(projectFile.projectId, trimmedId))
        .orderBy(projectFile.path);

      // 3. Self-healing path & configuration normalization
      const normalizedFiles: ProjectFileRecord[] = [];
      for (const f of files) {
        let normalizedPath = f.path.replace(/\\/g, "/").trim();
        while (normalizedPath.startsWith("/"))
          normalizedPath = normalizedPath.slice(1);
        if (normalizedPath.startsWith("config/lib/")) {
          normalizedPath = normalizedPath.replace(/^config\/lib\//, "lib/");
        } else if (normalizedPath.startsWith("config/")) {
          normalizedPath = normalizedPath.replace(/^config\//, "");
        }

        let normalizedContent = f.content;
        if (normalizedPath === "package.json") {
          try {
            const parsed = JSON.parse(f.content);
            let pkgModified = false;
            if (!parsed.devDependencies) parsed.devDependencies = {};
            if (
              !parsed.devDependencies["@tailwindcss/postcss"] &&
              !parsed.dependencies?.["@tailwindcss/postcss"]
            ) {
              parsed.devDependencies["@tailwindcss/postcss"] = "^4";
              pkgModified = true;
            }
            if (
              !parsed.devDependencies["postcss"] &&
              !parsed.dependencies?.["postcss"]
            ) {
              parsed.devDependencies["postcss"] = "^8";
              pkgModified = true;
            }
            if (
              parsed.dependencies?.["next"] &&
              (parsed.dependencies["next"].startsWith("16.") ||
                parsed.dependencies["next"].startsWith("^16") ||
                parsed.dependencies["next"] === "16.4.3")
            ) {
              parsed.dependencies["next"] = "15.3.9";
              pkgModified = true;
            }
            if (pkgModified) {
              normalizedContent = JSON.stringify(parsed, null, 2);
            }
          } catch {
            // Ignore malformed JSON
          }
        }

        if (normalizedPath !== f.path || normalizedContent !== f.content) {
          await db
            .update(projectFile)
            .set({
              path: normalizedPath,
              content: normalizedContent,
              updatedAt: new Date(),
            })
            .where(eq(projectFile.id, f.id));
          normalizedFiles.push({
            ...f,
            path: normalizedPath,
            content: normalizedContent,
          });
        } else {
          normalizedFiles.push(f);
        }
      }

      return {
        success: true,
        data: normalizedFiles,
      };
    } catch (err) {
      console.error("[Foundry Actions] Database error querying files:", err);
      return {
        success: false,
        code: "DATABASE_ERROR",
        error: "Unable to retrieve project files from database.",
      };
    }
  }

  // Fallback: return starter files in memory
  const starter = getStarterTemplateFiles("Demo App").map((f, idx) => ({
    id: `file_${trimmedId}_${idx}`,
    projectId: trimmedId,
    path: f.path,
    content: f.content,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  return {
    success: true,
    data: starter,
  };
}

/**
 * Retrieves persistent chat messages for a given project, strictly verifying ownership.
 */
export async function getProjectMessagesAction(
  projectId: string,
): Promise<ActionResponse<readonly ProjectMessageRecord[]>> {
  let user: AuthUser;
  try {
    user = await requireUser();
  } catch {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "You must be signed in to view project messages.",
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
      // 1. Verify Project Ownership
      const proj = await getProjectByIdForUser(trimmedId, user.id);
      if (!proj) {
        return {
          success: false,
          code: "NOT_FOUND",
          error: "Project not found or you lack permission to view messages.",
        };
      }

      // 2. Fetch Messages ordered chronologically
      const messages = await db
        .select()
        .from(message)
        .where(eq(message.projectId, trimmedId))
        .orderBy(message.createdAt);

      return {
        success: true,
        data: messages,
      };
    } catch (err) {
      console.error("[Foundry Actions] Database error querying messages:", err);
      return {
        success: false,
        code: "DATABASE_ERROR",
        error: "Unable to retrieve project messages.",
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
 * Cascades to files, conversations, messages, jobs, and versions via foreign keys.
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
