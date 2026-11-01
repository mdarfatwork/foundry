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
import { cn } from "@/lib/utils";

const MOCK_SUBMISSION_DELAY_MS = 800;
const TEXTAREA_MIN_HEIGHT_PX = 60;
const TEXTAREA_MAX_HEIGHT_PX = 260;

type PromptComposerProps = Readonly<{
  /**
   * Optional custom submission handler for when a user submits a prompt.
   */
  onSubmitPrompt?: (prompt: string) => void | Promise<void>;
  /**
   * Custom placeholder text for the prompt input.
   * Defaults to "What do you want to build?".
   */
  placeholder?: string;
  /**
   * Optional custom class name applied to the outer container.
   */
  className?: string;
}>;

/**
 * Minimal, polished Prompt Composer inspired by v0.app.
 * Adheres to AGENTS.md §5.1, §5.3, §5.4, §5.5, and DESIGN.md.
 */
export function PromptComposer({
  onSubmitPrompt,
  placeholder = "What do you want to build?",
  className,
}: PromptComposerProps) {
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
      className={cn(
        "w-full rounded-2xl border border-border bg-card p-3 sm:p-4 shadow-xs transition-all duration-200",
        "hover:border-border/80 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
        className,
      )}
    >
      <div className="flex flex-col">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={2}
          disabled={isSubmitting}
          className="w-full resize-none border-0 bg-transparent px-1 pt-1 pb-2 text-sm sm:text-base text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus-visible:ring-0 leading-relaxed min-h-[72px] sm:min-h-[80px] disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={placeholder}
        />

        {/* Minimal Bottom Control Bar */}
        <div className="flex items-center justify-between pt-1">
          <div className="ml-auto flex items-center">
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
