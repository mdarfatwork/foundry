import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

/**
 * Better Auth catch-all route handler for Next.js App Router.
 * Handles /api/auth/* including OAuth callbacks and session management.
 */

export const { GET, POST } = toNextJsHandler(auth);
