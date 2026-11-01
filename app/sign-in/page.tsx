import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignInCard } from "@/components/auth/sign-in-card";
import { getSafeRedirectUrl } from "@/lib/auth/redirect";

export const metadata: Metadata = {
  title: "Sign in — Foundry",
  description: "Sign in to your Foundry AI website builder workspace.",
};

type SignInPageProps = Readonly<{
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
  }>;
}>;

function resolveOAuthErrorMessage(errorCode?: string): string | undefined {
  if (!errorCode) return undefined;

  switch (errorCode) {
    case "access_denied":
      return "Google sign-in was cancelled or access was denied.";
    case "configuration":
    case "OAuthCallbackError":
      return "Authentication failed. Please verify your Google credentials or try again.";
    default:
      return "Authentication could not be completed. Please try again.";
  }
}

async function SignInContent({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
  }>;
}>) {
  const params = await searchParams;
  const safeCallbackUrl = getSafeRedirectUrl(params.callbackUrl, "/workspace");
  const initialError = resolveOAuthErrorMessage(params.error);

  return (
    <SignInCard callbackUrl={safeCallbackUrl} initialError={initialError} />
  );
}

export default function SignInPage({ searchParams }: SignInPageProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Top Header with Brand & Theme Toggle */}
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to Foundry
          </Link>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Centered Sign-In Content */}
      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <Suspense
          fallback={
            <div className="w-full max-w-sm h-72 rounded-xl border border-border bg-card animate-pulse" />
          }
        >
          <SignInContent searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}
