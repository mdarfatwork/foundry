import type {
  AIModelMessage,
  AIGenerationResult,
  GenerationOutput,
  FileModification,
  ClarificationResult,
  ClarificationQuestion,
  ClarificationOption,
} from "./types";

/**
 * Server-only NVIDIA Hosted Inference API Provider for Foundry.
 * Implements resilient chat completions, reasoning model parsing, timeout handling,
 * adaptive clarification question assessment, and structured JSON extraction for z-ai/glm-5.3-flash.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2, and Prompt §4, §5, §6.
 */

const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_NVIDIA_MODEL = "z-ai/glm-5.3-flash";
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes for reasoning model generation
const CLARIFICATION_TIMEOUT_MS = 180_000; // 3 minutes for clarification questions
const MAX_GENERATION_TOKENS = 4096;
const MAX_CLARIFICATION_TOKENS = 1024;

export type GenerateWebsiteOptions = {
  readonly prompt: string;
  readonly existingFiles: readonly FileModification[];
  readonly previousMessages?: readonly AIModelMessage[];
  readonly timeoutMs?: number;
};

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
  // Fast heuristic: If prompt is exceptionally detailed (> 70 words or contains specific layout keywords), skip clarification
  const wordCount = trimmed.split(/\s+/).length;
  const hasSpecificDesignDirectives =
    /(header|hero|navbar|footer|pricing|testimonials|cards|sidebar|grid|faq)/i.test(
      trimmed,
    ) &&
    /(color|theme|palette|font|dark mode|light mode|minimal|luxury)/i.test(
      trimmed,
    );

  if (wordCount > 70 && hasSpecificDesignDirectives) {
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
function buildSystemPrompt(existingFiles: readonly FileModification[]): string {
  const existingFileList = existingFiles.map((f) => `- ${f.path}`).join("\n");

  return `You are Foundry's expert full-stack Next.js and Tailwind CSS AI engineer.
Your task is to generate the user's requested website inside an existing Next.js 16 + Tailwind CSS v4 project.

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

### Existing Project Files in Repository:
${existingFileList}

### Strict Generation Scope:
1. Generate a complete, polished, production-ready "app/page.tsx" containing all requested sections (Hero, Features, Showcase, Testimonials, CTA, Footer).
2. Reuse the existing shadcn/ui components (@/components/ui/button, @/components/ui/card, @/components/ui/badge) and @/lib/utils (cn).
3. Do NOT generate unnecessary configuration files or invent fake folders like "config/".
4. Never truncate code with comments like "// ...rest of code". Provide 100% complete TypeScript TSX code.
5. app/page.tsx MUST include "export default function Page() { ... }".

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
    content: buildSystemPrompt(options.existingFiles),
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
    if (!choice || !choice.message) {
      return {
        success: false,
        code: "MALFORMED_OUTPUT",
        error: "NVIDIA API returned an empty choices array.",
      };
    }

    // Handle reasoning models where content may be in message.content
    let content = choice.message.content;
    if (!content && choice.message.reasoning_content) {
      content = choice.message.reasoning_content;
    }

    if (!content) {
      return {
        success: false,
        code: "MALFORMED_OUTPUT",
        error:
          choice.finish_reason === "length"
            ? "Generation stopped due to output length limit. Try a simpler prompt or request specific components."
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
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        reasoningTokens:
          data.usage?.completion_tokens_details?.reasoning_tokens,
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
