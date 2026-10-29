"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

const subscribe = () => () => {};

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  if (!mounted) {
    return (
      <div
        className={`h-7 w-7 rounded-md border border-border/50 bg-background/50 inline-flex items-center justify-center text-muted-foreground opacity-50 ${className || ""}`}
      >
        <span className="sr-only">Toggle theme</span>
      </div>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <AnimatedThemeToggler
      theme={isDark ? "dark" : "light"}
      onThemeChange={(nextTheme) => setTheme(nextTheme)}
      variant="circle"
      duration={450}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-label="Toggle theme"
      className={`h-7 w-7 rounded-md border border-border bg-background inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50 cursor-pointer shadow-xs [&_svg]:size-3.5 ${className || ""}`}
    />
  );
}
