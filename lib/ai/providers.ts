import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGateway, type LanguageModel } from "ai";
import type { AIProviderId, RegistryModel } from "./registry";
import { resolveRegistryModelId } from "./registry";

/**
 * Centralized, server-only AI provider layer for Foundry.
 * All inference goes through the Vercel AI SDK (no hand-rolled provider HTTP clients).
 */

export const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_NVIDIA_MODEL = "z-ai/glm-5.3-flash";
export const DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3.5-lightning:free";
export const DEFAULT_GATEWAY_MODEL = "nvidia/nemotron-3.5-lightning-free";
export const DEFAULT_CLOUDFLARE_MODEL = "@cf/meta/llama-3.2-3b-instruct";

/** @deprecated Prefer AIProviderId from registry. Kept for existing imports. */
export type AIProvider = AIProviderId;

export type ResolvedProviderConfig = {
  readonly provider: AIProviderId;
  readonly modelId: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly accountId?: string;
};

/**
 * Redacts secrets, tokens, and credentials from error strings or diagnostics.
 */
export function redactSecrets(text: string): string {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/nvapi-[a-zA-Z0-9_-]+/g, "[REDACTED_NVIDIA_KEY]")
    .replace(/AIzaSy[a-zA-Z0-9_-]+/g, "[REDACTED_GOOGLE_KEY]")
    .replace(/sk-or-[a-zA-Z0-9_-]+/g, "[REDACTED_OPENROUTER_KEY]")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED_KEY]")
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED_TOKEN]");
}

function getCloudflareCredentials(): { accountId: string; apiToken: string } {
  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ||
    process.env["Account ID"]?.trim() ||
    "";
  const apiToken =
    process.env.CLOUDFLARE_API_TOKEN?.trim() ||
    process.env["Your API Token"]?.trim() ||
    "";
  return { accountId, apiToken };
}

export function isProviderConfigured(provider: AIProviderId): boolean {
  switch (provider) {
    case "nvidia":
      return Boolean(process.env.NVIDIA_API_KEY?.trim());
    case "google":
      return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
    case "openrouter":
      return Boolean(process.env.OPENROUTER_API_KEY?.trim());
    case "gateway":
      return Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
    case "cloudflare": {
      const { accountId, apiToken } = getCloudflareCredentials();
      return Boolean(accountId && apiToken);
    }
    default:
      return false;
  }
}

/**
 * Resolves legacy AI_PROVIDER env for diagnostics only.
 * Generation routing no longer uses a user-selected provider.
 */
export function resolveActiveProvider(override?: AIProviderId): AIProviderId {
  if (override) return override;

  const envProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (
    envProvider === "nvidia" ||
    envProvider === "google" ||
    envProvider === "openrouter" ||
    envProvider === "gateway" ||
    envProvider === "cloudflare"
  ) {
    return envProvider;
  }

  if (process.env.NVIDIA_API_KEY?.trim()) return "nvidia";
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) return "google";
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return "gateway";
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  return "nvidia";
}

export function getProviderConfig(
  providerInput?: AIProviderId,
  modelOverride?: string,
): ResolvedProviderConfig {
  const provider = resolveActiveProvider(providerInput);

  switch (provider) {
    case "nvidia": {
      return {
        provider,
        apiKey: process.env.NVIDIA_API_KEY?.trim() || "",
        baseUrl: process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_NVIDIA_BASE_URL,
        modelId:
          modelOverride ||
          process.env.NVIDIA_MODEL?.trim() ||
          DEFAULT_NVIDIA_MODEL,
      };
    }
    case "google": {
      return {
        provider,
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || "",
        modelId:
          modelOverride ||
          process.env.GOOGLE_MODEL?.trim() ||
          DEFAULT_GOOGLE_MODEL,
      };
    }
    case "openrouter": {
      return {
        provider,
        apiKey: process.env.OPENROUTER_API_KEY?.trim() || "",
        modelId:
          modelOverride ||
          process.env.OPENROUTER_MODEL?.trim() ||
          DEFAULT_OPENROUTER_MODEL,
      };
    }
    case "gateway": {
      return {
        provider,
        apiKey: process.env.AI_GATEWAY_API_KEY?.trim() || "",
        modelId:
          modelOverride ||
          process.env.AI_GATEWAY_MODEL?.trim() ||
          DEFAULT_GATEWAY_MODEL,
      };
    }
    case "cloudflare": {
      const { accountId, apiToken } = getCloudflareCredentials();
      return {
        provider,
        apiKey: apiToken,
        accountId,
        modelId:
          modelOverride ||
          process.env.CLOUDFLARE_MODEL?.trim() ||
          DEFAULT_CLOUDFLARE_MODEL,
      };
    }
  }
}

export function getCloudflareBlocker(): string | null {
  const { accountId, apiToken } = getCloudflareCredentials();
  if (!accountId || !apiToken) {
    return "Cloudflare Workers AI is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (or Account ID and Your API Token in .env.local).";
  }
  return null;
}

/**
 * Creates a LanguageModel for a registry entry via Vercel AI SDK only.
 */
export function createLanguageModelFromRegistry(
  model: RegistryModel,
): LanguageModel {
  const modelId = resolveRegistryModelId(model);
  return createLanguageModel(model.provider, modelId);
}

/**
 * Initializes and returns a Vercel AI SDK LanguageModel instance.
 */
export function createLanguageModel(
  providerInput?: AIProviderId,
  modelOverride?: string,
): LanguageModel {
  const config = getProviderConfig(providerInput, modelOverride);

  if (!config.apiKey) {
    throw new Error(
      `API key for ${config.provider.toUpperCase()} is not configured in the server environment.`,
    );
  }

  switch (config.provider) {
    case "nvidia": {
      const client = createOpenAICompatible({
        name: "nvidia",
        baseURL: config.baseUrl || DEFAULT_NVIDIA_BASE_URL,
        apiKey: config.apiKey,
      });
      return client.chatModel(config.modelId);
    }
    case "google": {
      const client = createGoogleGenerativeAI({
        apiKey: config.apiKey,
      });
      return client(config.modelId);
    }
    case "openrouter": {
      const client = createOpenRouter({
        apiKey: config.apiKey,
      });
      return client(config.modelId);
    }
    case "gateway": {
      const gateway = createGateway({
        apiKey: config.apiKey,
      });
      return gateway(config.modelId);
    }
    case "cloudflare": {
      if (!config.accountId || !config.apiKey) {
        throw new Error(
          getCloudflareBlocker() ||
            "Cloudflare Workers AI credentials missing (CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required).",
        );
      }
      const client = createOpenAICompatible({
        name: "cloudflare",
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1`,
        apiKey: config.apiKey,
      });
      return client.chatModel(config.modelId);
    }
  }
}
