"use client";

import { useState } from "react";
import {
  Monitor,
  Tablet,
  Smartphone,
  RotateCw,
  ExternalLink,
  Lock,
  Eye,
  Code2,
  Sparkles,
  ArrowRight,
  Layers,
  LayoutGrid,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ViewportMode = "desktop" | "tablet" | "mobile";
type ViewMode = "preview" | "code";

type WorkspaceCanvasProps = Readonly<{
  slug?: string;
  viewportMode: ViewportMode;
  onViewportModeChange: (mode: ViewportMode) => void;
  className?: string;
}>;

const STARTER_TEMPLATES = [
  {
    title: "SaaS Landing Page",
    description:
      "Hero with CTA, feature architecture, testimonials, and 3-tier pricing matrix.",
    badge: "Full-Stack",
    icon: LayoutGrid,
  },
  {
    title: "Interactive Analytics Dashboard",
    description:
      "Real-time metrics, line charts, data tables, and collapsible sidebar navigation.",
    badge: "Data",
    icon: Layers,
  },
  {
    title: "Design System Showcase",
    description:
      "Accessible Base UI primitives, responsive dialogs, tokens, and theme controls.",
    badge: "UI Kit",
    icon: Sparkles,
  },
] as const;

/**
 * Main Workspace Canvas Surface.
 * Houses preview toolbar, dynamic viewport controls, and browser-frame preview area.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.3, §5.4 and DESIGN.md.
 */
export function WorkspaceCanvas({
  slug = "new",
  viewportMode,
  onViewportModeChange,
  className,
}: WorkspaceCanvasProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  return (
    <section
      className={cn(
        "flex-1 min-w-0 flex flex-col h-full bg-muted/15 select-none overflow-hidden",
        className,
      )}
      aria-label="Application preview canvas"
    >
      {/* 1. Canvas Toolbar */}
      <div className="h-10 px-3 sm:px-4 border-b border-border bg-background/80 backdrop-blur-xs flex items-center justify-between shrink-0 z-10">
        {/* Left: View mode switcher & browser address bar */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center rounded-md bg-muted p-0.5 text-xs border border-border/40 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-all cursor-pointer font-medium",
                viewMode === "preview"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={viewMode === "preview"}
            >
              <Eye className="h-3 w-3" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("code")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-all cursor-pointer font-medium",
                viewMode === "code"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={viewMode === "code"}
            >
              <Code2 className="h-3 w-3" />
              <span className="hidden sm:inline">Code</span>
            </button>
          </div>

          <div
            className="h-3.5 w-px bg-border/60 shrink-0 hidden sm:block"
            aria-hidden="true"
          />

          {/* Address Bar Pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 border border-border/50 text-[11px] text-muted-foreground font-mono truncate">
            <Lock className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
            <span className="text-foreground">preview.foundry.dev</span>
            <span className="text-muted-foreground/60 truncate">/{slug}</span>
          </div>
        </div>

        {/* Right: Device Viewport Controls & Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center rounded-md bg-muted p-0.5 text-xs border border-border/40">
            <button
              type="button"
              onClick={() => onViewportModeChange("desktop")}
              className={cn(
                "p-1 rounded transition-all cursor-pointer",
                viewportMode === "desktop"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Desktop viewport (100%)"
              aria-label="Desktop viewport"
              aria-pressed={viewportMode === "desktop"}
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onViewportModeChange("tablet")}
              className={cn(
                "p-1 rounded transition-all cursor-pointer",
                viewportMode === "tablet"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Tablet viewport (768px)"
              aria-label="Tablet viewport"
              aria-pressed={viewportMode === "tablet"}
            >
              <Tablet className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onViewportModeChange("mobile")}
              className={cn(
                "p-1 rounded transition-all cursor-pointer",
                viewportMode === "mobile"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Mobile viewport (375px)"
              aria-label="Mobile viewport"
              aria-pressed={viewportMode === "mobile"}
            >
              <Smartphone className="h-3.5 w-3.5" />
            </button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={handleRefresh}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
            title="Refresh preview (placeholder)"
            aria-label="Refresh preview"
          >
            <RotateCw
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                isRefreshing && "animate-spin",
              )}
            />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground cursor-pointer hidden sm:inline-flex"
            title="Open in new window (placeholder)"
            aria-label="Open in new window"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* 2. Scrollable Canvas Body */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5 min-h-0 flex items-center justify-center">
        {/* Dynamic Responsive Browser Frame Container */}
        <div
          className={cn(
            "h-full min-h-[460px] flex flex-col rounded-xl border border-border bg-card shadow-2xs overflow-hidden transition-all duration-300",
            viewportMode === "desktop" && "w-full",
            viewportMode === "tablet" && "w-[768px]",
            viewportMode === "mobile" && "w-[375px]",
          )}
        >
          {/* Browser Chrome Header */}
          <div className="h-8 px-3 border-b border-border/60 bg-muted/30 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-border" />
              <span className="h-2 w-2 rounded-full bg-border" />
              <span className="h-2 w-2 rounded-full bg-border" />
            </div>

            <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
              <span>localhost:3000</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"
                aria-hidden="true"
              />
              <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
                Ready
              </span>
            </div>
          </div>

          {/* Browser Frame Inner Content: Intentional Empty State Preview */}
          <div className="flex-1 overflow-y-auto p-6 sm:p-10 flex flex-col items-center justify-center text-center select-text">
            {/* Visual Icon Illustration */}
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/50 text-foreground mb-4 shadow-2xs">
              <Sparkles className="h-5 w-5" />
            </div>

            {/* Heading & Supporting Text */}
            <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground mb-2">
              Your workspace starts here
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed text-balance mb-8 px-2">
              Your website preview will appear here once generation begins. Use
              the chat on the left to describe components, layouts, or entire
              pages.
            </p>

            {/* Starter Suggestion Blueprint Cards */}
            <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
              {STARTER_TEMPLATES.map((item) => {
                const IconComponent = item.icon;
                return (
                  <div
                    key={item.title}
                    className="group rounded-xl border border-border/80 bg-muted/20 p-3.5 hover:bg-accent/40 hover:border-foreground/20 transition-all cursor-pointer shadow-2xs flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground">
                          <IconComponent className="h-3.5 w-3.5" />
                        </div>
                        <Badge
                          variant="secondary"
                          className="text-[9px] font-mono h-4 px-1.5"
                        >
                          {item.badge}
                        </Badge>
                      </div>

                      <h3 className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                        {item.title}
                      </h3>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {item.description}
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground group-hover:text-foreground">
                      <span>Click to ask</span>
                      <ArrowRight className="h-3 w-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
