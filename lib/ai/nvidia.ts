import type {
  AIModelMessage,
  AIGenerationResult,
  GenerationOutput,
  FileModification,
  ClarificationResult,
  ClarificationQuestion,
  ClarificationOption,
  GenerateWebsiteOptions,
} from "./types";
import { formatReferencesForPrompt } from "./references";

/**
 * Server-only NVIDIA Hosted Inference API Provider for Foundry.
 * Implements resilient chat completions, reasoning model parsing, timeout handling,
 * adaptive clarification question assessment, and structured JSON extraction for z-ai/glm-5.3-flash.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2, and Prompt §4, §5, §6.
 */

const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_NVIDIA_MODEL = "z-ai/glm-5.3-flash";
const DEFAULT_TIMEOUT_MS =
  Number(process.env.NVIDIA_TIMEOUT_MS) > 0
    ? Number(process.env.NVIDIA_TIMEOUT_MS)
    : 600_000; // 10 minutes for reasoning model generation & full page emission
const CLARIFICATION_TIMEOUT_MS = 60_000; // 1 minute max for clarification check
const MAX_GENERATION_TOKENS = 8192; // 8192 tokens for complete multi-section landing pages
const MAX_CLARIFICATION_TOKENS = 800;

export type { GenerateWebsiteOptions } from "./types";

/**
 * Parses raw model output text and extracts structured JSON.
 * Gracefully handles markdown code fences, embedded JSON blocks, and trailing commentary.
 */
export function extractStructuredOutput(rawText: string): GenerationOutput {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Model returned empty or non-string response.");
  }

  let text = rawText.trim();

  // 1. Strip markdown code fences if wrapped in ```json ... ``` or ``` ... ```
  const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = jsonBlockRegex.exec(text);
  if (match && match[1]) {
    text = match[1].trim();
  } else {
    // 2. Locate first '{' and last '}' if model included introductory prose
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Failed to parse model output as JSON: ${err instanceof Error ? err.message : "Syntax error"}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Parsed JSON must be an object.");
  }

  const record = parsed as Record<string, unknown>;

  const summary =
    typeof record.summary === "string" && record.summary.trim()
      ? record.summary.trim()
      : "Updated project files according to your instructions.";

  let details: string[] = [];
  if (Array.isArray(record.details)) {
    details = record.details
      .filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
      .map((item) => item.trim());
  }

  if (!Array.isArray(record.files) || record.files.length === 0) {
    throw new Error(
      'JSON output must contain a non-empty "files" array with { path, content } objects.',
    );
  }

  const files: FileModification[] = [];
  for (const f of record.files) {
    if (!f || typeof f !== "object") {
      throw new Error("Invalid file entry in generated files list.");
    }
    const fileObj = f as Record<string, unknown>;
    if (typeof fileObj.path !== "string" || !fileObj.path.trim()) {
      throw new Error("Each generated file must have a non-empty string path.");
    }
    if (typeof fileObj.content !== "string") {
      throw new Error(`File "${fileObj.path}" must have string content.`);
    }

    files.push({
      path: fileObj.path.trim(),
      content: fileObj.content,
    });
  }

  return {
    summary,
    details,
    files,
  };
}

/**
 * Parses raw text output from the model into a validated ClarificationResult.
 */
export function extractClarificationOutput(
  rawText: string,
): ClarificationResult {
  if (!rawText || typeof rawText !== "string") {
    return { needsClarification: false };
  }

  let text = rawText.trim();
  const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = jsonBlockRegex.exec(text);
  if (match && match[1]) {
    text = match[1].trim();
  } else {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { needsClarification: false };
  }

  if (!parsed || typeof parsed !== "object") {
    return { needsClarification: false };
  }

  const record = parsed as Record<string, unknown>;
  if (record.needsClarification !== true || !Array.isArray(record.questions)) {
    return { needsClarification: false };
  }

  const questions: ClarificationQuestion[] = [];
  for (const q of record.questions) {
    if (!q || typeof q !== "object") continue;
    const qObj = q as Record<string, unknown>;
    if (typeof qObj.id !== "string" || typeof qObj.question !== "string") {
      continue;
    }
    if (!Array.isArray(qObj.options) || qObj.options.length === 0) {
      continue;
    }

    const options: ClarificationOption[] = [];
    for (const opt of qObj.options) {
      if (!opt || typeof opt !== "object") continue;
      const optObj = opt as Record<string, unknown>;
      if (typeof optObj.id === "string" && typeof optObj.label === "string") {
        options.push({
          id: optObj.id,
          label: optObj.label,
          description:
            typeof optObj.description === "string"
              ? optObj.description
              : undefined,
        });
      }
    }

    if (options.length > 0) {
      // Ensure there is a "Let Foundry decide" option
      const hasDefault = options.some(
        (o) =>
          o.id.toLowerCase().includes("default") ||
          o.label.toLowerCase().includes("foundry decide"),
      );
      if (!hasDefault && options.length < 5) {
        options.push({
          id: "foundry_default",
          label: "Let Foundry decide",
        });
      }

      questions.push({
        id: qObj.id,
        question: qObj.question,
        options,
        isMultiSelect: Boolean(qObj.isMultiSelect),
      });
    }
  }

  if (questions.length === 0) {
    return { needsClarification: false };
  }

  // Bound to 2-4 questions
  return {
    needsClarification: true,
    questions: questions.slice(0, 4),
  };
}

/**
 * Assesses whether a user's prompt is broad/underspecified and generates
 * 2-4 multiple-choice clarification questions to establish key design & section decisions.
 */
export async function assessClarificationWithNvidia(
  prompt: string,
  timeoutMs: number = CLARIFICATION_TIMEOUT_MS,
): Promise<ClarificationResult> {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  const baseUrl =
    process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_NVIDIA_BASE_URL;
  const model = process.env.NVIDIA_MODEL?.trim() || DEFAULT_NVIDIA_MODEL;

  if (!apiKey) {
    return { needsClarification: false };
  }

  const trimmed = prompt.trim();
  const words = trimmed.split(/\s+/);
  const wordCount = words.length;

  // Detect specific section requests
  const sectionMatches = trimmed.match(
    /(header|hero|navbar|search|listing|property|properties|service|services|about|intro|introduction|testimonial|testimonials|review|reviews|contact|footer|pricing|feature|features|portfolio|gallery|faq)/gi,
  );
  const uniqueSections = new Set(sectionMatches?.map((s) => s.toLowerCase()));

  // Detect visual/styling directives
  const hasStyleDirectives =
    /(color|theme|palette|font|typography|dark|light|minimal|luxury|gold|black|white|elegant|modern|aesthetic|responsive|clean)/i.test(
      trimmed,
    );

  // Fast heuristic: If prompt is already specific (specifies multiple sections & visual directives, or is comprehensive), skip clarification
  if (
    (uniqueSections.size >= 3 && hasStyleDirectives) ||
    (wordCount >= 45 && uniqueSections.size >= 2) ||
    wordCount >= 65
  ) {
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: trimmed },
        ],
        temperature: 0.1,
        max_tokens: MAX_CLARIFICATION_TOKENS,
        reasoning_effort: "low",
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return { needsClarification: false };
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
        };
      }>;
    };

    const choice = data.choices?.[0];
    const content =
      choice?.message?.content || choice?.message?.reasoning_content;
    if (!content) {
      return { needsClarification: false };
    }

    return extractClarificationOutput(content);
  } catch {
    clearTimeout(timeoutId);
    // Graceful fallback to generation on timeout or network error
    return { needsClarification: false };
  }
}

/**
 * Builds the system instructions for the model, providing context about available
 * UI primitives, Tailwind v4 theme tokens, and the required JSON schema.
 */
function buildSystemPrompt(
  existingFiles: readonly FileModification[],
  references?: readonly import("./types").DesignReference[],
): string {
  const existingFileList = existingFiles.map((f) => `- ${f.path}`).join("\n");
  const referencesSection = formatReferencesForPrompt(references);

  return `You are Foundry's expert full-stack Next.js, React 19, and Tailwind CSS AI engineer.
Your task is to generate the user's requested single-page landing website inside an existing Next.js 16 + Tailwind CSS v4 project.

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
 * Executes a website generation request through the NVIDIA Hosted Inference API.
 */
export async function generateWebsiteWithNvidia(
  options: GenerateWebsiteOptions,
): Promise<AIGenerationResult> {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  const baseUrl =
    process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_NVIDIA_BASE_URL;
  const model = process.env.NVIDIA_MODEL?.trim() || DEFAULT_NVIDIA_MODEL;

  if (!apiKey) {
    return {
      success: false,
      code: "CONFIG_ERROR",
      error: "NVIDIA API key is not configured in server environment.",
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const systemMessage: AIModelMessage = {
    role: "system",
    content: buildSystemPrompt(options.existingFiles, options.references),
  };

  const messages: AIModelMessage[] = [
    systemMessage,
    ...(options.previousMessages ?? []),
    {
      role: "user",
      content: options.prompt,
    },
  ];

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: MAX_GENERATION_TOKENS,
        reasoning_effort: "low",
        stream: true,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 429) {
      return {
        success: false,
        code: "RATE_LIMIT",
        error:
          "NVIDIA inference rate limit reached. Please wait a moment before retrying.",
      };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        success: false,
        code: "PROVIDER_ERROR",
        error: `NVIDIA API error (${response.status} ${response.statusText}): ${errorText.slice(0, 200)}`,
      };
    }

    let content: string | null = null;
    let finishReason: string | undefined;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let reasoningTokens: number | undefined;

    // Resilient Streaming SSE handling (prevents TCP idle drops during long generations)
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";
      let accumulatedReasoning = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith("data:")) continue;
          const dataStr = trimmedLine.slice(5).trim();
          if (dataStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(dataStr);
            const choice = parsed.choices?.[0];
            if (choice?.finish_reason) {
              finishReason = choice.finish_reason;
            }
            if (choice?.delta?.content) {
              accumulatedContent += choice.delta.content;
            }
            if (choice?.delta?.reasoning_content) {
              accumulatedReasoning += choice.delta.reasoning_content;
            }
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
              completionTokens =
                parsed.usage.completion_tokens ?? completionTokens;
              reasoningTokens =
                parsed.usage.completion_tokens_details?.reasoning_tokens ??
                reasoningTokens;
            }
          } catch {
            // Ignore partial SSE chunks
          }
        }
      }

      content = accumulatedContent || accumulatedReasoning || null;
    } else {
      // Fallback for mocked unit tests and non-streaming environments
      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            reasoning_content?: string | null;
          };
          finish_reason?: string;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          completion_tokens_details?: {
            reasoning_tokens?: number;
          };
        };
      };

      const choice = data.choices?.[0];
      if (choice) {
        finishReason = choice.finish_reason;
        content =
          choice.message?.content || choice.message?.reasoning_content || null;
      }
      if (data.usage) {
        promptTokens = data.usage.prompt_tokens;
        completionTokens = data.usage.completion_tokens;
        reasoningTokens =
          data.usage.completion_tokens_details?.reasoning_tokens;
      }
    }

    if (!content) {
      return {
        success: false,
        code: "MALFORMED_OUTPUT",
        error:
          finishReason === "length"
            ? "Generation stopped due to output length limit. Try requesting fewer sections at a time."
            : "Model did not return any content.",
      };
    }

    let structuredOutput: GenerationOutput;
    try {
      structuredOutput = extractStructuredOutput(content);
    } catch (parseErr) {
      return {
        success: false,
        code: "MALFORMED_OUTPUT",
        error:
          parseErr instanceof Error
            ? parseErr.message
            : "Failed to parse model output into files.",
      };
    }

    return {
      success: true,
      output: structuredOutput,
      usage: {
        promptTokens,
        completionTokens,
        reasoningTokens,
      },
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return {
        success: false,
        code: "TIMEOUT",
        error: `Generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
      };
    }

    return {
      success: false,
      code: "PROVIDER_ERROR",
      error:
        err instanceof Error ? err.message : "Unknown network error occurred.",
    };
  }
}
