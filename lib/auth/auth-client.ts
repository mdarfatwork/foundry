"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Foundry Typed Better Auth Client.
 * Safe for use in Client Components. Does not expose database connection or secrets.
 * Adheres to AGENTS.md §5.1, §5.5, and §7.3.
 */

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL ||
        process.env.BETTER_AUTH_URL ||
        "http://localhost:3000",
});

export const { signIn, signOut, useSession } = authClient;
