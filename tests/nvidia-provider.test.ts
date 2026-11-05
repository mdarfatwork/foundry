import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractStructuredOutput,
  extractClarificationOutput,
  assessClarificationWithNvidia,
  generateWebsiteWithNvidia,
} from "@/lib/ai/nvidia";

describe("NVIDIA Provider & Structured Output Extractor", () => {
  describe("extractStructuredOutput", () => {
    it("parses clean, raw JSON output", () => {
      const raw = JSON.stringify({
        summary: "Created landing page with hero and features.",
        details: ["Hero section", "Feature grid"],
        files: [
          {
            path: "app/page.tsx",
            content: "export default function Page() { return <div />; }",
          },
        ],
      });

      const result = extractStructuredOutput(raw);
      expect(result.summary).toBe(
        "Created landing page with hero and features.",
      );
      expect(result.details).toHaveLength(2);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe("app/page.tsx");
    });

    it("extracts JSON wrapped in markdown code fences (```json ... ```)", () => {
      const raw = `Here is your website:
\`\`\`json
{
  "summary": "Built dashboard layout.",
  "details": ["Responsive sidebar", "Card metrics"],
  "files": [
    {
      "path": "app/page.tsx",
      "content": "export default function Page() {}"
    }
  ]
}
\`\`\`
Hope this helps!`;

      const result = extractStructuredOutput(raw);
      expect(result.summary).toBe("Built dashboard layout.");
      expect(result.files[0].path).toBe("app/page.tsx");
    });

    it("extracts JSON without code fences but embedded in conversational prose", () => {
      const raw = `Certainly! I've updated the component:
{
  "summary": "Added Pricing Table.",
  "details": ["3-tier pricing"],
  "files": [
    {
      "path": "components/pricing.tsx",
      "content": "export function Pricing() {}"
    }
  ]
}
Enjoy building with Foundry!`;

      const result = extractStructuredOutput(raw);
      expect(result.summary).toBe("Added Pricing Table.");
      expect(result.files[0].path).toBe("components/pricing.tsx");
    });

    it("throws clear error on malformed or non-JSON input", () => {
      expect(() =>
        extractStructuredOutput("not valid json at all"),
      ).toThrowError(/Failed to parse model output as JSON/);
      expect(() => extractStructuredOutput("")).toThrowError(
        /Model returned empty/,
      );
    });

    it("throws error when files array is missing or empty", () => {
      const missingFiles = JSON.stringify({
        summary: "Test",
        details: [],
        files: [],
      });
      expect(() => extractStructuredOutput(missingFiles)).toThrowError(
        /JSON output must contain a non-empty "files" array/,
      );
    });
  });

  describe("extractClarificationOutput", () => {
    it("parses valid clarification questions and options", () => {
      const raw = JSON.stringify({
        needsClarification: true,
        questions: [
          {
            id: "visual_direction",
            question: "What visual direction do you prefer?",
            isMultiSelect: false,
            options: [
              { id: "opt_luxury", label: "Luxury & elegant" },
              { id: "opt_minimal", label: "Modern & minimal" },
            ],
          },
          {
            id: "sections",
            question: "Which sections should be included?",
            isMultiSelect: true,
            options: [
              { id: "opt_hero", label: "Hero showcase" },
              { id: "opt_pricing", label: "Pricing matrix" },
            ],
          },
        ],
      });

      const res = extractClarificationOutput(raw);
      expect(res.needsClarification).toBe(true);
      if (res.needsClarification) {
        expect(res.questions).toHaveLength(2);
        expect(res.questions[0].id).toBe("visual_direction");
        expect(res.questions[1].isMultiSelect).toBe(true);
        // Automatically ensured "Let Foundry decide" option
        const lastOpt =
          res.questions[0].options[res.questions[0].options.length - 1];
        expect(lastOpt.label).toContain("Foundry decide");
      }
    });

    it("handles needsClarification: false safely", () => {
      const raw = JSON.stringify({ needsClarification: false });
      const res = extractClarificationOutput(raw);
      expect(res.needsClarification).toBe(false);
    });

    it("gracefully falls back to needsClarification: false on malformed JSON", () => {
      const res1 = extractClarificationOutput("Invalid text");
      expect(res1.needsClarification).toBe(false);

      const res2 = extractClarificationOutput("");
      expect(res2.needsClarification).toBe(false);
    });
  });

  describe("assessClarificationWithNvidia", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      vi.restoreAllMocks();
    });

    it("returns needsClarification: false if NVIDIA_API_KEY is not configured", async () => {
      delete process.env.NVIDIA_API_KEY;
      const res = await assessClarificationWithNvidia("Build a website");
      expect(res.needsClarification).toBe(false);
    });

    it("returns needsClarification: true for broad real estate prompt", async () => {
      process.env.NVIDIA_API_KEY = "test-key";

      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                needsClarification: true,
                questions: [
                  {
                    id: "visual_direction",
                    question: "What visual direction do you prefer?",
                    isMultiSelect: false,
                    options: [
                      {
                        id: "luxury",
                        label: "Luxury and elegant (black and gold)",
                      },
                      {
                        id: "minimal",
                        label: "Modern and minimal (white and neutral)",
                      },
                    ],
                  },
                ],
              }),
            },
          },
        ],
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => mockResponse,
      } as unknown as Response);

      const res = await assessClarificationWithNvidia(
        "Create a modern, premium real estate company landing page.",
      );

      expect(res.needsClarification).toBe(true);
      if (res.needsClarification) {
        expect(res.questions).toHaveLength(1);
        expect(res.questions[0].question).toContain("visual direction");
      }
    });

    it("skips clarification for highly detailed prompts via heuristic", async () => {
      process.env.NVIDIA_API_KEY = "test-key";
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const highlyDetailedPrompt =
        "Create a real estate landing page with a dark mode luxury theme featuring charcoal backgrounds and gold border accents. " +
        "The navbar should have a logo and 4 links: Listings, Agents, About Us, and Contact. " +
        "Include a full-width hero section with headline 'Discover Extraordinary Living', search bar for city and price range, " +
        "and a 3-column featured properties grid showing price, bedroom count, and square footage. " +
        "Follow this with a client testimonials section featuring 3 cards and a contact inquiry form with email and phone inputs.";

      const res = await assessClarificationWithNvidia(highlyDetailedPrompt);
      expect(res.needsClarification).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("generateWebsiteWithNvidia Provider Execution", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      vi.restoreAllMocks();
    });

    it("fails with CONFIG_ERROR when NVIDIA_API_KEY is not defined", async () => {
      delete process.env.NVIDIA_API_KEY;

      const result = await generateWebsiteWithNvidia({
        prompt: "Build a landing page",
        existingFiles: [],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("CONFIG_ERROR");
        expect(result.error).toContain("NVIDIA API key is not configured");
      }
    });

    it("handles HTTP 429 rate limit safely", async () => {
      process.env.NVIDIA_API_KEY = "test-nvidia-key";

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        status: 429,
        ok: false,
        statusText: "Too Many Requests",
      } as Response);

      const result = await generateWebsiteWithNvidia({
        prompt: "Build an app",
        existingFiles: [],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("RATE_LIMIT");
        expect(result.error).toContain("rate limit reached");
      }
    });

    it("handles HTTP 500 provider error without leaking internal credentials", async () => {
      process.env.NVIDIA_API_KEY = "test-nvidia-key";

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        status: 500,
        ok: false,
        statusText: "Internal Server Error",
        text: async () => "Cluster GPU failure",
      } as unknown as Response);

      const result = await generateWebsiteWithNvidia({
        prompt: "Build an app",
        existingFiles: [],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("PROVIDER_ERROR");
        expect(result.error).toContain("NVIDIA API error (500");
        expect(result.error).not.toContain("test-nvidia-key");
      }
    });

    it("successfully parses valid response and returns validated GenerationOutput", async () => {
      process.env.NVIDIA_API_KEY = "test-nvidia-key";

      const mockPayload = {
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                summary: "Created landing page with hero section.",
                details: ["Added Hero component", "Set up primary CTA"],
                files: [
                  {
                    path: "app/page.tsx",
                    content:
                      "export default function Home() { return <h1>Foundry</h1>; }",
                  },
                ],
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 300,
        },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => mockPayload,
      } as unknown as Response);

      const result = await generateWebsiteWithNvidia({
        prompt: "Create a landing page",
        existingFiles: [],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output.summary).toBe(
          "Created landing page with hero section.",
        );
        expect(result.output.files).toHaveLength(1);
        expect(result.output.files[0].path).toBe("app/page.tsx");
        expect(result.usage?.completionTokens).toBe(300);
      }
    });
  });
});
