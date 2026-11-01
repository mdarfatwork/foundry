"use client";

import { useState } from "react";
import Link from "next/link";
import { Flame, AlertCircle } from "lucide-react";
import { GoogleSignInButton } from "./google-sign-in-button";
import { cn } from "@/lib/utils";

type SignInCardProps = Readonly<{
  callbackUrl?: string;
  initialError?: string;
  className?: string;
}>;

/**
 * Centered Authentication Card for Google OAuth V1.
 * Adheres to AGENTS.md §5.3, §5.4, and DESIGN.md tokens and layout rules.
 */
export function SignInCard({
  callbackUrl,
  initialError,
  className,
}: SignInCardProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialError ?? null,
  );

  return (
    <div
      className={cn(
        "w-full max-w-sm rounded-xl border border-border bg-card p-6 sm:p-8 shadow-xs selection:bg-foreground selection:text-background",
        className,
      )}
    >
      {/* Brand Header */}
      <div className="flex flex-col items-center text-center space-y-3 mb-6">
        <Link
          href="/"
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-background shadow-xs transition-transform hover:scale-105"
          aria-label="Foundry Home"
        >
          <Flame className="h-5 w-5 fill-current" />
        </Link>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Sign in to Foundry
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Continue to your AI workspace and generated applications.
          </p>
        </div>
      </div>

      {/* Accessible Error Banner */}
      {errorMessage ? (
        <div
          role="alert"
          aria-live="polite"
          className="mb-5 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1 leading-relaxed">{errorMessage}</div>
        </div>
      ) : null}

      {/* Primary OAuth Action */}
      <div className="space-y-4">
        <GoogleSignInButton
          callbackUrl={callbackUrl}
          onError={(msg) => setErrorMessage(msg)}
        />

        {/* Security & Scope Transparency Notice */}
        <p className="text-center text-[11px] text-muted-foreground leading-normal px-2">
          By signing in, you agree to Foundry&apos;s terms of service and
          developer privacy policy. We only request basic profile identity.
        </p>
      </div>
    </div>
  );
}
