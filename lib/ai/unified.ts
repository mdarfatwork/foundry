import { generateText } from "ai";
import {
  createLanguageModel,
  resolveActiveProvider,
  isProviderConfigured,
  getProviderConfig,
  redactSecrets,
  DEFAULT_NVIDIA_MODEL,
} from "./providers";
import {
  generateWebsiteWithNvidia,
  assessClarificationWithNvidia,
  extractStructuredOutput,
  extractClarificationOutput,
} from "./nvidia";
import { formatReferencesForPrompt } from "./references";
import type {
  AIProvider,
  GenerateWebsiteOptions,
  AIGenerationResult,
  ClarificationResult,
  DesignReference,
  FileModification,
} from "./types";

/**
 * Unified Multi-Provider AI Engine for Foundry.
 * Coordinates generation across Google Gemini, OpenRouter, and NVIDIA NIM using Vercel AI SDK.
 * Supports adaptive clarification, reference URLs/screenshots, fallback routing, and secret redaction.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2, and Prompt §4, §5, §6, §7.
 */

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes for full page code generation
const CLARIFICATION_TIMEOUT_MS = 45_000; // 45 seconds max for clarification check

function buildUnifiedSystemPrompt(
  existingFiles: readonly FileModification[],
  references?: readonly DesignReference[],
): string {
  const existingFileList = existingFiles.map((f) => `- ${f.path}`).join("\n");
  const referencesSection = formatReferencesForPrompt(references);

  return `You are Foundry's expert full-stack Next.js, React 19, and Tailwind CSS AI engineer.
Your task is to generate the user's requested single-page landing website inside an existing Next.js + Tailwind CSS v4 project.

### Project Architecture & Established File Structure:
- Root-level configuration files are ALREADY configured and fixed:
  - package.json
  - tsconfig.json
  - next.config.ts
  - components.json
  - postcss.config.mjs
  Do NOT modify or output any of these root configuration files!
- Project Source Files:
  - app/globals.css (Tailwind v4 OKLCH tokens)
  - app/layout.tsx (Root HTML & Body wrapper)
  - app/page.tsx (Main application landing page - THIS IS YOUR PRIMARY TARGET)
  - lib/utils.ts (Exports cn helper)
  - components/ui/button.tsx (Button primitive with default, outline, secondary, ghost, destructive)
  - components/ui/card.tsx (Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter)
  - components/ui/badge.tsx (Badge with default, secondary, outline, destructive)
- Icons: lucide-react (import { ArrowRight, Check, Sparkles, Star, Shield, Search } from "lucide-react")
- Animation: motion (import { motion } from "motion/react") for smooth transitions, entry animations, and hover effects.

### Existing Project Files in Repository:
${existingFileList}
${referencesSection ? `\n${referencesSection}\n` : ""}
### Free Photography Sourcing (Unsplash):
When the landing page benefits from visual imagery (hero visual, feature cards, showcase, team, testimonials):
- Use clean, functional Unsplash image URLs with auto=format&fit=crop&w=1200&q=80 query parameters.
- Verified photography candidates:
  - Tech / SaaS: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80"
  - Architecture / Real Estate: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80"
  - Creative / Studio: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80"
  - Testimonial Avatars: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80", "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80"
- Apply responsive aspect ratio classes (e.g. aspect-video, aspect-square), object-cover, and loading="lazy" for below-the-fold images.
- Do NOT embed large base64 images into TSX code.

### Strict Generation Scope:
1. Generate a complete, polished, production-ready "app/page.tsx" containing all requested sections (Hero, Features, Showcase, Testimonials, CTA, Footer).
2. Reuse the existing shadcn/ui components (@/components/ui/button, @/components/ui/card, @/components/ui/badge) and @/lib/utils (cn).
3. Do NOT generate unnecessary configuration files or invent fake folders like "config/".
4. Keep mock data items concise (e.g. 3 featured cards/properties, 2-3 testimonials/services) so the entire page is clean, modular, and completes reliably within token limits.
5. Never truncate code with comments like "// ...rest of code". Provide 100% complete TypeScript TSX code.
6. app/page.tsx MUST include "export default function Page() { ... }" or "export default function HomePage() { ... }".

### Strict JSON Output Schema:
You MUST reply with ONLY a single, valid JSON object.
{
  "summary": "1-2 sentence description of what was designed and generated.",
  "details": [
    "Key visual layout or hero section created",
    "Feature architecture or components highlighted",
    "Interactivity and responsive polish applied"
  ],
  "files": [
    {
      "path": "app/page.tsx",
      "content": "...complete valid TypeScript TSX..."
    }
  ]
}`;
}

/**
 * Assesses whether a user's prompt is broad and generates 2-3 multiple-choice
 * clarification questions using the configured AI provider.
 */
export async function assessClarification(
  prompt: string,
  references?: readonly DesignReference[],
  providerOverride?: AIProvider,
): Promise<ClarificationResult> {
  const provider = resolveActiveProvider(providerOverride);

  // If prompt already contains rich design references or detailed sections, skip clarification
  const trimmed = prompt.trim();
  const words = trimmed.split(/\s+/);
  const sectionMatches = trimmed.match(
    /(header|hero|navbar|search|listing|property|properties|service|services|about|intro|introduction|testimonial|testimonials|review|reviews|contact|footer|pricing|feature|features|portfolio|gallery|faq)/gi,
  );
  const uniqueSections = new Set(sectionMatches?.map((s) => s.toLowerCase()));
  const hasStyleDirectives =
    /(color|theme|palette|font|typography|dark|light|minimal|luxury|gold|black|white|elegant|modern|aesthetic|responsive|clean)/i.test(
      trimmed,
    );

  if (
    (references && references.length > 0 && uniqueSections.size >= 2) ||
    (uniqueSections.size >= 3 && hasStyleDirectives) ||
    (words.length >= 45 && uniqueSections.size >= 2) ||
    words.length >= 65
  ) {
    return { needsClarification: false };
  }

  // If NVIDIA is the active provider, use the tuned assessment helper
  if (provider === "nvidia") {
    return assessClarificationWithNvidia(prompt, CLARIFICATION_TIMEOUT_MS);
  }

  // Google or OpenRouter via Vercel AI SDK
  if (!isProviderConfigured(provider)) {
    return { needsClarification: false };
  }

  const systemPrompt = `You are Foundry's senior AI design architect.
Analyze the user's prompt for building a website or web application.
Determine if the prompt is broad or underspecified and would benefit from 2 to 3 high-impact multiple-choice clarification questions before generating code.

If the prompt is ALREADY specific (e.g. contains specific section list, color scheme, and content copy), return:
{
  "needsClarification": false
}

If the prompt is broad (e.g., "Build a real estate website", "Create a SaaS landing page", "Portfolio for designer"), return:
{
  "needsClarification": true,
  "questions": [
    {
      "id": "visual_direction",
      "question": "What visual direction do you prefer?",
      "isMultiSelect": false,
      "options": [
        { "id": "opt_luxury", "label": "Luxury & elegant (charcoal, gold accents)" },
        { "id": "opt_minimal", "label": "Modern & minimal (whites, neutral slate)" },
        { "id": "opt_warm", "label": "Warm & editorial (cream, earthy tones)" },
        { "id": "opt_default", "label": "Let Foundry decide" }
      ]
    },
    {
      "id": "primary_focus",
      "question": "What should the hero section emphasize?",
      "isMultiSelect": false,
      "options": [
        { "id": "opt_search", "label": "Interactive search / calculator interface" },
        { "id": "opt_visual", "label": "High-impact visual showcase" },
        { "id": "opt_default", "label": "Let Foundry decide" }
      ]
    },
    {
      "id": "key_sections",
      "question": "Which sections should be included?",
      "isMultiSelect": true,
      "options": [
        { "id": "opt_features", "label": "Core features / showcase grid" },
        { "id": "opt_testimonials", "label": "Client reviews & social proof" },
        { "id": "opt_pricing", "label": "Pricing matrix or contact inquiry form" }
      ]
    }
  ]
}

Important Rules:
- Ask only 2 to 3 meaningful questions.
- Tailor questions specifically to the domain of the user's prompt.
- Do NOT ask questions about details the user already specified.
- Options must be concise and easy to compare.
- Reply ONLY with valid JSON.`;

  try {
    const model = createLanguageModel(provider);
    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: trimmed,
      abortSignal: AbortSignal.timeout(CLARIFICATION_TIMEOUT_MS),
    });

    return extractClarificationOutput(text);
  } catch {
    return { needsClarification: false };
  }
}

/**
 * Primary code generation function.
 * Routes to the configured provider (NVIDIA, Google Gemini, OpenRouter),
 * formats system prompts and design references, and extracts validated structured output.
 */
export async function generateWebsite(
  options: GenerateWebsiteOptions,
): Promise<AIGenerationResult> {
  const provider = resolveActiveProvider(options.provider);
  const startTime = Date.now();

  // If NVIDIA is the chosen provider, call the dedicated NVIDIA inference engine
  if (provider === "nvidia") {
    const result = await generateWebsiteWithNvidia(options);
    if (result.success) {
      return {
        ...result,
        provider: "nvidia",
        model: options.model || DEFAULT_NVIDIA_MODEL,
        latencyMs: Date.now() - startTime,
      };
    }

    // Check if fallback to another configured provider is viable on retryable error
    const isRetryable =
      result.code === "RATE_LIMIT" || result.code === "PROVIDER_ERROR";
    if (isRetryable) {
      if (isProviderConfigured("google")) {
        return generateWebsite({ ...options, provider: "google" });
      } else if (isProviderConfigured("openrouter")) {
        return generateWebsite({ ...options, provider: "openrouter" });
      }
    }

    return {
      ...result,
      provider: "nvidia",
      model: options.model || DEFAULT_NVIDIA_MODEL,
    };
  }

  // Google or OpenRouter via Vercel AI SDK
  const config = getProviderConfig(provider, options.model);
  if (!config.apiKey) {
    return {
      success: false,
      code: "CONFIG_ERROR",
      provider,
      model: config.modelId,
      error: `API key for ${provider.toUpperCase()} is not configured in server environment.`,
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const model = createLanguageModel(provider, config.modelId);
    const systemPrompt = buildUnifiedSystemPrompt(
      options.existingFiles,
      options.references,
    );

    const { text, usage } = await generateText({
      model,
      system: systemPrompt,
      prompt: options.prompt,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });

    let structuredOutput;
    try {
      structuredOutput = extractStructuredOutput(text);
    } catch (parseErr) {
      return {
        success: false,
        code: "MALFORMED_OUTPUT",
        provider,
        model: config.modelId,
        error:
          parseErr instanceof Error
            ? redactSecrets(parseErr.message)
            : "Failed to parse model output into structured files.",
      };
    }

    return {
      success: true,
      output: structuredOutput,
      provider,
      model: config.modelId,
      latencyMs: Date.now() - startTime,
      usage: {
        promptTokens: usage?.inputTokens,
        completionTokens: usage?.outputTokens,
      },
    };
  } catch (err) {
    const errorMsg =
      err instanceof Error ? redactSecrets(err.message) : "Unknown AI error.";

    if (errorMsg.includes("429") || /rate[- ]limit/i.test(errorMsg)) {
      return {
        success: false,
        code: "RATE_LIMIT",
        provider,
        model: config.modelId,
        error: `${provider.toUpperCase()} rate limit reached. Please wait a moment before retrying.`,
      };
    }

    if (errorMsg.includes("timeout") || /timed?[- ]?out/i.test(errorMsg)) {
      return {
        success: false,
        code: "TIMEOUT",
        provider,
        model: config.modelId,
        error: `Generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
      };
    }

    return {
      success: false,
      code: "PROVIDER_ERROR",
      provider,
      model: config.modelId,
      error: errorMsg,
    };
  }
}
