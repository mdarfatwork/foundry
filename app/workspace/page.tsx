import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Flame, CheckCircle2, ShieldCheck, Database, Key } from "lucide-react";
import { requireUserOrRedirect } from "@/lib/auth/session";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/auth/user-menu";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Workspace — Foundry",
  description: "Foundry AI developer workspace and projects.",
};

async function WorkspaceContent() {
  const user = await requireUserOrRedirect("/workspace");

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-foreground selection:text-background">
      {/* Top Application Header */}
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
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

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      {/* Main Workspace Surface */}
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-10 sm:py-12">
        <div className="space-y-8">
          {/* Welcome Headline */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                Welcome back, {user.name}
              </h1>
              <Badge variant="outline" className="text-[10px] font-mono">
                Pro
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Your authenticated session is active. All builder actions and
              projects are tied to your identity.
            </p>
          </div>

          {/* Account & Security Summary Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Identity Card */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-foreground" />
                <span>Authentication Provider</span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    Google OAuth V1
                  </span>
                  <CheckCircle2 className="h-3.5 w-3.5 text-foreground" />
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {user.email}
                </p>
              </div>
            </div>

            {/* Persistence Card */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Database className="h-4 w-4 text-foreground" />
                <span>Database Engine</span>
              </div>
              <div className="space-y-1">
                <span className="text-sm font-semibold text-foreground">
                  Supabase PostgreSQL
                </span>
                <p className="text-xs text-muted-foreground font-mono">
                  Schema: public (RLS Active)
                </p>
              </div>
            </div>

            {/* Session Security Card */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Key className="h-4 w-4 text-foreground" />
                <span>Canonical User ID</span>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-mono text-foreground break-all bg-muted/50 p-1.5 rounded-md">
                  {user.id}
                </p>
              </div>
            </div>
          </div>

          {/* Workspace Quick Actions */}
          <div className="rounded-xl border border-border bg-card/60 p-6 sm:p-8 shadow-xs space-y-4">
            <h2 className="text-base font-semibold text-foreground">
              Ready to create
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-xl leading-relaxed">
              Start a new website or application from the home prompt composer,
              or review your existing projects.
            </p>
            <div className="pt-2 flex flex-wrap gap-3">
              <Link
                href="/"
                className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
              >
                Go to Prompt Composer
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col bg-background text-foreground animate-pulse p-8">
          <div className="mx-auto w-full max-w-5xl space-y-6">
            <div className="h-8 w-48 rounded bg-muted" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="h-32 rounded-xl bg-muted" />
              <div className="h-32 rounded-xl bg-muted" />
              <div className="h-32 rounded-xl bg-muted" />
            </div>
          </div>
        </div>
      }
    >
      <WorkspaceContent />
    </Suspense>
  );
}
