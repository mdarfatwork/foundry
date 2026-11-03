"use client";

import {
  useState,
  useRef,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Message = {
  readonly id: string;
  readonly role: "assistant" | "user";
  readonly content: string;
  readonly timestamp?: string;
  readonly details?: readonly string[];
};

const STATIC_MESSAGES: readonly Message[] = [
  {
    id: "msg-1",
    role: "assistant",
    content:
      "Welcome to your Foundry workspace! I'm here to help you conceptualize, design, and refine production-ready web applications. Describe what you want to create, or request specific layouts, components, and visual themes.",
    timestamp: "Just now",
  },
  {
    id: "msg-2",
    role: "user",
    content:
      "Build a modern SaaS landing page for an AI code review platform. Include a high-converting hero with CTA, key feature highlights, and a clean pricing tier comparison.",
    timestamp: "Just now",
  },
  {
    id: "msg-3",
    role: "assistant",
    content:
      "I've initialized the layout in your workspace canvas preview. Here is the structure created for your review:",
    timestamp: "Just now",
    details: [
      "Hero Section: High-contrast headline, product badge indicator, and primary action button.",
      "Feature Architecture: Interactive 3-card layout highlighting AST diffing, automated security reviews, and PR automations.",
      "Pricing Matrix: Clean starter, pro, and enterprise tiers with responsive flex cards.",
      "Theme Tokens: Calibrated with OKLCH semantic variables supporting seamless light and dark modes.",
    ],
  },
];

type WorkspaceChatSidebarProps = Readonly<{
  className?: string;
}>;

/**
 * Dedicated Chat Sidebar for Foundry Workspace.
 * Left panel featuring chat header, scrollable conversation, and docked v0-inspired composer.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.3, §5.4 and DESIGN.md.
 */
export function WorkspaceChatSidebar({ className }: WorkspaceChatSidebarProps) {
  const [inputValue, setInputValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim()) return;

    // UI-only presentation: Clear input after submission without backend side effects
    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
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
            v0-fast
          </Badge>
        </div>

        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground cursor-pointer"
          title="New conversation (placeholder)"
          aria-label="New chat"
        >
          <SquarePen className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 2. Scrollable Conversation Area */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3.5 space-y-4 text-xs select-text">
        {STATIC_MESSAGES.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="rounded-xl border border-border/60 bg-muted/70 px-3.5 py-2.5 text-foreground shadow-2xs break-words overflow-hidden leading-relaxed">
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
                <div className="flex h-5 w-5 items-center justify-center rounded-md bg-foreground text-background shadow-2xs">
                  <Flame className="h-3 w-3 fill-current" />
                </div>
                <span className="font-semibold text-foreground">Foundry</span>
                <span className="text-[10px] opacity-70">
                  {msg.timestamp ?? "Just now"}
                </span>
              </div>

              {/* Assistant Message Body */}
              <div className="pl-7 space-y-2 text-foreground leading-relaxed break-words overflow-hidden">
                <p className="text-xs">{msg.content}</p>

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
      </div>

      {/* 3. Docked Chat Input (Prompt Composer) */}
      <div className="shrink-0 p-3 border-t border-border bg-background">
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
            placeholder="Ask Foundry to change something..."
            rows={2}
            className="w-full bg-transparent resize-none outline-none text-xs text-foreground placeholder:text-muted-foreground leading-relaxed min-h-[48px] max-h-[140px]"
          />

          <div className="flex items-center justify-between pt-1 border-t border-border/40 mt-1">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground cursor-pointer"
                title="Attach context (placeholder)"
                aria-label="Add attachment"
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
              disabled={!inputValue.trim()}
              className="size-6 rounded-md bg-foreground text-background hover:opacity-90 disabled:opacity-30 transition-opacity cursor-pointer shadow-2xs"
              aria-label="Send message"
            >
              <ArrowUp className="h-3 w-3" />
            </Button>
          </div>
        </form>

        <p className="text-[10px] text-muted-foreground/80 text-center mt-2 select-none">
          AI-generated changes will appear in your workspace.
        </p>
      </div>
    </aside>
  );
}
