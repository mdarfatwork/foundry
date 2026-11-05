/**
 * Reusable starter template definition for Foundry projects.
 * Next.js 16 + React 19 + Tailwind CSS v4 + Base UI (shadcn base-nova).
 * Adheres strictly to AGENTS.md §1, §2, §5.1, and Prompt §3.
 */

export const STARTER_TEMPLATE_ID = "nextjs-shadcn-v1";

export type TemplateFile = {
  readonly path: string;
  readonly content: string;
};

export function getStarterTemplateFiles(
  projectName: string,
): readonly TemplateFile[] {
  const sanitizedName =
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/^-+|-+$/g, "") || "foundry-app";

  return [
    {
      path: "package.json",
      content: JSON.stringify(
        {
          name: sanitizedName,
          version: "0.1.0",
          private: true,
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
            lint: "eslint",
          },
          dependencies: {
            "@base-ui/react": "^1.9.0",
            "class-variance-authority": "^0.7.1",
            cn: "^0.5.0",
            "lucide-react": "^1.62.0",
            next: "16.4.3",
            "next-themes": "^0.4.6",
            react: "19.3.0",
            "react-dom": "19.3.0",
            "tw-animate-css": "^1.4.0",
          },
          devDependencies: {
            "@tailwindcss/turbopack": "^4",
            "@types/node": "^20",
            "@types/react": "^19",
            "@types/react-dom": "^19",
            tailwindcss: "^4",
            typescript: "^5",
          },
        },
        null,
        2,
      ),
    },
    {
      path: "tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: false,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            incremental: true,
            plugins: [{ name: "next" }],
            paths: {
              "@/*": ["./*"],
            },
          },
          include: [
            "next-env.d.ts",
            "**/*.ts",
            "**/*.tsx",
            ".next/types/**/*.ts",
          ],
          exclude: ["node_modules"],
        },
        null,
        2,
      ),
    },
    {
      path: "next.config.ts",
      content: `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
`,
    },
    {
      path: "postcss.config.mjs",
      content: `export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
`,
    },
    {
      path: "components.json",
      content: JSON.stringify(
        {
          $schema: "https://ui.shadcn.com/schema.json",
          style: "base-nova",
          rsc: true,
          tsx: true,
          tailwind: {
            config: "",
            css: "app/globals.css",
            baseColor: "neutral",
            cssVariables: true,
            prefix: "",
          },
          iconLibrary: "lucide",
          rtl: false,
          aliases: {
            components: "@/components",
            utils: "@/lib/utils",
            ui: "@/components/ui",
            lib: "@/lib",
            hooks: "@/hooks",
          },
        },
        null,
        2,
      ),
    },
    {
      path: "app/globals.css",
      content: `@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *, .dark, .dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) * 0.5);
  --radius-md: calc(var(--radius) * 0.75);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.5);
}

:root {
  --background: oklch(0.985 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.145 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.96 0 0);
  --secondary-foreground: oklch(0.145 0 0);
  --muted: oklch(0.96 0 0);
  --muted-foreground: oklch(0.55 0 0);
  --accent: oklch(0.96 0 0);
  --accent-foreground: oklch(0.145 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.92 0 0);
  --input: oklch(0.92 0 0);
  --ring: oklch(0.7 0 0);
  --radius: 0.625rem;
}

.dark {
  --background: oklch(0.12 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.15 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.15 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.145 0 0);
  --secondary: oklch(0.22 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.22 0 0);
  --muted-foreground: oklch(0.65 0 0);
  --accent: oklch(0.22 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.396 0.141 25.723);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.25 0 0);
  --input: oklch(0.25 0 0);
  --ring: oklch(0.4 0 0);
}
`,
    },
    {
      path: "app/layout.tsx",
      content: `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "${projectName}",
  description: "Generated with Foundry AI Website Builder",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased selection:bg-foreground selection:text-background">
        {children}
      </body>
    </html>
  );
}
`,
    },
    {
      path: "app/page.tsx",
      content: `import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowRight } from "lucide-react";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-12">
      <div className="w-full max-w-2xl space-y-6 text-center">
        <div className="flex justify-center">
          <Badge variant="outline" className="gap-1.5 px-3 py-1 font-mono text-xs">
            <Sparkles className="size-3 text-primary" />
            <span>Ready for Generation</span>
          </Badge>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl text-foreground">
            ${projectName}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto">
            This project has been initialized with Next.js and shadcn/ui. Use the Foundry chat prompt to build your layout, features, and styling.
          </p>
        </div>

        <Card className="text-left border-border/80 bg-card/60 backdrop-blur-xs">
          <CardHeader>
            <CardTitle className="text-base">Getting Started</CardTitle>
            <CardDescription>
              Prompt the AI assistant on the left to transform this page into a landing page, dashboard, or SaaS application.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground font-mono">
              app/page.tsx
            </span>
            <Button size="sm" className="gap-1.5">
              <span>Explore Features</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
`,
    },
    {
      path: "lib/utils.ts",
      content: `export { cn } from "cn";
`,
    },
    {
      path: "components/ui/button.tsx",
      content: `import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border-border bg-background hover:bg-muted hover:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: {
        default: "h-8 gap-1.5 px-3",
        sm: "h-7 gap-1 px-2.5 text-xs",
        lg: "h-9 gap-2 px-4",
        icon: "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
`,
    },
    {
      path: "components/ui/card.tsx",
      content: `import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rounded-xl border border-border bg-card p-6 text-card-foreground shadow-2xs",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-lg font-semibold tracking-tight leading-none", className)}
      {...props}
    />
  );
}

function CardDescription({
  className,
  ...props
}: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground leading-relaxed", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div data-slot="card-content" className={cn("pt-4", className)} {...props} />
  );
}

function CardFooter({ className, ...props }: Readonly<ComponentProps<"div">>) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center pt-4", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
`,
    },
    {
      path: "components/ui/badge.tsx",
      content: `import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  ...props
}: Readonly<ComponentProps<"span">> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
`,
    },
  ];
}
