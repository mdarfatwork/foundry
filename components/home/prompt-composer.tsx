"use client";

import {
  useState,
  useRef,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const MOCK_SUBMISSION_DELAY_MS = 800;
const TEXTAREA_MIN_HEIGHT_PX = 96;
const TEXTAREA_MAX_HEIGHT_PX = 260;

type PromptComposerProps = Readonly<{
  /**
   * Optional custom submission handler for when a user submits a prompt.
   */
  onSubmitPrompt?: (prompt: string) => void | Promise<void>;
}>;

/**
 * Interactive Prompt Composer component for Foundry home page.
 * Isolated as a leaf Client Component to preserve Server Component streaming at page level.
 * Adheres to AGENTS.md §5.1, §5.3, §5.4, and §5.5.
 */
export function PromptComposer({ onSubmitPrompt }: PromptComposerProps) {
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
  );
}
