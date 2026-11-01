"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth-client";
import { cn } from "@/lib/utils";

type SignOutButtonProps = Readonly<{
  className?: string;
  redirectTo?: string;
}>;

/**
 * Sign-Out Button powered by Better Auth.
 * Invalidates session cookies and securely redirects to home.
 * Adheres to AGENTS.md §5.1, §5.3, §7.4, and Prompt §13.
 */
export function SignOutButton({
  className,
  redirectTo = "/",
}: SignOutButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  const handleSignOut = async () => {
    if (isPending) return;

    setIsPending(true);
    try {
      await authClient.signOut();
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      console.error("[Foundry Auth] Error during sign-out:", err);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={handleSignOut}
      disabled={isPending}
      className={cn(
        "h-8 gap-2 text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors",
        className,
      )}
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <LogOut className="h-3.5 w-3.5" />
      )}
      <span>Sign out</span>
    </Button>
  );
}
