"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Layers, Palette, Type, Sliders, CheckCircle2 } from "lucide-react";

export function DesignSystemModal() {
  const [switchChecked, setSwitchChecked] = React.useState(true);
  const [checkboxChecked, setCheckboxChecked] = React.useState(true);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="text-xs font-mono h-7 gap-1.5 border-border hover:bg-accent"
          />
        }
      >
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        <span>Design System</span>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-6 sm:max-w-3xl">
        <DialogHeader className="gap-1 border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-lg font-semibold tracking-tight">
              Foundry Design System
            </DialogTitle>
            <Badge
              variant="secondary"
              className="font-mono text-[10px] uppercase"
            >
              v1.0 Tokens
            </Badge>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Developer-grade token system, typography hierarchy, and accessible
            UI primitives supporting bidirectional light and dark themes.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="tokens" className="w-full mt-2">
          <TabsList className="grid grid-cols-4 w-full h-8">
            <TabsTrigger value="tokens" className="text-xs gap-1.5">
              <Palette className="h-3.5 w-3.5" />
              <span>Tokens</span>
            </TabsTrigger>
            <TabsTrigger value="components" className="text-xs gap-1.5">
              <Sliders className="h-3.5 w-3.5" />
              <span>Components</span>
            </TabsTrigger>
            <TabsTrigger value="typography" className="text-xs gap-1.5">
              <Type className="h-3.5 w-3.5" />
              <span>Typography</span>
            </TabsTrigger>
            <TabsTrigger value="feedback" className="text-xs gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>States</span>
            </TabsTrigger>
          </TabsList>

          {/* Tokens Panel */}
          <TabsContent value="tokens" className="space-y-4 pt-4">
            <div>
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 font-mono">
                Core Semantic Surfaces & Colors
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  {
                    name: "background",
                    role: "Application backdrop",
                    var: "--background",
                  },
                  {
                    name: "card",
                    role: "Elevated panels & canvas",
                    var: "--card",
                  },
                  {
                    name: "primary",
                    role: "High-contrast action",
                    var: "--primary",
                  },
                  {
                    name: "secondary",
                    role: "Supporting control",
                    var: "--secondary",
                  },
                  {
                    name: "muted",
                    role: "Quiet container / text",
                    var: "--muted",
                  },
                  {
                    name: "accent",
                    role: "Hover and selection",
                    var: "--accent",
                  },
                  {
                    name: "destructive",
                    role: "Errors and alerts",
                    var: "--destructive",
                  },
                  {
                    name: "border",
                    role: "Subtle structural lines",
                    var: "--border",
                  },
                  {
                    name: "ring",
                    role: "Accessible focus indicator",
                    var: "--ring",
                  },
                ].map((token) => (
                  <div
                    key={token.name}
                    className="p-2.5 rounded-lg border border-border bg-card/60 flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-medium text-foreground">
                        {token.name}
                      </span>
                      <div
                        className="h-3 w-3 rounded-full border border-border"
                        style={{ background: `var(${token.var})` }}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {token.role}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground/70">
                      {token.var}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <Separator className="my-4" />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 font-mono">
                  Radius Scale (--radius: 0.5rem)
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2 rounded-sm border border-border bg-muted/40 font-mono">
                    <span>sm (0.25rem / 4px)</span>
                    <span className="text-muted-foreground">chips, badges</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-md border border-border bg-muted/40 font-mono">
                    <span>md (0.375rem / 6px)</span>
                    <span className="text-muted-foreground">
                      inputs, buttons
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg border border-border bg-muted/40 font-mono">
                    <span>lg (0.5rem / 8px)</span>
                    <span className="text-muted-foreground">
                      cards, dialogs
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 font-mono">
                  Theme Principles
                </h4>
                <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
                  <li>
                    Bidirectional parity: Light & Dark curated separately.
                  </li>
                  <li>
                    Developer-first neutral palette with zero saturated neon.
                  </li>
                  <li>Content over chrome: Builder UI stays muted.</li>
                  <li>Thin, precise 1px borders with alpha in dark mode.</li>
                </ul>
              </div>
            </div>
          </TabsContent>

          {/* Components Panel */}
          <TabsContent value="components" className="space-y-4 pt-4">
            <div className="space-y-3">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground font-mono">
                Button Variants & Sizes
              </h4>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="default" size="sm">
                  Primary
                </Button>
                <Button variant="secondary" size="sm">
                  Secondary
                </Button>
                <Button variant="outline" size="sm">
                  Outline
                </Button>
                <Button variant="ghost" size="sm">
                  Ghost
                </Button>
                <Button variant="destructive" size="sm">
                  Destructive
                </Button>
                <Button variant="link" size="sm">
                  Link
                </Button>
                <Button variant="default" size="sm" disabled>
                  Disabled
                </Button>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-3">
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground font-mono">
                  Input & Textarea
                </h4>
                <Input
                  placeholder="Search components..."
                  className="h-8 text-xs"
                />
                <Textarea
                  placeholder="Ask Foundry to modify layout or generate components..."
                  rows={2}
                  className="text-xs resize-none"
                />
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground font-mono">
                  Toggles & Checkboxes
                </h4>
                <div className="flex items-center justify-between p-2 rounded-md border border-border">
                  <span className="text-xs font-medium">
                    Automatic code sync
                  </span>
                  <Switch
                    checked={switchChecked}
                    onCheckedChange={(checked) => setSwitchChecked(!!checked)}
                  />
                </div>
                <div className="flex items-center gap-2 p-2 rounded-md border border-border">
                  <Checkbox
                    id="strict-lint"
                    checked={checkboxChecked}
                    onCheckedChange={(checked) => setCheckboxChecked(!!checked)}
                  />
                  <label
                    htmlFor="strict-lint"
                    className="text-xs font-medium cursor-pointer"
                  >
                    Enforce strict TypeScript validation
                  </label>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground font-mono">
                Badges
              </h4>
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">Production Ready</Badge>
                <Badge variant="secondary">Turbopack</Badge>
                <Badge variant="outline">Tailwind v4</Badge>
                <Badge variant="destructive">Error State</Badge>
              </div>
            </div>
          </TabsContent>

          {/* Typography Panel */}
          <TabsContent value="typography" className="space-y-4 pt-4">
            <div className="space-y-3">
              <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/20">
                <div>
                  <span className="text-[10px] font-mono uppercase text-muted-foreground">
                    Display Heading (text-2xl / font-semibold / tracking-tight)
                  </span>
                  <div className="text-2xl font-semibold tracking-tight text-foreground">
                    Build production software with Foundry
                  </div>
                </div>
                <Separator />
                <div>
                  <span className="text-[10px] font-mono uppercase text-muted-foreground">
                    Section Heading (text-base / font-medium)
                  </span>
                  <div className="text-base font-medium text-foreground">
                    Workspace & Component Inspector
                  </div>
                </div>
                <Separator />
                <div>
                  <span className="text-[10px] font-mono uppercase text-muted-foreground">
                    Body Text (text-sm / text-muted-foreground)
                  </span>
                  <p className="text-sm text-muted-foreground">
                    Foundry emphasizes minimal chrome and content-first
                    composition so your generated interfaces remain the
                    centerpiece of the developer workflow.
                  </p>
                </div>
                <Separator />
                <div>
                  <span className="text-[10px] font-mono uppercase text-muted-foreground">
                    Code / Monospace (font-mono / text-xs)
                  </span>
                  <div className="font-mono text-xs text-foreground bg-muted p-2 rounded border border-border">
                    pnpm dlx shadcn@latest add button card dialog
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* States Panel */}
          <TabsContent value="feedback" className="space-y-4 pt-4">
            <div className="space-y-3">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground font-mono">
                Loading & Skeleton Placeholders
              </h4>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <div className="space-y-1">
                      <Skeleton className="h-3.5 w-32" />
                      <Skeleton className="h-2.5 w-20" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                  <div className="flex gap-2 pt-2">
                    <Skeleton className="h-7 w-20 rounded-md" />
                    <Skeleton className="h-7 w-20 rounded-md" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
