import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MODEL_REGISTRY,
  isFreeEligible,
  listModelsForTask,
  getModelById,
} from "@/lib/ai/registry";
import {
  selectModelForTask,
  markProviderCooldown,
  clearProviderCooldown,
} from "@/lib/ai/router";
import { redactSecrets } from "@/lib/ai/providers";
import { runProviderHealthChecks } from "@/lib/ai/health";

describe("Free Model Registry & Automatic Routing", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Model Registry Free-Only Integrity", () => {
    it("ensures every registry model has verified free eligibility", () => {
      expect(MODEL_REGISTRY.length).toBeGreaterThan(0);
      for (const model of MODEL_REGISTRY) {
        expect(isFreeEligible(model)).toBe(true);
        expect(
          model.freeEligibility === "verified_zero_price" ||
            model.freeEligibility === "provider_free_tier",
        ).toBe(true);
      }
    });

    it("verifies required modalities and token limits for each model", () => {
      for (const model of MODEL_REGISTRY) {
        expect(model.maxOutputTokens).toBeGreaterThanOrEqual(2048);
        expect(model.capabilities.text).toBe(true);
        expect(model.tasks.length).toBeGreaterThan(0);
        expect(model.verifiedAt).toBeDefined();
      }
    });

    it("retrieves models by task category", () => {
      const clarifyModels = listModelsForTask("clarification");
      expect(clarifyModels.length).toBeGreaterThan(0);

      const landingModels = listModelsForTask("landing_page");
      expect(landingModels.length).toBeGreaterThan(0);
      for (const m of landingModels) {
        expect(m.capabilities.coding).toBe(true);
      }
    });

    it("finds specific models by ID", () => {
      const glm = getModelById("nvidia-glm-landing");
      expect(glm).toBeDefined();
      expect(glm?.provider).toBe("nvidia");

      const gemini = getModelById("google-flash-clarify");
      expect(gemini).toBeDefined();
      expect(gemini?.provider).toBe("google");
    });
  });

  describe("Automatic Task-Based Router", () => {
    it("returns NO_FREE_PROVIDER error when no provider keys are configured", () => {
      delete process.env.NVIDIA_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.AI_GATEWAY_API_KEY;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env["Account ID"];
      delete process.env["Your API Token"];

      const result = selectModelForTask("landing_page");
      expect("code" in result).toBe(true);
      if ("code" in result) {
        expect(result.code).toBe("NO_FREE_PROVIDER");
        expect(result.error).toContain("No eligible free AI providers");
      }
    });

    it("selects Google for landing page when Google key is present as highest priority", () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
      process.env.NVIDIA_API_KEY = "nvapi-test-key";
      process.env.OPENROUTER_API_KEY = "sk-or-test-key";

      const result = selectModelForTask("landing_page");
      expect("model" in result).toBe(true);
      if ("model" in result) {
        expect(result.model.provider).toBe("google");
        expect(result.model.capabilities.coding).toBe(true);
      }
    });

    it("selects NVIDIA for landing page when NVIDIA key is present", () => {
      process.env.NVIDIA_API_KEY = "nvapi-test-key";
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      const result = selectModelForTask("landing_page");
      expect("model" in result).toBe(true);
      if ("model" in result) {
        expect(result.model.provider).toBe("nvidia");
        expect(result.model.capabilities.coding).toBe(true);
      }
    });

    it("respects provider cooldown to avoid retry storms", () => {
      process.env.NVIDIA_API_KEY = "nvapi-test-key";
      process.env.OPENROUTER_API_KEY = "sk-or-test-key";

      const glm = getModelById("nvidia-glm-landing");
      expect(glm).toBeDefined();
      if (!glm) return;

      // Mark NVIDIA model in cooldown
      markProviderCooldown("nvidia", glm.modelId, 60_000);

      const result = selectModelForTask("landing_page");
      expect("model" in result).toBe(true);
      if ("model" in result) {
        // Must route away from cooling-down NVIDIA to another available free provider
        expect(result.model.provider).not.toBe("nvidia");
      }

      // Clear cooldown
      clearProviderCooldown("nvidia", glm.modelId);
    });

    it("supports exclusion of previously failed models in fallback chains", () => {
      process.env.NVIDIA_API_KEY = "nvapi-test-key";
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
      process.env.OPENROUTER_API_KEY = "sk-or-test-key";

      const first = selectModelForTask("clarification");
      expect("model" in first).toBe(true);
      if (!("model" in first)) return;

      const second = selectModelForTask("clarification", {
        excludeIds: [first.model.id],
      });
      expect("model" in second).toBe(true);
      if ("model" in second) {
        expect(second.model.id).not.toBe(first.model.id);
      }
    });
  });

  describe("Provider Health Checks & Security", () => {
    it("never reveals secrets in health check error strings", async () => {
      delete process.env.NVIDIA_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.AI_GATEWAY_API_KEY;

      const results = await runProviderHealthChecks();
      expect(results.length).toBeGreaterThanOrEqual(4);

      for (const res of results) {
        if (res.error) {
          expect(res.error).not.toContain("nvapi-");
          expect(res.error).not.toContain("AIzaSy");
          expect(res.error).not.toContain("sk-or-");
        }
      }
    });

    it("redacts Cloudflare, Google, NVIDIA, and OpenRouter tokens", () => {
      const msg =
        "Error calling nvapi-12345678 with token sk-or-v1-abcdef and Bearer secret-auth-token";
      const redacted = redactSecrets(msg);
      expect(redacted).not.toContain("nvapi-12345678");
      expect(redacted).not.toContain("sk-or-v1-abcdef");
      expect(redacted).not.toContain("secret-auth-token");
      expect(redacted).toContain("[REDACTED_NVIDIA_KEY]");
      expect(redacted).toContain("[REDACTED_OPENROUTER_KEY]");
      expect(redacted).toContain("Bearer [REDACTED_TOKEN]");
    });
  });
});
