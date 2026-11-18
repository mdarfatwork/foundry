import { generateText } from "ai";
import {
  createLanguageModel,
  isProviderConfigured,
  redactSecrets,
  getCloudflareBlocker,
} from "./providers";
import type { AIProviderId } from "./registry";
import {
  DEFAULT_CLOUDFLARE_MODEL,
  DEFAULT_GATEWAY_MODEL,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_NVIDIA_MODEL,
  DEFAULT_OPENROUTER_MODEL,
} from "./providers";

/**
 * Minimal provider health probes. No expensive generation. Secrets never returned.
 */

export type ProviderHealthResult = {
  readonly provider: AIProviderId;
  readonly configured: boolean;
  readonly ok: boolean;
  readonly modelId?: string;
  readonly latencyMs?: number;
  readonly error?: string;
  readonly blocker?: string;
};

const HEALTH_TIMEOUT_MS = 20_000;

async function probe(
  provider: AIProviderId,
  modelId: string,
): Promise<ProviderHealthResult> {
  if (!isProviderConfigured(provider)) {
    return {
      provider,
      configured: false,
      ok: false,
      modelId,
      error: "Credentials not configured.",
      blocker:
        provider === "cloudflare"
          ? (getCloudflareBlocker() ?? undefined)
          : undefined,
    };
  }

  const started = Date.now();
  try {
    const model = createLanguageModel(provider, modelId);
    const { text } = await generateText({
      model,
      prompt: "Reply with exactly: pong",
      maxOutputTokens: 250,
      temperature: 0,
      abortSignal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return {
      provider,
      configured: true,
      ok: /pong/i.test(text) || text.trim().length > 0,
      modelId,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      provider,
      configured: true,
      ok: false,
      modelId,
      latencyMs: Date.now() - started,
      error: redactSecrets(
        error instanceof Error ? error.message : "Health check failed.",
      ),
    };
  }
}

export async function runProviderHealthChecks(): Promise<
  readonly ProviderHealthResult[]
> {
  const checks: Array<Promise<ProviderHealthResult>> = [
    probe("nvidia", process.env.NVIDIA_MODEL?.trim() || DEFAULT_NVIDIA_MODEL),
    probe("google", process.env.GOOGLE_MODEL?.trim() || DEFAULT_GOOGLE_MODEL),
    probe(
      "openrouter",
      process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL,
    ),
    probe(
      "gateway",
      process.env.AI_GATEWAY_MODEL?.trim() || DEFAULT_GATEWAY_MODEL,
    ),
    probe(
      "cloudflare",
      process.env.CLOUDFLARE_MODEL?.trim() || DEFAULT_CLOUDFLARE_MODEL,
    ),
  ];

  return Promise.all(checks);
}
