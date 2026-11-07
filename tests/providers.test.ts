import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  redactSecrets,
  resolveActiveProvider,
  isProviderConfigured,
  getProviderConfig,
  createLanguageModel,
  DEFAULT_NVIDIA_MODEL,
  DEFAULT_GOOGLE_MODEL,
  DEFAULT_OPENROUTER_MODEL,
} from "@/lib/ai/providers";

describe("AI Providers Architecture", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("redactSecrets", () => {
    it("redacts NVIDIA, Google, and OpenRouter API keys from error strings", () => {
      const sensitive =
        "Failed to call API with key nvapi-abcdef123456 and token sk-or-v1-987654321 and Google AIzaSyDUMMYKEY123456";
      const redacted = redactSecrets(sensitive);

      expect(redacted).not.toContain("nvapi-abcdef123456");
      expect(redacted).not.toContain("sk-or-v1-987654321");
      expect(redacted).not.toContain("AIzaSyDUMMYKEY123456");
      expect(redacted).toContain("[REDACTED_NVIDIA_KEY]");
      expect(redacted).toContain("[REDACTED_OPENROUTER_KEY]");
      expect(redacted).toContain("[REDACTED_GOOGLE_KEY]");
    });

    it("redacts Bearer tokens and generic sk- keys", () => {
      const text =
        "Authorization: Bearer secret_jwt_token_12345 sk-proj-abcdef";
      const redacted = redactSecrets(text);

      expect(redacted).toContain("Bearer [REDACTED_TOKEN]");
      expect(redacted).toContain("[REDACTED_KEY]");
    });
  });

  describe("resolveActiveProvider", () => {
    it("respects explicit provider overrides", () => {
      expect(resolveActiveProvider("google")).toBe("google");
      expect(resolveActiveProvider("openrouter")).toBe("openrouter");
      expect(resolveActiveProvider("nvidia")).toBe("nvidia");
    });

    it("reads from AI_PROVIDER environment variable", () => {
      process.env.AI_PROVIDER = "google";
      expect(resolveActiveProvider()).toBe("google");

      process.env.AI_PROVIDER = "openrouter";
      expect(resolveActiveProvider()).toBe("openrouter");
    });

    it("falls back based on available keys", () => {
      delete process.env.AI_PROVIDER;
      delete process.env.NVIDIA_API_KEY;
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
      expect(resolveActiveProvider()).toBe("google");

      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      process.env.OPENROUTER_API_KEY = "test-or-key";
      expect(resolveActiveProvider()).toBe("openrouter");
    });
  });

  describe("getProviderConfig", () => {
    it("returns validated default models for all providers", () => {
      const nvidiaCfg = getProviderConfig("nvidia");
      expect(nvidiaCfg.modelId).toBe(DEFAULT_NVIDIA_MODEL);
      expect(nvidiaCfg.baseUrl).toBe("https://integrate.api.nvidia.com/v1");

      const googleCfg = getProviderConfig("google");
      expect(googleCfg.modelId).toBe(DEFAULT_GOOGLE_MODEL);

      const orCfg = getProviderConfig("openrouter");
      expect(orCfg.modelId).toBe(DEFAULT_OPENROUTER_MODEL);
    });

    it("allows custom model overrides", () => {
      const cfg = getProviderConfig("google", "gemini-2.5-flash");
      expect(cfg.modelId).toBe("gemini-2.5-flash");
    });
  });

  describe("isProviderConfigured", () => {
    it("accurately detects presence of credentials", () => {
      delete process.env.NVIDIA_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      expect(isProviderConfigured("nvidia")).toBe(false);
      expect(isProviderConfigured("google")).toBe(false);
      expect(isProviderConfigured("openrouter")).toBe(false);

      process.env.NVIDIA_API_KEY = "nvapi-valid";
      expect(isProviderConfigured("nvidia")).toBe(true);
    });
  });

  describe("createLanguageModel", () => {
    it("throws clear error when API key is missing", () => {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      expect(() => createLanguageModel("google")).toThrowError(
        /API key for GOOGLE is not configured/,
      );
    });
  });
});
