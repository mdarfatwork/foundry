import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Flame } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/auth/user-menu";
import { PromptComposer } from "@/components/home/prompt-composer";
import { getCurrentUser } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

const DEFAULT_SIGN_IN_ROUTE = "/sign-in";

export const metadata: Metadata = {
  title: "Foundry — AI Website Builder",
  description:
    "Developer-grade AI website builder with production-quality design system and modern workspace.",
};

type FoundryLandingPageProps = Readonly<{
  /**
   * Route destination for the Sign In button.
   * Defaults to isolated AUTH_SIGN_IN_ROUTE constant.
   */
  signInHref?: string;
}>;

type AuthNavProps = Readonly<{
  signInHref: string;
}>;

/**
 * Server component that dynamically retrieves the current user session.
 * Isolated inside Suspense to allow static prerendering of the landing page shell.
 * Adheres to AGENTS.md §5.5 and Next.js 16 Partial Prerendering requirements.
 */
async function AuthNav({ signInHref }: AuthNavProps) {
  const user = await getCurrentUser();

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/workspace"
          prefetch={false}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "text-xs font-medium text-muted-foreground hover:text-foreground h-8 px-3 hidden sm:inline-flex",
          )}
        >
          Workspace
        </Link>
        <UserMenu user={user} />
      </div>
    );
  }

  return (
    <Link
      href={signInHref}
      prefetch={false}
      className={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "text-xs font-medium text-muted-foreground hover:text-foreground h-8 px-3",
      )}
    >
      Sign in
    </Link>
  );
}

function AuthNavFallback({ signInHref }: AuthNavProps) {
  return (
    <Link
      href={signInHref}
      prefetch={false}
      className={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "text-xs font-medium text-muted-foreground hover:text-foreground h-8 px-3 opacity-80",
      )}
    >
      Sign in
    </Link>
  );
}

/**
 * Foundry Root Landing Page.
 * Implemented as a React Server Component (RSC) with Suspense streaming for dynamic auth state.
 * Adheres to AGENTS.md §5.1, §5.3, §5.4, §5.5, and DESIGN.md.
 */
export default function FoundryLandingPage({
  signInHref = DEFAULT_SIGN_IN_ROUTE,
}: FoundryLandingPageProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-foreground selection:text-background">
      {/* Minimal Top Navigation */}
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          {/* Brand Logo & Wordmark */}
          <Link
            href="/"
            prefetch={false}
            className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
            aria-label="Foundry Home"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background shadow-xs">
              <Flame className="h-4 w-4 fill-current" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Foundry
            </span>
          </Link>

          {/* Right Action: Theme Switcher & Auth State */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            <ThemeToggle />
            <Suspense fallback={<AuthNavFallback signInHref={signInHref} />}>
              <AuthNav signInHref={signInHref} />
            </Suspense>
          </div>
        </div>
      </header>

      {/* Main Centered Hero Section & Prompt Composer */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 sm:px-6 py-16 sm:py-24 md:py-28">
        <div className="w-full max-w-2xl flex flex-col items-center text-center">
          {/* Confident Headline & Concise Supporting Text */}
          <div className="space-y-3 sm:space-y-4 mb-8 sm:mb-10">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-foreground text-balance">
              Build anything with AI.
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground text-balance leading-relaxed">
              Describe the website or application you want to build, and Foundry
              turns your idea into a working product.
            </p>
          </div>

          {/* Main Prompt Composer (Leaf Client Component) */}
          <PromptComposer />

          {/* Optional Subtle Supporting Text */}
          <p className="mt-3.5 text-xs text-muted-foreground select-none">
            Start with an idea. Refine it as you go.
          </p>
        </div>
      </main>
    </div>
  );
}
