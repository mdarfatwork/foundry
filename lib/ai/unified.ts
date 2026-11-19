import { generateText } from "ai";
import {
  createLanguageModelFromRegistry,
  isProviderConfigured,
  redactSecrets,
} from "./providers";
import {
  extractClarificationOutput,
  extractStructuredOutput,
  JSON_REPAIR_INSTRUCTION,
  parseDesignBrief,
} from "./parse";
import {
  buildClarificationSystemPrompt,
  buildDesignBriefPrompt,
  buildGenerationSystemPrompt,
  composeBriefedUserPrompt,
  inferRecipeFromPrompt,
  extractRequestedSectionsFromPrompt,
} from "./prompts";
import {
  markProviderCooldown,
  selectModelForTask,
  type RouteSelection,
} from "./router";
import type { DesignBrief } from "./schemas";
import type {
  AIGenerationResult,
  ClarificationResult,
  DesignReference,
  GenerateWebsiteOptions,
  GenerationErrorCode,
  GenerationTask,
} from "./types";
import { resolveRegistryModelId, type RegistryModel } from "./registry";

/**
 * Unified free-model AI engine for Foundry.
 * All calls use the Vercel AI SDK. Routing is automatic and free-only.
 */

const DEFAULT_TIMEOUT_MS = 60_000;
const CLARIFICATION_TIMEOUT_MS = 25_000;
const BRIEF_TIMEOUT_MS = 25_000;
const MAX_PROVIDER_ATTEMPTS = 3;

function detectTask(options: GenerateWebsiteOptions): GenerationTask {
  if (options.task) return options.task;
  const prompt = options.prompt.toLowerCase();
  const hasPage = options.existingFiles.some(
    (f) =>
      f.path === "app/page.tsx" &&
      f.content.includes("export default") &&
      f.content.length > 400,
  );
  if (
    hasPage &&
    /(fix|repair|error|bug|broken|update|change|tweak|edit|adjust)/.test(prompt)
  ) {
    return /fix|repair|error|bug|broken/.test(prompt)
      ? "error_repair"
      : "follow_up_edit";
  }
  return "landing_page";
}

export function promptAlreadySpecific(
  prompt: string,
  references?: readonly DesignReference[],
): boolean {
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
  const hasAudience =
    /(audience|customers|clients|founders|patients|homeowners|developers|designers|collectors)/i.test(
      trimmed,
    );
  const hasCta =
    /(cta|call to action|book|sign up|buy|contact|get started|waitlist)/i.test(
      trimmed,
    );

  if (references && references.length > 0 && uniqueSections.size >= 2) {
    return true;
  }
  if (uniqueSections.size >= 3 && hasStyleDirectives) return true;
  if (words.length >= 45 && uniqueSections.size >= 2) return true;
  if (words.length >= 65) return true;
  if (uniqueSections.size >= 2 && hasAudience && hasCta && hasStyleDirectives) {
    return true;
  }
  return false;
}

export const isPromptSufficientlyDetailed = promptAlreadySpecific;

function classifyError(errorMsg: string): GenerationErrorCode | null {
  if (
    /api key not valid/i.test(errorMsg) ||
    /invalid api key/i.test(errorMsg) ||
    /api_key_invalid/i.test(errorMsg) ||
    /credit card/i.test(errorMsg) ||
    /card on file/i.test(errorMsg) ||
    /not found for account/i.test(errorMsg)
  ) {
    return "CONFIG_ERROR";
  }
  if (errorMsg.includes("429") || /rate[- ]limit/i.test(errorMsg)) {
    return "RATE_LIMIT";
  }
  if (
    errorMsg.includes("timeout") ||
    /timed?[- ]?out/i.test(errorMsg) ||
    /AbortError/i.test(errorMsg)
  ) {
    return "TIMEOUT";
  }
  return null;
}

async function callTextModel(options: {
  readonly model: RegistryModel;
  readonly system?: string;
  readonly prompt?: string;
  readonly messages?: Array<{ role: "user" | "assistant"; content: string }>;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly temperature?: number;
}): Promise<{
  readonly text: string;
  readonly usage?: {
    readonly promptTokens?: number;
    readonly completionTokens?: number;
  };
}> {
  const languageModel = createLanguageModelFromRegistry(options.model);
  const common = {
    model: languageModel,
    system: options.system,
    temperature: options.temperature ?? 0.2,
    maxOutputTokens: options.maxOutputTokens,
    abortSignal: AbortSignal.timeout(options.timeoutMs),
  };

  const { text, usage } =
    options.prompt !== undefined
      ? await generateText({ ...common, prompt: options.prompt })
      : await generateText({ ...common, messages: options.messages ?? [] });

  return {
    text,
    usage: {
      promptTokens: usage?.inputTokens,
      completionTokens: usage?.outputTokens,
    },
  };
}

async function withFreeFallbacks<T>(
  task: GenerationTask,
  run: (selection: RouteSelection) => Promise<T>,
): Promise<T> {
  const tried: string[] = [];
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_PROVIDER_ATTEMPTS; attempt++) {
    const selection = selectModelForTask(task, { excludeIds: tried });
    if ("error" in selection) {
      throw Object.assign(new Error(selection.error), {
        code: selection.code,
      });
    }

    tried.push(selection.model.id);
    try {
      return await run(selection);
    } catch (error) {
      lastError = error;
      const msg =
        error instanceof Error ? error.message : "Provider call failed.";
      const code = classifyError(msg);
      if (
        code === "RATE_LIMIT" ||
        code === "TIMEOUT" ||
        code === "PROVIDER_ERROR" ||
        !code
      ) {
        markProviderCooldown(
          selection.model.provider,
          resolveRegistryModelId(selection.model),
        );
      }
      if (code === "CONFIG_ERROR") {
        // Skip this provider for the rest of the process
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All eligible free providers failed.");
}

/**
 * Builds a deterministic brief when the model is unavailable.
 */
export function buildDeterministicDesignBrief(prompt: string): DesignBrief {
  const recipe = inferRecipeFromPrompt(prompt);
  return {
    businessType: prompt.slice(0, 80),
    audience: "Primary customers described in the request",
    primaryGoal: "Convert visitors toward the main CTA",
    cta: "Get started",
    recipe,
    visualStyle: `Distinct ${recipe.replace("_", " ")} direction tailored to the business`,
    typography:
      "Expressive display + readable body; avoid default Inter/Roboto stacks in copy guidance",
    palette:
      "Business-specific semantic OKLCH tokens; no purple gradient defaults",
    imagery: "Relevant Unsplash photography matching the trade or product",
    sections: extractRequestedSectionsFromPrompt(prompt),
    interactions: "Subtle motion on CTA/hero only; respect reduced motion",
  };
}

export async function deriveDesignBrief(prompt: string): Promise<DesignBrief> {
  // If the prompt is already highly specific or too short for extraction,
  // infer the brief deterministically to save quota and eliminate latency.
  if (promptAlreadySpecific(prompt) || prompt.trim().split(/\s+/).length < 12) {
    return buildDeterministicDesignBrief(prompt);
  }

  try {
    return await withFreeFallbacks("design_brief", async (selection) => {
      const { text } = await callTextModel({
        model: selection.model,
        prompt: buildDesignBriefPrompt(prompt),
        timeoutMs: BRIEF_TIMEOUT_MS,
        maxOutputTokens: 700,
        temperature: 0.1,
      });
      return parseDesignBrief(text) ?? buildDeterministicDesignBrief(prompt);
    });
  } catch {
    return buildDeterministicDesignBrief(prompt);
  }
}

/**
 * Assesses whether a user's prompt needs clarification.
 */
export async function assessClarification(
  prompt: string,
  references?: readonly DesignReference[],
): Promise<ClarificationResult> {
  const trimmed = prompt.trim();
  if (promptAlreadySpecific(trimmed, references)) {
    return { needsClarification: false };
  }

  // Prefer deterministic skip when no free clarify provider is configured
  if (
    !isProviderConfigured("google") &&
    !isProviderConfigured("gateway") &&
    !isProviderConfigured("openrouter") &&
    !isProviderConfigured("nvidia")
  ) {
    return { needsClarification: false };
  }

  try {
    return await withFreeFallbacks("clarification", async (selection) => {
      const { text } = await callTextModel({
        model: selection.model,
        system: buildClarificationSystemPrompt(),
        prompt: trimmed,
        timeoutMs: CLARIFICATION_TIMEOUT_MS,
        maxOutputTokens: 800,
        temperature: 0.1,
      });
      return extractClarificationOutput(text);
    });
  } catch {
    return { needsClarification: false };
  }
}

/**
 * Primary code generation with automatic free-model routing.
 */
export async function generateWebsite(
  options: GenerateWebsiteOptions,
): Promise<AIGenerationResult> {
  const startTime = Date.now();
  const task = detectTask(options);
  let retries = 0;

  const designBrief =
    options.designBrief ??
    (task === "landing_page"
      ? await deriveDesignBrief(options.prompt)
      : (options.designBrief ?? null));

  const mode = task === "landing_page" ? "full" : "edit";
  const systemPrompt = buildGenerationSystemPrompt({
    existingFiles: options.existingFiles,
    references: options.references,
    designBrief,
    mode,
  });

  const userPrompt = composeBriefedUserPrompt(
    options.prompt,
    designBrief,
    options.clarificationAnswers,
  );

  // Keep conversation context bounded (last 4 turns max)
  const previous = (options.previousMessages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-4)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, 4000),
    }));

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const result = await withFreeFallbacks(task, async (selection) => {
      const modelId = resolveRegistryModelId(selection.model);
      try {
        const first = await callTextModel({
          model: selection.model,
          system: systemPrompt,
          messages: [...previous, { role: "user", content: userPrompt }],
          timeoutMs,
          maxOutputTokens: selection.model.maxOutputTokens,
          temperature: 0.2,
        });

        let structured;
        try {
          structured = extractStructuredOutput(first.text);
        } catch (parseErr) {
          retries += 1;
          // One bounded repair attempt on the same free model
          const repair = await callTextModel({
            model: selection.model,
            system: systemPrompt,
            messages: [
              { role: "user", content: userPrompt },
              { role: "assistant", content: first.text.slice(0, 12000) },
              {
                role: "user",
                content: `${JSON_REPAIR_INSTRUCTION}\nParse error: ${
                  parseErr instanceof Error ? parseErr.message : "invalid JSON"
                }`,
              },
            ],
            timeoutMs: Math.min(timeoutMs, 90_000),
            maxOutputTokens: selection.model.maxOutputTokens,
            temperature: 0,
          });
          structured = extractStructuredOutput(repair.text);
          return {
            structured,
            usage: repair.usage,
            selection,
            modelId,
          };
        }

        return {
          structured,
          usage: first.usage,
          selection,
          modelId,
        };
      } catch (error) {
        const msg =
          error instanceof Error
            ? redactSecrets(error.message)
            : "Provider error";
        const code = classifyError(msg) ?? "PROVIDER_ERROR";
        throw Object.assign(new Error(msg), {
          code,
          provider: selection.model.provider,
          model: modelId,
        });
      }
    });

    return {
      success: true,
      output: {
        ...result.structured,
        designBriefText:
          typeof designBrief === "object" && designBrief
            ? JSON.stringify(designBrief)
            : undefined,
      },
      provider: result.selection.model.provider,
      model: result.modelId,
      latencyMs: Date.now() - startTime,
      retries,
      routeReason: result.selection.reason,
      designBrief,
      usage: result.usage,
    };
  } catch (err) {
    const errorMsg =
      err instanceof Error ? redactSecrets(err.message) : "Unknown AI error.";
    const code: GenerationErrorCode =
      (err as { code?: GenerationErrorCode }).code ||
      classifyError(errorMsg) ||
      "PROVIDER_ERROR";

    if (code === "NO_FREE_PROVIDER") {
      return {
        success: false,
        code: "NO_FREE_PROVIDER",
        error: errorMsg,
        latencyMs: Date.now() - startTime,
        retries,
      };
    }

    return {
      success: false,
      code,
      error: errorMsg,
      provider: (err as { provider?: string }).provider,
      model: (err as { model?: string }).model,
      latencyMs: Date.now() - startTime,
      retries,
    };
  }
}
