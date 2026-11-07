import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { AIProvider } from "./types";

/**
 * Centralized, server-only AI provider layer for Foundry.
 * Coordinates Google Gemini, OpenRouter, and NVIDIA NIM using the Vercel AI SDK.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2, and Prompt §4.
 */

export const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_NVIDIA_MODEL = "z-ai/glm-5.3-flash";
export const DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_OPENROUTER_MODEL = "openrouter/free";

export type ResolvedProviderConfig = {
  readonly provider: AIProvider;
  readonly modelId: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
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

/**
 * Resolves the active AI provider based on environment configuration or override.
 */
export function resolveActiveProvider(override?: AIProvider): AIProvider {
  if (override) return override;

  const envProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (
    envProvider === "nvidia" ||
    envProvider === "google" ||
    envProvider === "openrouter"
  ) {
    return envProvider;
  }

  // Smart heuristic based on configured keys
  if (process.env.NVIDIA_API_KEY?.trim()) return "nvidia";
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) return "google";
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";

  return "nvidia";
}

/**
 * Checks if a given provider has its required credentials configured in the environment.
 */
export function isProviderConfigured(provider: AIProvider): boolean {
  switch (provider) {
    case "nvidia":
      return Boolean(process.env.NVIDIA_API_KEY?.trim());
    case "google":
      return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
    case "openrouter":
      return Boolean(process.env.OPENROUTER_API_KEY?.trim());
    default:
      return false;
  }
}

/**
 * Returns configuration metadata for the selected provider.
 */
export function getProviderConfig(
  providerInput?: AIProvider,
  modelOverride?: string,
): ResolvedProviderConfig {
  const provider = resolveActiveProvider(providerInput);

  switch (provider) {
    case "nvidia": {
      const apiKey = process.env.NVIDIA_API_KEY?.trim() || "";
      const baseUrl =
        process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_NVIDIA_BASE_URL;
      const modelId =
        modelOverride ||
        process.env.NVIDIA_MODEL?.trim() ||
        DEFAULT_NVIDIA_MODEL;
      return { provider, modelId, apiKey, baseUrl };
    }
    case "google": {
      const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || "";
      const modelId =
        modelOverride ||
        process.env.GOOGLE_MODEL?.trim() ||
        DEFAULT_GOOGLE_MODEL;
      return { provider, modelId, apiKey };
    }
    case "openrouter": {
      const apiKey = process.env.OPENROUTER_API_KEY?.trim() || "";
      const modelId =
        modelOverride ||
        process.env.OPENROUTER_MODEL?.trim() ||
        DEFAULT_OPENROUTER_MODEL;
      return { provider, modelId, apiKey };
    }
  }
}

/**
 * Initializes and returns a Vercel AI SDK LanguageModel instance for the requested provider.
 */
export function createLanguageModel(
  providerInput?: AIProvider,
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
      return client(config.modelId);
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
  }
}
