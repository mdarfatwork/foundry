/**
 * Server-only free-model registry for Foundry.
 * Only models with verified free eligibility are routable.
 * Unknown pricing is treated as ineligible (never silently paid).
 */

export type AIProviderId =
  "nvidia" | "google" | "openrouter" | "gateway" | "cloudflare";

export type ModelTask =
  | "clarification"
  | "design_brief"
  | "landing_page"
  | "follow_up_edit"
  | "error_repair";

export type FreeEligibility =
  "verified_zero_price" | "provider_free_tier" | "ineligible";

export type ModelCapabilities = {
  readonly text: boolean;
  readonly structuredNative: boolean;
  readonly coding: boolean;
  readonly vision: boolean;
};

export type RegistryModel = {
  readonly id: string;
  readonly provider: AIProviderId;
  readonly modelId: string;
  readonly displayName: string;
  readonly freeEligibility: FreeEligibility;
  readonly tasks: readonly ModelTask[];
  readonly capabilities: ModelCapabilities;
  readonly maxOutputTokens: number;
  readonly notes: string;
  readonly envModelKey?: string;
  readonly verifiedAt: string;
};

/**
 * Verified catalog snapshot (maintenance-time).
 * Do not fetch the full remote catalog on every user request.
 */
export const MODEL_REGISTRY: readonly RegistryModel[] = [
  {
    id: "google-flash-clarify",
    provider: "google",
    modelId: "gemini-3.5-flash-lite",
    displayName: "Gemini 3.5 Flash Lite (AI Studio free tier)",
    freeEligibility: "provider_free_tier",
    tasks: [
      "clarification",
      "design_brief",
      "landing_page",
      "follow_up_edit",
      "error_repair",
    ],
    capabilities: {
      text: true,
      structuredNative: true,
      coding: true,
      vision: true,
    },
    maxOutputTokens: 8192,
    notes:
      "Google AI Studio free-tier quota. Verified active free model on Google AI Studio.",
    envModelKey: "GOOGLE_MODEL",
    verifiedAt: "2026-11-10",
  },
  {
    id: "nvidia-glm-landing",
    provider: "nvidia",
    modelId: "z-ai/glm-5.3-flash",
    displayName: "NVIDIA GLM 5.3 Flash",
    freeEligibility: "provider_free_tier",
    tasks: ["landing_page", "follow_up_edit", "error_repair"],
    capabilities: {
      text: true,
      structuredNative: false,
      coding: true,
      vision: false,
    },
    maxOutputTokens: 8192,
    notes:
      "NVIDIA NIM integrate.api free credits. JSON via text + Zod repair only.",
    envModelKey: "NVIDIA_MODEL",
    verifiedAt: "2026-11-09",
  },
  {
    id: "gateway-nemotron-free",
    provider: "gateway",
    modelId: "nvidia/nemotron-3.5-lightning-free",
    displayName: "Nemotron 3.5 Lightning Free (AI Gateway)",
    freeEligibility: "verified_zero_price",
    tasks: [
      "clarification",
      "design_brief",
      "landing_page",
      "follow_up_edit",
      "error_repair",
    ],
    capabilities: {
      text: true,
      structuredNative: false,
      coding: true,
      vision: false,
    },
    maxOutputTokens: 8192,
    notes:
      "Catalog verified input/output pricing = 0 on ai-gateway.vercel.sh/v1/models.",
    envModelKey: "AI_GATEWAY_MODEL",
    verifiedAt: "2026-11-09",
  },
  {
    id: "openrouter-free-router",
    provider: "openrouter",
    modelId: "openrouter/free",
    displayName: "OpenRouter Free Router",
    freeEligibility: "verified_zero_price",
    tasks: ["clarification", "design_brief", "follow_up_edit"],
    capabilities: {
      text: true,
      structuredNative: false,
      coding: false,
      vision: false,
    },
    maxOutputTokens: 4096,
    notes: "OpenRouter free auto-router. Daily quota limited.",
    envModelKey: "OPENROUTER_MODEL",
    verifiedAt: "2026-11-09",
  },
  {
    id: "openrouter-north-mini-code",
    provider: "openrouter",
    modelId: "cohere/north-mini-code:free",
    displayName: "Cohere North Mini Code (OpenRouter free)",
    freeEligibility: "verified_zero_price",
    tasks: ["landing_page", "follow_up_edit", "error_repair"],
    capabilities: {
      text: true,
      structuredNative: false,
      coding: true,
      vision: false,
    },
    maxOutputTokens: 8192,
    notes: "Listed as free coding model on OpenRouter free collection.",
    verifiedAt: "2026-11-09",
  },
  {
    id: "openrouter-nemotron-lightning",
    provider: "openrouter",
    modelId: "nvidia/nemotron-3.5-lightning:free",
    displayName: "Nemotron 3.5 Lightning (OpenRouter free)",
    freeEligibility: "verified_zero_price",
    tasks: ["landing_page", "follow_up_edit", "error_repair", "clarification"],
    capabilities: {
      text: true,
      structuredNative: false,
      coding: true,
      vision: false,
    },
    maxOutputTokens: 8192,
    notes: "OpenRouter :free suffix, pricing prompt/completion = 0.",
    verifiedAt: "2026-11-09",
  },
  {
    id: "cloudflare-llama-instruct",
    provider: "cloudflare",
    modelId: "@cf/meta/llama-3.2-3b-instruct",
    displayName: "Llama 3.2 3B Instruct (Workers AI)",
    freeEligibility: "provider_free_tier",
    tasks: ["clarification", "design_brief", "follow_up_edit"],
    capabilities: {
      text: true,
      structuredNative: false,
      coding: true,
      vision: false,
    },
    maxOutputTokens: 4096,
    notes:
      "Cloudflare Workers AI free tier via OpenAI-compatible endpoint. Non-deprecated Llama 3.2.",
    envModelKey: "CLOUDFLARE_MODEL",
    verifiedAt: "2026-11-09",
  },
] as const;

export function isFreeEligible(model: RegistryModel): boolean {
  return (
    model.freeEligibility === "verified_zero_price" ||
    model.freeEligibility === "provider_free_tier"
  );
}

export function resolveRegistryModelId(model: RegistryModel): string {
  if (model.envModelKey) {
    const override = process.env[model.envModelKey]?.trim();
    if (override) return override;
  }
  return model.modelId;
}

export function listModelsForTask(task: ModelTask): readonly RegistryModel[] {
  return MODEL_REGISTRY.filter(
    (model) => isFreeEligible(model) && model.tasks.includes(task),
  );
}

export function getModelById(id: string): RegistryModel | undefined {
  return MODEL_REGISTRY.find((model) => model.id === id);
}
