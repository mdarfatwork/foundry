"use client";

import {
  useState,
  useRef,
  useEffect,
  type FormEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import {
  Sparkles,
  SquarePen,
  ArrowUp,
  Paperclip,
  Flame,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Check,
  FastForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  generateProjectCodeAction,
  submitClarificationAnswersAction,
} from "@/app/actions/generation";
import type { ProjectMessageRecord } from "@/app/actions/project";
import type {
  FileModification,
  ClarificationPayload,
  ClarificationQuestion,
} from "@/lib/ai/types";
import { cn } from "@/lib/utils";

type LocalMessage = {
  readonly id: string;
  readonly role: "assistant" | "user";
  readonly content: string;
  readonly timestamp?: string;
  readonly details?: readonly string[];
  readonly clarification?: ClarificationPayload;
  readonly isError?: boolean;
};

type WorkspaceChatSidebarProps = Readonly<{
  projectId: string;
  initialMessages?: readonly ProjectMessageRecord[];
  isGenerating?: boolean;
  onGeneratingChange?: (generating: boolean) => void;
  onFilesUpdated?: (updatedFiles: readonly FileModification[]) => void;
  className?: string;
}>;

function formatMessageTimestamp(dateInput?: Date | string | null): string {
  if (!dateInput) return "Just now";
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return "Just now";

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  }).format(date);
}

function parseMessageDetails(
  rawDetails?: string | null,
): readonly string[] | undefined {
  if (!rawDetails) return undefined;
  try {
    const parsed = JSON.parse(rawDetails);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // Ignore JSON parse errors for non-JSON string details
  }
  return undefined;
}

function parseMessageClarification(
  rawDetails?: string | null,
): ClarificationPayload | undefined {
  if (!rawDetails) return undefined;
  try {
    const parsed = JSON.parse(rawDetails);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.type === "clarification"
    ) {
      return parsed as ClarificationPayload;
    }
  } catch {
    // Ignore JSON parse errors
  }
  return undefined;
}

/**
 * Interactive Multiple-Choice Clarification Card inside the conversation.
 */
function ClarificationQuestionCard({
  messageId,
  projectId,
  payload,
  isGenerating,
  onGeneratingChange,
  onFilesUpdated,
  onAnswerSubmitted,
}: Readonly<{
  messageId: string;
  projectId: string;
  payload: ClarificationPayload;
  isGenerating: boolean;
  onGeneratingChange?: (generating: boolean) => void;
  onFilesUpdated?: (updatedFiles: readonly FileModification[]) => void;
  onAnswerSubmitted: (
    messageId: string,
    answers: Record<string, readonly string[]>,
  ) => void;
}>) {
  // Initialize selections with default/first options
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<string, string[]>
  >(() => {
    if (payload.answers) {
      const initial: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(payload.answers)) {
        initial[k] = [...v];
      }
      return initial;
    }

    const defaults: Record<string, string[]> = {};
    for (const q of payload.questions) {
      // Default to first option
      if (q.options.length > 0) {
        defaults[q.id] = [q.options[0].label];
      }
    }
    return defaults;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleOption = (
    question: ClarificationQuestion,
    optionLabel: string,
  ) => {
    if (payload.answered || isGenerating || isSubmitting) return;

    setSelectedAnswers((prev) => {
      const current = prev[question.id] ?? [];
      if (question.isMultiSelect) {
        const next = current.includes(optionLabel)
          ? current.filter((item) => item !== optionLabel)
          : [...current, optionLabel];
        return { ...prev, [question.id]: next };
      } else {
        return { ...prev, [question.id]: [optionLabel] };
      }
    });
  };

  const handleGenerateWithAnswers = async () => {
    if (payload.answered || isGenerating || isSubmitting) return;

    setIsSubmitting(true);
    onGeneratingChange?.(true);

    try {
      const res = await submitClarificationAnswersAction(
        projectId,
        messageId,
        payload.originalPrompt,
        selectedAnswers,
      );

      if (res.success && res.data.type === "generated") {
        onAnswerSubmitted(messageId, selectedAnswers);
        onFilesUpdated?.(res.data.updatedFiles);
      }
    } finally {
      setIsSubmitting(false);
      onGeneratingChange?.(false);
    }
  };

  const handleSkipClarification = async () => {
    if (payload.answered || isGenerating || isSubmitting) return;

    setIsSubmitting(true);
    onGeneratingChange?.(true);

    try {
      const res = await generateProjectCodeAction(
        projectId,
        payload.originalPrompt,
        { skipClarification: true },
      );

      if (res.success && res.data.type === "generated") {
        onAnswerSubmitted(messageId, { skipped: ["Default Foundry Design"] });
        onFilesUpdated?.(res.data.updatedFiles);
      }
    } finally {
      setIsSubmitting(false);
      onGeneratingChange?.(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3.5 space-y-4 my-2 shadow-2xs">
      <div className="flex items-center justify-between pb-1 border-b border-border/40">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="font-semibold text-xs text-foreground">
            {payload.answered ? "Design Choices Applied" : "Design Preferences"}
          </span>
        </div>
        <Badge variant="outline" className="font-mono text-[9px]">
          {payload.questions.length} questions
        </Badge>
      </div>

      {/* Questions List */}
      <div className="space-y-3.5">
        {payload.questions.map((q, idx) => {
          const selected = selectedAnswers[q.id] ?? [];
          return (
            <div key={q.id} className="space-y-1.5 text-left">
              <div className="flex items-center justify-between text-[11px] font-medium text-foreground">
                <span>
                  {idx + 1}. {q.question}
                </span>
                {q.isMultiSelect && !payload.answered && (
                  <span className="text-[10px] text-muted-foreground font-normal">
                    (Select multiple)
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {q.options.map((opt) => {
                  const isChecked = selected.includes(opt.label);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={
                        payload.answered || isGenerating || isSubmitting
                      }
                      onClick={() => toggleOption(q, opt.label)}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] transition-all cursor-pointer border text-left",
                        isChecked
                          ? "bg-foreground text-background border-foreground font-medium shadow-2xs"
                          : "bg-background/80 text-muted-foreground border-border hover:text-foreground hover:bg-muted/60",
                        payload.answered &&
                          !isChecked &&
                          "opacity-40 pointer-events-none",
                      )}
                    >
                      {isChecked && <Check className="h-3 w-3 shrink-0" />}
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Action Buttons (Only when not already answered) */}
      {!payload.answered && (
        <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={handleSkipClarification}
            disabled={isGenerating || isSubmitting}
            className="text-[11px] text-muted-foreground hover:text-foreground gap-1"
          >
            <FastForward className="h-3 w-3" />
            <span>Skip and generate</span>
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleGenerateWithAnswers}
            disabled={isGenerating || isSubmitting}
            className="gap-1.5 text-xs shadow-xs"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                <span>Generate with choices</span>
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Dedicated Chat Sidebar for Foundry Workspace.
 * Connects the docked prompt composer to NVIDIA-powered code generation with adaptive MCQ clarification.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.3, §5.4 and DESIGN.md.
 */
export function WorkspaceChatSidebar({
  projectId,
  initialMessages = [],
  isGenerating = false,
  onGeneratingChange,
  onFilesUpdated,
  className,
}: WorkspaceChatSidebarProps) {
  const [inputValue, setInputValue] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Map incoming persistent messages to local state
  const [messages, setMessages] = useState<readonly LocalMessage[]>(() => {
    if (initialMessages.length > 0) {
      return initialMessages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: formatMessageTimestamp(m.createdAt),
        details: parseMessageDetails(m.details),
        clarification: parseMessageClarification(m.details),
      }));
    }

    return [
      {
        id: "msg-welcome",
        role: "assistant",
        content:
          "Welcome to your Foundry workspace! I've set up your Next.js application with Tailwind CSS and Base UI components. Describe what you want to create, or request specific layouts, components, and visual themes.",
        timestamp: "Just now",
        details: [
          "Initialized Next.js 16 App Router foundation",
          "Configured Tailwind CSS v4 semantic tokens",
          "Added Base UI button, card, and badge components",
          "Ready to generate custom pages and components",
        ],
      },
    ];
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  const handleAnswerSubmitted = (
    messageId: string,
    answers: Record<string, readonly string[]>,
  ) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === messageId && m.clarification) {
          return {
            ...m,
            clarification: {
              ...m.clarification,
              answered: true,
              answers,
            },
          };
        }
        return m;
      }),
    );
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const promptText = inputValue.trim();
    if (!promptText || isGenerating) return;

    setErrorMessage(null);
    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // 1. Optimistically append user message
    const userMessage: LocalMessage = {
      id: `temp_user_${Date.now()}`,
      role: "user",
      content: promptText,
      timestamp: "Just now",
    };
    setMessages((prev) => [...prev, userMessage]);

    // 2. Set generating state
    onGeneratingChange?.(true);

    try {
      // 3. Trigger Generation Server Action
      const response = await generateProjectCodeAction(projectId, promptText);

      if (response.success) {
        if (response.data.type === "clarification") {
          // Assistant posed clarification questions
          const clarificationMessage: LocalMessage = {
            id: response.data.messageId,
            role: "assistant",
            content: "To help tailor the design, here are a few quick choices:",
            timestamp: "Just now",
            clarification: {
              type: "clarification",
              questions: response.data.questions,
              originalPrompt: response.data.originalPrompt,
              answered: false,
            },
          };
          setMessages((prev) => [...prev, clarificationMessage]);
        } else {
          // Assistant directly generated code
          const assistantMessage: LocalMessage = {
            id: `msg_${Date.now()}`,
            role: "assistant",
            content: response.data.summary,
            timestamp: "Just now",
            details: response.data.details,
          };
          setMessages((prev) => [...prev, assistantMessage]);

          // Propagate updated files to workspace canvas
          onFilesUpdated?.(response.data.updatedFiles);
        }
      } else {
        const failureMessage: LocalMessage = {
          id: `msg_err_${Date.now()}`,
          role: "assistant",
          content: `Generation failed: ${response.error}. Your previous project files were preserved.`,
          timestamp: "Just now",
          isError: true,
        };
        setMessages((prev) => [...prev, failureMessage]);
        setErrorMessage(response.error);
      }
    } catch {
      const unexpectedError: LocalMessage = {
        id: `msg_err_${Date.now()}`,
        role: "assistant",
        content:
          "An unexpected network or server error occurred during generation. Your project files have not been changed.",
        timestamp: "Just now",
        isError: true,
      };
      setMessages((prev) => [...prev, unexpectedError]);
      setErrorMessage("Network error during generation.");
    } finally {
      onGeneratingChange?.(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextareaChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const target = e.target;
    target.style.height = "auto";
    target.style.height = `${Math.min(Math.max(target.scrollHeight, 48), 140)}px`;
  };

  return (
    <aside
      className={cn(
        "w-full md:w-[360px] lg:w-[390px] shrink-0 h-full flex flex-col border-r border-border bg-sidebar/20 select-none overflow-hidden",
        className,
      )}
      aria-label="Assistant conversation panel"
    >
      {/* 1. Chat Header */}
      <div className="h-10 px-3.5 border-b border-border bg-background/50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-foreground" />
          <span className="text-xs font-semibold tracking-tight text-foreground">
            Chat
          </span>
          <Badge
            variant="secondary"
            className="font-mono text-[10px] h-4.5 px-1.5 font-normal text-muted-foreground"
          >
            NVIDIA GLM-5
          </Badge>
        </div>

        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground cursor-pointer"
          title="Conversation thread"
          aria-label="Conversation"
        >
          <SquarePen className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 2. Scrollable Conversation Area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto min-h-0 p-3.5 space-y-4 text-xs select-text"
      >
        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="rounded-xl border border-border/60 bg-muted/70 px-3.5 py-2.5 text-foreground shadow-2xs break-words overflow-hidden leading-relaxed max-w-[88%]">
                  <p className="text-xs font-normal whitespace-pre-wrap">
                    {msg.content}
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="space-y-2">
              {/* Assistant Label and Avatar */}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <div
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-md text-background shadow-2xs",
                    msg.isError ? "bg-destructive" : "bg-foreground",
                  )}
                >
                  {msg.isError ? (
                    <AlertCircle className="h-3 w-3 fill-current text-background" />
                  ) : (
                    <Flame className="h-3 w-3 fill-current" />
                  )}
                </div>
                <span className="font-semibold text-foreground">
                  {msg.isError ? "Foundry Error" : "Foundry"}
                </span>
                <span className="text-[10px] opacity-70">
                  {msg.timestamp ?? "Just now"}
                </span>
              </div>

              {/* Assistant Message Body */}
              <div
                className={cn(
                  "pl-7 space-y-2 text-foreground leading-relaxed break-words overflow-hidden",
                  msg.isError && "text-destructive",
                )}
              >
                <p className="text-xs">{msg.content}</p>

                {/* Interactive Clarification Card */}
                {msg.clarification && (
                  <ClarificationQuestionCard
                    messageId={msg.id}
                    projectId={projectId}
                    payload={msg.clarification}
                    isGenerating={isGenerating}
                    onGeneratingChange={onGeneratingChange}
                    onFilesUpdated={onFilesUpdated}
                    onAnswerSubmitted={handleAnswerSubmitted}
                  />
                )}

                {/* Structured Bullets */}
                {msg.details && msg.details.length > 0 ? (
                  <ul className="space-y-1.5 pt-1 text-[11px] text-muted-foreground">
                    {msg.details.map((detail) => (
                      <li key={detail} className="flex items-start gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-foreground shrink-0 mt-0.5" />
                        <span className="text-foreground/90">{detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          );
        })}

        {/* Live Generating Indicator */}
        {isGenerating && (
          <div className="space-y-2 animate-pulse">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <div className="flex h-5 w-5 items-center justify-center rounded-md bg-foreground text-background shadow-2xs">
                <Loader2 className="h-3 w-3 animate-spin" />
              </div>
              <span className="font-semibold text-foreground">Foundry</span>
              <span className="text-[10px] font-mono text-muted-foreground">
                Generating with NVIDIA NIM...
              </span>
            </div>
            <div className="pl-7 text-xs text-muted-foreground">
              Synthesizing components, applying semantic tokens, and validating
              files...
            </div>
          </div>
        )}
      </div>

      {/* 3. Docked Chat Input (Prompt Composer) */}
      <div className="shrink-0 p-3 border-t border-border bg-background">
        {errorMessage && (
          <div
            role="alert"
            className="mb-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-[11px] text-destructive flex items-center justify-between"
          >
            <span className="truncate">{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-destructive font-bold ml-2 hover:opacity-80"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-border bg-card p-2 shadow-2xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 transition-all"
        >
          <label htmlFor="workspace-chat-prompt" className="sr-only">
            Ask Foundry to change something
          </label>
          <textarea
            id="workspace-chat-prompt"
            ref={textareaRef}
            value={inputValue}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            disabled={isGenerating}
            placeholder={
              isGenerating
                ? "Generation in progress..."
                : "Ask Foundry to build a page or component..."
            }
            rows={2}
            className="w-full bg-transparent resize-none outline-none text-xs text-foreground placeholder:text-muted-foreground leading-relaxed min-h-[48px] max-h-[140px] disabled:opacity-50"
          />

          <div className="flex items-center justify-between pt-1 border-t border-border/40 mt-1">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground cursor-pointer"
                title="Attach context"
                aria-label="Add attachment"
                disabled={isGenerating}
              >
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[10px] font-mono text-muted-foreground px-1">
                Enter to submit
              </span>
            </div>

            <Button
              type="submit"
              size="icon-xs"
              disabled={!inputValue.trim() || isGenerating}
              className="size-6 rounded-md bg-foreground text-background hover:opacity-90 disabled:opacity-30 transition-opacity cursor-pointer shadow-2xs"
              aria-label="Send message"
            >
              {isGenerating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowUp className="h-3 w-3" />
              )}
            </Button>
          </div>
        </form>

        <p className="text-[10px] text-muted-foreground/80 text-center mt-2 select-none">
          AI-generated code is validated and saved to your project repository.
        </p>
      </div>
    </aside>
  );
}
