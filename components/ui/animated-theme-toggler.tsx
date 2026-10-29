"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { flushSync } from "react-dom";

import { cn } from "@/lib/utils";

export type TransitionVariant =
  | "circle"
  | "square"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "rectangle"
  | "star";

interface AnimatedThemeTogglerProps extends React.ComponentPropsWithoutRef<"button"> {
  duration?: number;
  variant?: TransitionVariant;
  /** When true, the transition expands from the viewport center instead of the button center. */
  fromCenter?: boolean;
  /**
   * Controlled theme value. When provided, the parent owns persistence
   * (e.g. `next-themes`) and this component will not write to localStorage.
   */
  theme?: "light" | "dark";
  /** Called on toggle. Pair with `theme` for controlled usage. */
  onThemeChange?: (theme: "light" | "dark") => void;
}

function polygonCollapsed(point: string, vertexCount: number): string {
  const pairs = Array.from({ length: vertexCount }, () => point).join(", ");
  return `polygon(${pairs})`;
}

function getThemeTransitionClipPaths(
  variant: TransitionVariant,
  cx: number,
  cy: number,
  maxRadius: number,
  viewportWidth: number,
  viewportHeight: number,
): [string, string] {
  const toX = (x: number) => `${(x / viewportWidth) * 100}%`;
  const toY = (y: number) => `${(y / viewportHeight) * 100}%`;
  const point = (x: number, y: number) => `${toX(x)} ${toY(y)}`;
  const toRadius = (r: number) =>
    `${(r / (Math.hypot(viewportWidth, viewportHeight) / Math.SQRT2)) * 100}%`;

  switch (variant) {
    case "circle":
      return [
        `circle(0% at ${point(cx, cy)})`,
        `circle(${toRadius(maxRadius)} at ${point(cx, cy)})`,
      ];
    case "rectangle": {
      const p = point(cx, cy);
      return [
        `polygon(${p}, ${p}, ${p}, ${p})`,
        "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)",
      ];
    }
    case "square": {
      const halfSide = maxRadius;
      return [
        `polygon(${point(cx, cy)}, ${point(cx, cy)}, ${point(cx, cy)}, ${point(cx, cy)})`,
        `polygon(${point(cx - halfSide, cy - halfSide)}, ${point(cx + halfSide, cy - halfSide)}, ${point(cx + halfSide, cy + halfSide)}, ${point(cx - halfSide, cy + halfSide)})`,
      ];
    }
    case "triangle": {
      const R = maxRadius * 1.5;
      const poly = (r: number) => {
        const top = point(cx, cy - r);
        const right = point(cx + r * (Math.sqrt(3) / 2), cy + r / 2);
        const left = point(cx - r * (Math.sqrt(3) / 2), cy + r / 2);
        return `polygon(${top}, ${right}, ${left})`;
      };
      return [polygonCollapsed(point(cx, cy), 3), poly(R)];
    }
    case "diamond": {
      const R = maxRadius * 1.2;
      const poly = (r: number) => {
        const top = point(cx, cy - r);
        const right = point(cx + r, cy);
        const bottom = point(cx, cy + r);
        const left = point(cx - r, cy);
        return `polygon(${top}, ${right}, ${bottom}, ${left})`;
      };
      return [polygonCollapsed(point(cx, cy), 4), poly(R)];
    }
    case "hexagon": {
      const R = maxRadius * 1.15;
      const poly = (r: number) => {
        const verts: string[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          verts.push(point(cx + r * Math.cos(a), cy + r * Math.sin(a)));
        }
        return `polygon(${verts.join(", ")})`;
      };
      return [polygonCollapsed(point(cx, cy), 6), poly(R)];
    }
    case "star": {
      const R = maxRadius * Math.SQRT2 * 1.03;
      const innerRatio = 0.42;
      const starPolygon = (radius: number) => {
        const verts: string[] = [];
        for (let i = 0; i < 5; i++) {
          const outerA = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          verts.push(
            point(
              cx + radius * Math.cos(outerA),
              cy + radius * Math.sin(outerA),
            ),
          );
          const innerA = outerA + Math.PI / 5;
          verts.push(
            point(
              cx + radius * innerRatio * Math.cos(innerA),
              cy + radius * innerRatio * Math.sin(innerA),
            ),
          );
        }
        return `polygon(${verts.join(", ")})`;
      };
      const startR = Math.max(2, R * 0.025);
      return [starPolygon(startR), starPolygon(R)];
    }
    default:
      return [
        `circle(0% at ${point(cx, cy)})`,
        `circle(${toRadius(maxRadius)} at ${point(cx, cy)})`,
      ];
  }
}

export const AnimatedThemeToggler = ({
  className,
  duration = 400,
  variant,
  fromCenter = false,
  theme,
  onThemeChange,
  ...props
}: AnimatedThemeTogglerProps) => {
  const shape = variant ?? "circle";
  const isControlled = theme !== undefined;
  const [internalIsDark, setInternalIsDark] = useState(false);
  const isDark = isControlled ? theme === "dark" : internalIsDark;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isTransitioningRef = useRef(false);
  const activeAnimRef = useRef<Animation | null>(null);

  const cancelAnim = useCallback(() => {
    activeAnimRef.current?.cancel();
    activeAnimRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cancelAnim();
      const root = document.documentElement;
      if (root.dataset.magicuiThemeVt !== "active") return;
      delete root.dataset.magicuiThemeVt;
      root.style.removeProperty("--magicui-theme-toggle-vt-duration");
      root.style.removeProperty("--magicui-theme-vt-clip-from");
    };
  }, [cancelAnim]);

  useEffect(() => {
    if (isControlled) return;

    const updateTheme = () => {
      setInternalIsDark(document.documentElement.classList.contains("dark"));
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, [isControlled]);

  const toggleTheme = useCallback(
    (e?: React.MouseEvent<HTMLButtonElement>) => {
      if (isTransitioningRef.current) return;

      const button = (e?.currentTarget as HTMLElement) || buttonRef.current;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let x: number;
      let y: number;
      if (fromCenter || !button) {
        x = viewportWidth / 2;
        y = viewportHeight / 2;
      } else {
        const { top, left, width, height } = button.getBoundingClientRect();
        x = left + width / 2;
        y = top + height / 2;
      }

      const maxRadius = Math.hypot(
        Math.max(x, viewportWidth - x),
        Math.max(y, viewportHeight - y),
      );

      const applyTheme = () => {
        const nextIsDark = !isDark;
        const nextTheme = nextIsDark ? "dark" : "light";

        document.documentElement.classList.toggle("dark", nextIsDark);

        if (isControlled) {
          onThemeChange?.(nextTheme);
        } else {
          setInternalIsDark(nextIsDark);
          try {
            localStorage.setItem("theme", nextTheme);
          } catch {}
        }
      };

      if (typeof document.startViewTransition !== "function") {
        applyTheme();
        return;
      }

      const clipPath = getThemeTransitionClipPaths(
        shape,
        x,
        y,
        maxRadius,
        viewportWidth,
        viewportHeight,
      );

      const root = document.documentElement;
      root.dataset.magicuiThemeVt = "active";
      root.style.setProperty(
        "--magicui-theme-toggle-vt-duration",
        `${duration}ms`,
      );
      root.style.setProperty("--magicui-theme-vt-clip-from", clipPath[0]);

      const cleanup = () => {
        isTransitioningRef.current = false;
        delete root.dataset.magicuiThemeVt;
        root.style.removeProperty("--magicui-theme-toggle-vt-duration");
        root.style.removeProperty("--magicui-theme-vt-clip-from");
        cancelAnim();
      };

      isTransitioningRef.current = true;
      try {
        const transition = document.startViewTransition(() => {
          flushSync(applyTheme);
        });

        if (typeof transition?.finished?.finally === "function") {
          transition.finished.finally(cleanup).catch(cleanup);
        } else {
          cleanup();
        }

        const ready = transition?.ready;
        if (ready && typeof ready.then === "function") {
          ready
            .then(() => {
              const anim = document.documentElement.animate(
                {
                  clipPath,
                },
                {
                  duration,
                  easing: shape === "star" ? "linear" : "ease-in-out",
                  fill: "forwards",
                  pseudoElement: "::view-transition-new(root)",
                },
              );
              activeAnimRef.current = anim;
            })
            .catch(cleanup);
        }
      } catch {
        cleanup();
        applyTheme();
      }
    },
    [
      shape,
      fromCenter,
      duration,
      isDark,
      isControlled,
      onThemeChange,
      cancelAnim,
    ],
  );

  return (
    <button
      type="button"
      ref={buttonRef}
      className={cn(className)}
      {...props}
      onClick={(e) => {
        toggleTheme(e);
        props.onClick?.(e);
      }}
    >
      {isDark ? <Sun /> : <Moon />}
      <span className="sr-only">Toggle theme</span>
    </button>
  );
};
