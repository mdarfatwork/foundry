import { describe, it, expect } from "vitest";
import {
  inferRecipeFromPrompt,
  buildGenerationSystemPrompt,
  DESIGN_RECIPES,
} from "@/lib/ai/prompts";
import { parseDesignBrief } from "@/lib/ai/parse";
import { isPromptSufficientlyDetailed } from "@/lib/ai/unified";

describe("Adaptive Clarification & Anti-Slop Design Recipes", () => {
  describe("isPromptSufficientlyDetailed", () => {
    it("recognizes vague prompts as needing clarification", () => {
      expect(isPromptSufficientlyDetailed("make a website")).toBe(false);
      expect(
        isPromptSufficientlyDetailed(
          "create a modern landing page for my startup",
        ),
      ).toBe(false);
      expect(isPromptSufficientlyDetailed("landing page for coffee shop")).toBe(
        false,
      );
    });

    it("recognizes rich, highly detailed prompts as sufficient to skip clarification", () => {
      const detailed = `Build a high-end luxury watch showcase landing page for collectors.
        Include a full-bleed hero with dark charcoal palette, gold accents, an editorial featured timepieces section,
        a technical specs grid, craftsmanship heritage timeline, and an exclusive VIP waitlist CTA with contact form.
        Typography: serif display headlines and clean monospace metadata labels. No generic cards.`;
      expect(isPromptSufficientlyDetailed(detailed)).toBe(true);
    });
  });

  describe("Design Recipes & Inference", () => {
    it("correctly infers SaaS recipe for software and platform prompts", () => {
      expect(
        inferRecipeFromPrompt("developer API observability platform"),
      ).toBe("saas");
      expect(inferRecipeFromPrompt("B2B enterprise CRM dashboard")).toBe(
        "saas",
      );
    });

    it("infers creative portfolio recipe for studio/design/photography prompts", () => {
      expect(
        inferRecipeFromPrompt(
          "photographer portfolio showcasing architectural work",
        ),
      ).toBe("creative_portfolio");
      expect(inferRecipeFromPrompt("creative design studio showcase")).toBe(
        "creative_portfolio",
      );
    });

    it("infers local business recipe for physical service trades", () => {
      expect(
        inferRecipeFromPrompt("artisan sourdough bakery and cafe menu"),
      ).toBe("local_business");
      expect(
        inferRecipeFromPrompt("boutique dental clinic in downtown Seattle"),
      ).toBe("local_business");
    });

    it("infers premium product recipe for luxury goods", () => {
      expect(
        inferRecipeFromPrompt("luxury mechanical watch brand flagship page"),
      ).toBe("premium_product");
    });

    it("infers editorial recipe for journals and publication sites", () => {
      expect(
        inferRecipeFromPrompt(
          "weekly architecture journal and editorial magazine",
        ),
      ).toBe("editorial");
    });

    it("ensures each recipe defines layout hierarchy and distinct token palette", () => {
      const recipes = Object.keys(DESIGN_RECIPES) as Array<
        keyof typeof DESIGN_RECIPES
      >;
      expect(recipes.length).toBe(5);

      for (const key of recipes) {
        const recipe = DESIGN_RECIPES[key];
        expect(recipe.layout).toBeDefined();
        expect(recipe.tokens).toBeDefined();
        expect(recipe.tokens).not.toContain("purple gradient");
      }
    });
  });

  describe("Design Brief Parsing & Extraction", () => {
    it("validates and parses complete design brief JSON", () => {
      const validJson = JSON.stringify({
        businessType: "Specialty Coffee Roastery",
        audience: "Coffee aficionados and cafe owners",
        primaryGoal: "Drive wholesale inquiries and direct bean subscriptions",
        cta: "Order Sample Kit",
        recipe: "local_business",
        visualStyle:
          "Warm earthen tones, generous whitespace, industrial craft",
        typography: "Grounded serif headers with legible grotesque body",
        palette:
          "Espresso brown #2B1810, cream paper #F7F4EE, terracotta accent",
        imagery:
          "Close-up coffee beans, vintage roasting drum, pour-over ritual",
        sections: [
          "hero",
          "roasting_philosophy",
          "origin_coffees",
          "cta",
          "footer",
        ],
        interactions:
          "Subtle hover lifts on coffee cards, sticky subscription bar",
      });

      const parsed = parseDesignBrief(validJson);
      expect(parsed).toBeDefined();
      expect(parsed?.businessType).toBe("Specialty Coffee Roastery");
      expect(parsed?.recipe).toBe("local_business");
      expect(parsed?.sections).toHaveLength(5);
    });

    it("recovers design brief from markdown code fences", () => {
      const fenced = `Here is your design brief:
\`\`\`json
{
  "businessType": "Cloud Security",
  "audience": "DevOps Engineers",
  "primaryGoal": "Book security audit demo",
  "cta": "Schedule Security Scan",
  "recipe": "saas",
  "visualStyle": "Dark technical canvas with crisp green status indicators",
  "typography": "Geist Mono for stats, clean sans for narrative",
  "palette": "Slate 950, Emerald 500 accent",
  "imagery": "Terminal snippets, architecture diagrams",
  "sections": ["hero", "metrics", "architecture", "pricing", "cta", "footer"],
  "interactions": "Interactive security score slider"
}
\`\`\``;

      const parsed = parseDesignBrief(fenced);
      expect(parsed).toBeDefined();
      expect(parsed?.recipe).toBe("saas");
      expect(parsed?.cta).toBe("Schedule Security Scan");
    });
  });

  describe("Anti-Slop System Prompt Generation", () => {
    it("encodes multi-file maintainable Next.js 16 structure", () => {
      const prompt = buildGenerationSystemPrompt({
        existingFiles: [
          {
            path: "app/page.tsx",
            content: "export default function Page() { return null; }",
          },
        ],
        mode: "full",
      });

      expect(prompt).toContain("app/page.tsx (composition only)");
      expect(prompt).toContain("components/sections/*");
      expect(prompt).toContain("Server Components by default");
      expect(prompt).toContain("Avoid AI-slop defaults");
      expect(prompt).toContain("never emit package.json");
    });
  });
});
