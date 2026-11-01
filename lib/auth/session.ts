import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, type Session } from "./index";
import { DEFAULT_UNAUTHENTICATED_ROUTE } from "./redirect";

/**
 * Server-side session helpers and Data Access Layer (DAL).
 * Adheres to AGENTS.md §5.5, §7.1, and Prompt §7.
 */

export type AuthUser = Session["user"];

/**
 * Retrieves the active session using the incoming request headers.
 * Safe to call in Server Components, Server Actions, and Route Handlers.
 */
export async function getServerSession(): Promise<Session | null> {
  // Let Next.js handle dynamic headers tracking without interception
  const requestHeaders = await headers();

  try {
    const session = await auth.api.getSession({
      headers: requestHeaders,
    });
    return session;
  } catch (err) {
    // Only log unexpected database or network errors during session verification
    console.error("[Foundry Auth] Error retrieving server session:", err);
    return null;
  }
}

/**
 * Retrieves the currently authenticated user, or null if unauthenticated.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getServerSession();
  return session?.user ?? null;
}

/**
 * Enforces authentication for Server Actions and API mutations.
 * Throws an explicit UNAUTHORIZED error if no valid session is present.
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error(
      "UNAUTHORIZED: Authentication required for this operation.",
    );
  }
  return user;
}

/**
 * Enforces authentication for React Server Component (RSC) pages.
 * Redirects unauthenticated requests to the sign-in page with preserved callback URL.
 */
export async function requireUserOrRedirect(
  callbackUrl = "/workspace",
): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    const searchParams = new URLSearchParams({
      callbackUrl,
    });
    redirect(`${DEFAULT_UNAUTHENTICATED_ROUTE}?${searchParams.toString()}`);
  }
  return user;
}
