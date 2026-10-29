"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { DesignSystemModal } from "@/components/design-system-modal";
import { ShareDialog } from "@/components/share-dialog";
import {
  ArrowUp,
  Monitor,
  Tablet,
  Smartphone,
  Eye,
  Code2,
  RotateCw,
  ExternalLink,
  Paperclip,
  Check,
  Copy,
  Terminal,
  Cpu,
  Zap,
  Globe,
  Flame,
} from "lucide-react";

type ViewportMode = "desktop" | "tablet" | "mobile";
type ViewMode = "preview" | "code";

interface ChatMessage {
  id: string;
  sender: "user" | "foundry";
  text: string;
  timestamp: string;
  version?: string;
  files?: string[];
}

export default function FoundryWorkspace() {
  const [viewport, setViewport] = React.useState<ViewportMode>("desktop");
  const [viewMode, setViewMode] = React.useState<ViewMode>("preview");
  const [promptInput, setPromptInput] = React.useState("");
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [copiedCode, setCopiedCode] = React.useState(false);
  const nextMsgIdRef = React.useRef(3);

  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: "msg-1",
      sender: "user",
      text: "Build a high-performance landing page for Aurora Engine: a low-latency edge telemetry system with a live telemetry metric, features grid, and CLI snippet.",
      timestamp: "10:42 AM",
    },
    {
      id: "msg-2",
      sender: "foundry",
      text: "Generated Aurora Engine v1.0. Crafted a responsive hero with real-time throughput metrics, three architectural feature cards, and an interactive copy-ready terminal command.",
      timestamp: "10:43 AM",
      version: "v1.0",
      files: ["app/page.tsx", "components/hero.tsx", "components/metrics.tsx"],
    },
  ]);

  const handleSendPrompt = (textToSend?: string) => {
    const text = textToSend || promptInput;
    if (!text.trim() || isGenerating) return;

    const userMsgId = `msg-${nextMsgIdRef.current++}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: "user",
      text: text.trim(),
      timestamp: "Just now",
    };

    setMessages((prev) => [...prev, userMsg]);
    setPromptInput("");
    setIsGenerating(true);

    // Realistic generative cycle
    setTimeout(() => {
      const responseMsgId = `msg-${nextMsgIdRef.current++}`;
      const responseMsg: ChatMessage = {
        id: responseMsgId,
        sender: "foundry",
        text: `Updated application with: "${text.trim()}". Applied modern tokens, optimized layouts, and verified dark/light contrast.`,
        timestamp: "Just now",
        version: `v1.${nextMsgIdRef.current}`,
        files: ["app/page.tsx", "components/showcase.tsx"],
      };
      setMessages((prev) => [...prev, responseMsg]);
      setIsGenerating(false);
    }, 1800);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSendPrompt();
    }
  };

  const sampleCode = `import * as React from "react";
import { Zap, Terminal, Shield } from "lucide-react";

export default function AuroraEngineHero() {
  return (
    <section className="relative overflow-hidden py-20 px-6 sm:px-12 bg-card text-card-foreground">
      <div className="max-w-4xl mx-auto space-y-8 text-center sm:text-left">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-border bg-muted/50 text-xs font-mono">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Aurora v3.2 Telemetry Engine • Low Latency</span>
        </div>
        <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight">
          Edge telemetry built for real-time observability.
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          Process millions of high-cardinality distributed events per second with sub-5ms latency.
        </p>
      </div>
    </section>
  );
}`;

  const copyCodeToClipboard = () => {
    navigator.clipboard?.writeText(sampleCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground antialiased overflow-hidden">
      {/* Top Application Header */}
      <header className="h-12 border-b border-border bg-background/95 backdrop-blur-xs px-3 sm:px-4 flex items-center justify-between shrink-0 select-none z-30">
        {/* Left: Branding & Project */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-foreground text-background flex items-center justify-center font-bold text-xs tracking-wider shadow-xs">
              <Flame className="h-3.5 w-3.5 fill-current" />
            </div>
            <span className="font-semibold text-sm tracking-tight text-foreground">
              Foundry
            </span>
          </div>

          <Separator orientation="vertical" className="h-4" />

          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground hidden sm:inline">
              project /
            </span>
            <span className="font-medium text-foreground">aurora-engine</span>
            <Badge
              variant="outline"
              className="text-[10px] h-4.5 px-1.5 font-mono"
            >
              Next.js 16
            </Badge>
          </div>
        </div>

        {/* Center: Viewport & View Mode Switches */}
        <div className="hidden md:flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border">
          {/* View Mode Tabs */}
          <div className="flex items-center">
            <button
              onClick={() => setViewMode("preview")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                viewMode === "preview"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Preview</span>
            </button>
            <button
              onClick={() => setViewMode("code")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                viewMode === "code"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              <span>Code</span>
            </button>
          </div>

          <Separator orientation="vertical" className="h-3.5 mx-1" />

          {/* Viewport Selectors */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={() => setViewport("desktop")}
                    className={`p-1 rounded-sm text-xs transition-colors ${
                      viewport === "desktop"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    aria-label="Desktop viewport"
                  />
                }
              >
                <Monitor className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Desktop (100%)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={() => setViewport("tablet")}
                    className={`p-1 rounded-sm text-xs transition-colors ${
                      viewport === "tablet"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    aria-label="Tablet viewport"
                  />
                }
              >
                <Tablet className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Tablet (768px)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={() => setViewport("mobile")}
                    className={`p-1 rounded-sm text-xs transition-colors ${
                      viewport === "mobile"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    aria-label="Mobile viewport"
                  />
                }
              >
                <Smartphone className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Mobile (375px)</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          <DesignSystemModal />
          <ShareDialog />
          <ThemeToggle />
          <div className="h-6 w-6 rounded-full bg-muted border border-border flex items-center justify-center text-[10px] font-mono font-medium text-foreground ml-1">
            FA
          </div>
        </div>
      </header>

      {/* Main Builder Grid */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Conversation Stream & Prompt Composer */}
        <section
          aria-label="AI Prompt Stream"
          className="w-full md:w-[420px] lg:w-[460px] border-r border-border flex flex-col bg-background/50 shrink-0 z-20"
        >
          {/* Chat Stream Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col gap-1.5 ${
                  msg.sender === "user" ? "items-end" : "items-start"
                }`}
              >
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                  <span>{msg.sender === "user" ? "You" : "Foundry AI"}</span>
                  <span>•</span>
                  <span>{msg.timestamp}</span>
                  {msg.version && (
                    <Badge
                      variant="outline"
                      className="text-[9px] h-3.5 px-1 font-mono"
                    >
                      {msg.version}
                    </Badge>
                  )}
                </div>

                <div
                  className={`max-w-[90%] p-3 rounded-lg border text-xs leading-relaxed ${
                    msg.sender === "user"
                      ? "bg-secondary/70 border-border text-foreground"
                      : "bg-card border-border text-card-foreground shadow-xs"
                  }`}
                >
                  <p>{msg.text}</p>

                  {msg.files && msg.files.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border flex flex-wrap gap-1">
                      {msg.files.map((file) => (
                        <span
                          key={file}
                          className="font-mono text-[10px] bg-muted/60 px-1.5 py-0.5 rounded text-muted-foreground"
                        >
                          {file}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Live Generation Skeleton State */}
            {isGenerating && (
              <div className="flex flex-col gap-1.5 items-start">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                  <span>Foundry AI is assembling interface...</span>
                </div>
                <div className="w-[85%] p-3 rounded-lg border border-border bg-card space-y-2.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                  <div className="flex gap-2 pt-1">
                    <Skeleton className="h-5 w-20 rounded" />
                    <Skeleton className="h-5 w-16 rounded" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Suggestions */}
          <div className="px-3 pt-2 pb-1 border-t border-border/60 bg-background/80 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[10px] text-muted-foreground font-mono shrink-0 uppercase tracking-wider">
              Ideas:
            </span>
            {[
              "Add interactive pricing matrix",
              "Include CLI telemetry benchmark widget",
              "Add customer testimonials carousel",
            ].map((suggestion) => (
              <button
                key={suggestion}
                disabled={isGenerating}
                onClick={() => handleSendPrompt(suggestion)}
                className="shrink-0 text-[11px] px-2 py-0.5 rounded-full border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>

          {/* Prompt Composer */}
          <div className="p-3 border-t border-border bg-card/60">
            <div className="relative rounded-lg border border-border bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 transition-all shadow-xs">
              <Textarea
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Foundry to create, style, or restyle components..."
                rows={3}
                disabled={isGenerating}
                className="w-full resize-none border-0 bg-transparent p-2.5 text-xs placeholder:text-muted-foreground focus-visible:ring-0 shadow-none min-h-[64px]"
              />

              <div className="flex items-center justify-between p-1.5 border-t border-border/40 bg-muted/20">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          aria-label="Attach wireframe"
                        />
                      }
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Attach wireframe or schema
                    </TooltipContent>
                  </Tooltip>

                  <Badge
                    variant="outline"
                    className="text-[10px] h-5 px-1.5 font-mono"
                  >
                    Foundry v4-fast
                  </Badge>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
                    ⌘Enter
                  </span>
                  <Button
                    size="icon-sm"
                    disabled={!promptInput.trim() || isGenerating}
                    onClick={() => handleSendPrompt()}
                    className="h-7 w-7 rounded-md"
                    aria-label="Send prompt"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right Panel: Workspace Canvas & Code View */}
        <main
          aria-label="Workspace Canvas Preview"
          className="flex-1 flex flex-col bg-muted/30 overflow-hidden relative"
        >
          {/* Canvas Browser Header Bar */}
          <div className="h-9 border-b border-border bg-background/70 px-3 flex items-center justify-between shrink-0 text-xs">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <div className="flex items-center gap-1 text-muted-foreground">
                <div className="h-2 w-2 rounded-full bg-border" />
                <div className="h-2 w-2 rounded-full bg-border" />
                <div className="h-2 w-2 rounded-full bg-border" />
              </div>

              <div className="h-6 flex-1 px-2.5 rounded-md border border-border bg-muted/40 flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground truncate">
                <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  https://preview.foundry.dev/aurora-engine
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-xs"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setIsGenerating(true);
                  setTimeout(() => setIsGenerating(false), 800);
                }}
                aria-label="Reload preview"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                aria-label="Open in new window"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Canvas Viewport Body */}
          <div className="flex-1 overflow-auto p-4 sm:p-6 flex items-start justify-center">
            {viewMode === "preview" ? (
              <div
                className={`transition-all duration-300 w-full ${
                  viewport === "desktop"
                    ? "max-w-5xl"
                    : viewport === "tablet"
                      ? "max-w-[768px]"
                      : "max-w-[375px]"
                }`}
              >
                {/* The Generated Website Canvas (Clean developer website mock) */}
                <div className="rounded-xl border border-border bg-card text-card-foreground shadow-sm overflow-hidden transition-all">
                  {/* Generated Website Navigation */}
                  <div className="border-b border-border/80 px-6 py-3.5 flex items-center justify-between bg-card">
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-5 rounded bg-primary text-primary-foreground flex items-center justify-center font-mono text-xs font-bold">
                        A
                      </div>
                      <span className="font-semibold text-sm tracking-tight text-foreground">
                        Aurora
                      </span>
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-4.5 px-1.5 font-mono ml-1"
                      >
                        Beta
                      </Badge>
                    </div>

                    <div className="hidden sm:flex items-center gap-5 text-xs text-muted-foreground">
                      <span className="hover:text-foreground cursor-pointer transition-colors">
                        Architecture
                      </span>
                      <span className="hover:text-foreground cursor-pointer transition-colors">
                        Benchmarks
                      </span>
                      <span className="hover:text-foreground cursor-pointer transition-colors">
                        Docs
                      </span>
                      <span className="hover:text-foreground cursor-pointer transition-colors">
                        Pricing
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                      >
                        Sign In
                      </Button>
                      <Button size="sm" className="h-7 text-xs">
                        Deploy Node
                      </Button>
                    </div>
                  </div>

                  {/* Hero Section */}
                  <div className="px-6 sm:px-12 py-16 sm:py-20 text-center sm:text-left space-y-6 bg-gradient-to-b from-card via-card to-muted/20">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted/60 text-xs font-mono">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-foreground">
                        Edge Engine v3.2 Telemetry Stack
                      </span>
                    </div>

                    <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight text-foreground max-w-2xl leading-[1.15]">
                      Low-latency telemetry engineered for mission-critical
                      infrastructure.
                    </h1>

                    <p className="text-sm sm:text-base text-muted-foreground max-w-xl leading-relaxed">
                      Stream, ingest, and query billions of high-cardinality
                      distributed traces in real time with predictable sub-5ms
                      p99 query latency.
                    </p>

                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-2">
                      <Button
                        size="default"
                        className="text-xs h-9 px-4 gap-1.5"
                      >
                        <Zap className="h-3.5 w-3.5" />
                        <span>Start Free Trial</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="default"
                        className="text-xs h-9 px-4 gap-1.5"
                      >
                        <Terminal className="h-3.5 w-3.5" />
                        <span>Read Architecture Spec</span>
                      </Button>
                    </div>

                    {/* Interactive Telemetry Metric Card */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-6 max-w-2xl">
                      <div className="p-3.5 rounded-lg border border-border bg-background/80 space-y-1">
                        <span className="text-[11px] font-mono text-muted-foreground uppercase">
                          Throughput
                        </span>
                        <div className="text-xl font-bold font-mono tracking-tight text-foreground">
                          4.8M ops/s
                        </div>
                        <span className="text-[10px] text-emerald-500 font-medium">
                          ↑ 14% vs baseline
                        </span>
                      </div>

                      <div className="p-3.5 rounded-lg border border-border bg-background/80 space-y-1">
                        <span className="text-[11px] font-mono text-muted-foreground uppercase">
                          p99 Latency
                        </span>
                        <div className="text-xl font-bold font-mono tracking-tight text-foreground">
                          3.2 ms
                        </div>
                        <span className="text-[10px] text-muted-foreground font-medium">
                          Globally verified
                        </span>
                      </div>

                      <div className="p-3.5 rounded-lg border border-border bg-background/80 space-y-1">
                        <span className="text-[11px] font-mono text-muted-foreground uppercase">
                          Memory Footprint
                        </span>
                        <div className="text-xl font-bold font-mono tracking-tight text-foreground">
                          28 MB
                        </div>
                        <span className="text-[10px] text-emerald-500 font-medium">
                          Zero GC pause
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Feature Cards Grid */}
                  <div className="p-6 sm:p-12 border-t border-border bg-muted/10 space-y-6">
                    <div className="space-y-1">
                      <h2 className="text-lg font-semibold tracking-tight text-foreground">
                        Architectural Core
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Purpose-built components designed for zero-overhead
                        observability.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <Card className="bg-card">
                        <CardHeader className="pb-2">
                          <Cpu className="h-4 w-4 text-foreground mb-1" />
                          <CardTitle className="text-sm font-semibold">
                            Ring-Buffer Queues
                          </CardTitle>
                          <CardDescription className="text-xs">
                            Lock-free memory ring buffers with zero allocations
                            on hot paths.
                          </CardDescription>
                        </CardHeader>
                      </Card>

                      <Card className="bg-card">
                        <CardHeader className="pb-2">
                          <Zap className="h-4 w-4 text-foreground mb-1" />
                          <CardTitle className="text-sm font-semibold">
                            WASM Edge Pipeline
                          </CardTitle>
                          <CardDescription className="text-xs">
                            Filter, parse, and redact confidential payloads at
                            the ingress point.
                          </CardDescription>
                        </CardHeader>
                      </Card>

                      <Card className="bg-card">
                        <CardHeader className="pb-2">
                          <Terminal className="h-4 w-4 text-foreground mb-1" />
                          <CardTitle className="text-sm font-semibold">
                            Instant CLI Telemetry
                          </CardTitle>
                          <CardDescription className="text-xs">
                            Direct tailing with streaming web sockets and
                            sub-second indexing.
                          </CardDescription>
                        </CardHeader>
                      </Card>
                    </div>
                  </div>

                  {/* Terminal Command Snippet */}
                  <div className="p-6 border-t border-border bg-card flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="space-y-0.5 text-center sm:text-left">
                      <span className="text-xs font-medium text-foreground">
                        Install the Aurora Telemetry Agent
                      </span>
                      <p className="text-[11px] text-muted-foreground">
                        One command setup for macOS, Linux, and Kubernetes.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 p-1.5 rounded-lg border border-border bg-muted/60 font-mono text-xs">
                      <span className="text-muted-foreground pl-2">$</span>
                      <span className="text-foreground">
                        curl -fsSL https://aurora.run | sh
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="h-6 w-6 ml-2"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Code Editor Tab */
              <div className="w-full max-w-4xl rounded-xl border border-border bg-card text-card-foreground shadow-sm overflow-hidden">
                <div className="border-b border-border bg-muted/40 px-4 py-2 flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-background border border-border text-foreground font-medium">
                      app/page.tsx
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      TypeScript JSX
                    </span>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5 font-mono"
                    onClick={copyCodeToClipboard}
                  >
                    {copiedCode ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </Button>
                </div>

                <div className="p-4 overflow-x-auto bg-background/50 font-mono text-xs leading-relaxed text-foreground select-text">
                  <pre className="text-muted-foreground">
                    <code>{sampleCode}</code>
                  </pre>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
