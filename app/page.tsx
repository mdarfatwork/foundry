"use client";

import {
  useState,
  useRef,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { Flame, ArrowUp, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const DEFAULT_SIGN_IN_ROUTE = "/sign-in";
const MOCK_SUBMISSION_DELAY_MS = 800;
const TEXTAREA_MIN_HEIGHT_PX = 96;
const TEXTAREA_MAX_HEIGHT_PX = 260;

type FoundryLandingPageProps = Readonly<{
  /**
   * Route destination for the Sign In button.
   * Defaults to isolated AUTH_SIGN_IN_ROUTE constant.
   */
  signInHref?: string;
  /**
   * Optional custom submission handler for when a user submits a prompt.
   */
  onSubmitPrompt?: (prompt: string) => void | Promise<void>;
}>;

export default function FoundryLandingPage({
  signInHref = DEFAULT_SIGN_IN_ROUTE,
  onSubmitPrompt,
}: FoundryLandingPageProps) {
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (onSubmitPrompt) {
        await onSubmitPrompt(trimmed);
      } else {
        // Subtle generation transition ready for authentication / workspace handoff
        await new Promise((resolve) =>
          setTimeout(resolve, MOCK_SUBMISSION_DELAY_MS),
        );
        setPrompt("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    const target = e.target;
    target.style.height = "auto";
    target.style.height = `${Math.min(
      Math.max(target.scrollHeight, TEXTAREA_MIN_HEIGHT_PX),
      TEXTAREA_MAX_HEIGHT_PX,
    )}px`;
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-foreground selection:text-background">
      {/* Minimal Top Navigation */}
      <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          {/* Brand Logo & Wordmark */}
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

          {/* Right Action: Theme Switcher & Minimal Sign In */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            <ThemeToggle />
            <Link
              href={signInHref}
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "text-xs font-medium text-muted-foreground hover:text-foreground h-8 px-3",
              )}
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* Main Centered Hero Section & Prompt Composer */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 sm:px-6 py-16 sm:py-24 md:py-28">
        <div className="w-full max-w-2xl sm:max-w-3xl flex flex-col items-center text-center">
          {/* Confident Headline & Concise Supporting Text */}
          <div className="space-y-3 sm:space-y-4 mb-8 sm:mb-10">
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight text-foreground text-balance">
              Build anything with AI.
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground text-balance max-w-xl mx-auto leading-relaxed">
              Describe the website or application you want to build, and Foundry
              turns your idea into a working product.
            </p>
          </div>

          {/* Main Prompt Composer */}
          <form
            onSubmit={handleSubmit}
            className="w-full rounded-xl border border-border bg-card/60 dark:bg-card/40 backdrop-blur-xs shadow-xs transition-all duration-150 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 hover:border-border/80"
          >
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                placeholder="Describe the website you want to build..."
                rows={3}
                disabled={isSubmitting}
                className="w-full resize-none border-0 bg-transparent px-4 pt-4 pb-2 sm:px-5 sm:pt-5 sm:pb-3 text-sm sm:text-base text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-0 leading-relaxed min-h-[96px] sm:min-h-[120px] disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Prompt to build website"
              />

              {/* Bottom Action Bar */}
              <div className="flex items-center justify-between border-t border-border/40 px-3 py-2.5 sm:px-4 sm:py-3 bg-muted/20 rounded-b-xl">
                <span className="text-[11px] font-mono text-muted-foreground/70 hidden sm:inline-flex items-center gap-1.5 select-none">
                  <kbd className="rounded border border-border/80 bg-background/80 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                    Enter
                  </kbd>
                  to send
                  <span className="text-muted-foreground/40">•</span>
                  <kbd className="rounded border border-border/80 bg-background/80 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                    Shift + Enter
                  </kbd>
                  for newline
                </span>

                <div className="flex items-center gap-2 ml-auto">
                  <Button
                    type="submit"
                    size="icon-sm"
                    disabled={!prompt.trim() || isSubmitting}
                    aria-label="Send prompt"
                    className="h-8 w-8 rounded-lg transition-transform active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </form>

          {/* Optional Subtle Supporting Text */}
          <p className="mt-3.5 text-xs text-muted-foreground select-none">
            Start with an idea. Refine it as you go.
          </p>
        </div>
      </main>
    </div>
  );
}
