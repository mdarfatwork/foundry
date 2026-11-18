import type { AIProviderId, ModelTask, RegistryModel } from "./registry";
import { listModelsForTask } from "./registry";
import { isProviderConfigured } from "./providers";

/**
 * Automatic free-model routing for Foundry generation tasks.
 * Never selects paid models. Never silently falls back to paid inference.
 */

export type RouteSelection = {
  readonly model: RegistryModel;
  readonly reason: string;
};

export type RouteFailure = {
  readonly error: string;
  readonly code: "NO_FREE_PROVIDER";
  readonly attemptedProviders: readonly AIProviderId[];
};

const TASK_PROVIDER_PRIORITY: Record<ModelTask, readonly AIProviderId[]> = {
  clarification: ["google", "openrouter", "gateway", "nvidia", "cloudflare"],
  design_brief: ["google", "openrouter", "gateway", "nvidia", "cloudflare"],
  landing_page: ["google", "openrouter", "gateway", "nvidia"],
  follow_up_edit: ["google", "openrouter", "gateway", "nvidia"],
  error_repair: ["google", "openrouter", "gateway", "nvidia"],
};

/** In-memory cooldown map to avoid retry storms against exhausted free quotas. */
const providerCooldowns = new Map<string, number>();

const COOLDOWN_MS = 60_000;

export function markProviderCooldown(
  provider: AIProviderId,
  modelId: string,
  ms = COOLDOWN_MS,
): void {
  providerCooldowns.set(`${provider}:${modelId}`, Date.now() + ms);
}

export function clearProviderCooldown(
  provider: AIProviderId,
  modelId: string,
): void {
  providerCooldowns.delete(`${provider}:${modelId}`);
}

function isCoolingDown(provider: AIProviderId, modelId: string): boolean {
  const until = providerCooldowns.get(`${provider}:${modelId}`);
  if (!until) return false;
  if (Date.now() >= until) {
    providerCooldowns.delete(`${provider}:${modelId}`);
    return false;
  }
  return true;
}

function scoreModel(model: RegistryModel, task: ModelTask): number {
  let score = 0;
  const priorityList = TASK_PROVIDER_PRIORITY[task];
  const priorityIndex = priorityList.indexOf(model.provider);
  if (priorityIndex >= 0) {
    score += (priorityList.length - priorityIndex) * 25;
  }
  if (model.freeEligibility === "verified_zero_price") score += 10;
  if (model.freeEligibility === "provider_free_tier") score += 10;
  if (task === "landing_page" || task === "error_repair") {
    if (model.capabilities.coding) score += 15;
  }
  if (task === "clarification" || task === "design_brief") {
    if (model.capabilities.structuredNative) score += 8;
  }
  return score;
}

/**
 * Selects the best currently configured free model for a task.
 */
export function selectModelForTask(
  task: ModelTask,
  options?: {
    readonly excludeIds?: readonly string[];
  },
): RouteSelection | RouteFailure {
  const candidates = listModelsForTask(task)
    .filter((model) => !options?.excludeIds?.includes(model.id))
    .filter((model) => isProviderConfigured(model.provider))
    .filter((model) => !isCoolingDown(model.provider, model.modelId))
    .map((model) => ({ model, score: scoreModel(model, task) }))
    .toSorted((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    const attempted = listModelsForTask(task).map((m) => m.provider);
    return {
      code: "NO_FREE_PROVIDER",
      attemptedProviders: [...new Set(attempted)],
      error:
        "No eligible free AI providers are available right now. Configure a free provider key or wait for quota cooldown, then retry. Foundry will not use paid models automatically.",
    };
  }

  const selected = candidates[0].model;
  return {
    model: selected,
    reason: `task=${task}; provider=${selected.provider}; model=${selected.modelId}; eligibility=${selected.freeEligibility}`,
  };
}

/**
 * Returns ordered fallback models after a failure, excluding already tried entries.
 */
export function listFallbackModels(
  task: ModelTask,
  triedRegistryIds: readonly string[],
): readonly RegistryModel[] {
  const next = selectModelForTask(task, { excludeIds: triedRegistryIds });
  if ("error" in next) return [];
  return [next.model];
}
