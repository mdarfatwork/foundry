"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GoogleIcon } from "@/components/icons/google-icon";
import { authClient } from "@/lib/auth/auth-client";
import { getSafeRedirectUrl } from "@/lib/auth/redirect";
import { cn } from "@/lib/utils";

type GoogleSignInButtonProps = Readonly<{
  callbackUrl?: string;
  className?: string;
  onError?: (errorMessage: string) => void;
}>;

/**
 * Google Sign-In Button powered by Better Auth.
 * Adheres to AGENTS.md §5.1, §5.3, §5.4, DESIGN.md, and WCAG AA accessibility.
 */
export function GoogleSignInButton({
  callbackUrl = "/workspace",
  className,
  onError,
}: GoogleSignInButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSignIn = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      const validatedCallback = getSafeRedirectUrl(callbackUrl);
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: validatedCallback,
      });

      if (result?.error) {
        const message =
          result.error.message ||
          "Unable to initiate Google sign-in. Please try again.";
        onError?.(message);
        setIsSubmitting(false);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred during Google sign-in.";
      onError?.(message);
      setIsSubmitting(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleSignIn}
      disabled={isSubmitting}
      aria-busy={isSubmitting}
      className={cn(
        "relative flex h-10 w-full items-center justify-center gap-3 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-all duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer shadow-xs",
        className,
      )}
    >
      {isSubmitting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span>Connecting to Google...</span>
        </>
      ) : (
        <>
          <GoogleIcon className="h-4 w-4 shrink-0" />
          <span>Continue with Google</span>
        </>
      )}
    </Button>
  );
}
