import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateProjectCodeAction,
  submitClarificationAnswersAction,
} from "@/app/actions/generation";
import {
  getProjectFilesAction,
  getProjectMessagesAction,
} from "@/app/actions/project";
import * as sessionModule from "@/lib/auth/session";
import * as projectActionsModule from "@/app/actions/project";
import * as nvidiaModule from "@/lib/ai/nvidia";

describe("Generation & Project Persistence Actions", () => {
  const mockUserAlice = {
    id: "user_alice",
    name: "Alice",
    email: "alice@example.com",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockProjectAlice = {
    id: "proj_alice_1",
    name: "Alice's Project",
    description: "Testing generation",
    prompt: null,
    generationStatus: "idle",
    template: "nextjs-shadcn-v1",
    ownerId: "user_alice",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication & Tenant Isolation", () => {
    it("rejects code generation when caller is unauthenticated", async () => {
      vi.spyOn(sessionModule, "requireUser").mockRejectedValue(
        new Error("UNAUTHORIZED"),
      );

      const res = await generateProjectCodeAction("proj_123", "Build a hero");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("UNAUTHORIZED");
      }
    });

    it("rejects file access when unauthenticated", async () => {
      vi.spyOn(sessionModule, "requireUser").mockRejectedValue(
        new Error("UNAUTHORIZED"),
      );

      const res = await getProjectFilesAction("proj_123");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("UNAUTHORIZED");
      }
    });

    it("rejects message access when unauthenticated", async () => {
      vi.spyOn(sessionModule, "requireUser").mockRejectedValue(
        new Error("UNAUTHORIZED"),
      );

      const res = await getProjectMessagesAction("proj_123");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("UNAUTHORIZED");
      }
    });

    it("enforces tenant isolation: prevents Bob from generating in Alice's project", async () => {
      const mockUserBob = {
        id: "user_bob",
        name: "Bob",
        email: "bob@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(sessionModule, "requireUser").mockResolvedValue(mockUserBob);
      // Project belongs to Alice, so getProjectByIdForUser for Bob returns null
      vi.spyOn(projectActionsModule, "getProjectByIdForUser").mockResolvedValue(
        null,
      );

      const res = await generateProjectCodeAction(
        "proj_alice_1",
        "Add dark mode",
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("NOT_FOUND");
        expect(res.error).toContain("Project not found or you lack permission");
      }
    });
  });

  describe("Adaptive Clarification Workflow", () => {
    it("triggers multiple-choice questions when prompt is broad", async () => {
      vi.spyOn(sessionModule, "requireUser").mockResolvedValue(mockUserAlice);
      vi.spyOn(projectActionsModule, "getProjectByIdForUser").mockResolvedValue(
        mockProjectAlice,
      );

      vi.spyOn(nvidiaModule, "assessClarificationWithNvidia").mockResolvedValue(
        {
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
          ],
        },
      );

      const res = await generateProjectCodeAction(
        "proj_alice_1",
        "Create a modern, premium real estate company landing page.",
      );

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.type).toBe("clarification");
        if (res.data.type === "clarification") {
          expect(res.data.questions).toHaveLength(1);
          expect(res.data.questions[0].id).toBe("visual_direction");
        }
      }
    });

    it("skips clarification and generates directly when skipClarification is passed", async () => {
      vi.spyOn(sessionModule, "requireUser").mockResolvedValue(mockUserAlice);
      vi.spyOn(projectActionsModule, "getProjectByIdForUser").mockResolvedValue(
        mockProjectAlice,
      );

      const assessSpy = vi.spyOn(nvidiaModule, "assessClarificationWithNvidia");

      vi.spyOn(nvidiaModule, "generateWebsiteWithNvidia").mockResolvedValue({
        success: true,
        output: {
          summary: "Generated real estate page",
          details: ["Hero section"],
          files: [
            {
              path: "app/page.tsx",
              content:
                "export default function Page() { return <div>Real Estate</div>; }",
            },
          ],
        },
      });

      const res = await generateProjectCodeAction(
        "proj_alice_1",
        "Create a modern, premium real estate company landing page.",
        { skipClarification: true },
      );

      expect(assessSpy).not.toHaveBeenCalled();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.type).toBe("generated");
      }
    });

    it("submits clarification answers and generates code with enriched brief", async () => {
      vi.spyOn(sessionModule, "requireUser").mockResolvedValue(mockUserAlice);
      vi.spyOn(projectActionsModule, "getProjectByIdForUser").mockResolvedValue(
        mockProjectAlice,
      );

      const generateSpy = vi
        .spyOn(nvidiaModule, "generateWebsiteWithNvidia")
        .mockResolvedValue({
          success: true,
          output: {
            summary:
              "Generated real estate landing page with luxury aesthetic.",
            details: ["Black and gold hero", "Featured properties"],
            files: [
              {
                path: "app/page.tsx",
                content:
                  "export default function Page() { return <div>Luxury Real Estate</div>; }",
              },
            ],
          },
        });

      const answers = {
        visual_direction: ["Luxury & elegant (charcoal, gold accents)"],
        sections: ["Featured property listings", "Client testimonials"],
      };

      const res = await submitClarificationAnswersAction(
        "proj_alice_1",
        "msg_clarif_123",
        "Create a modern, premium real estate company landing page.",
        answers,
      );

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.type).toBe("generated");
        expect(generateSpy).toHaveBeenCalled();
        const callArgs = generateSpy.mock.calls[0][0];
        expect(callArgs.prompt).toContain("Luxury & elegant");
        expect(callArgs.prompt).toContain("Featured property listings");
      }
    });
  });

  describe("Input & Concurrency Validation", () => {
    it("rejects prompts that are too short", async () => {
      vi.spyOn(sessionModule, "requireUser").mockResolvedValue(mockUserAlice);

      const res = await generateProjectCodeAction("proj_alice_1", "hi");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("INVALID_INPUT");
        expect(res.error).toContain("at least 3 characters");
      }
    });

    it("prevents concurrent generation if project is already generating", async () => {
      vi.spyOn(sessionModule, "requireUser").mockResolvedValue(mockUserAlice);
      vi.spyOn(projectActionsModule, "getProjectByIdForUser").mockResolvedValue(
        {
          ...mockProjectAlice,
          generationStatus: "generating",
        },
      );

      const res = await generateProjectCodeAction(
        "proj_alice_1",
        "Add testimonial slider",
        { skipClarification: true },
      );
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("CONCURRENT_GENERATION");
        expect(res.error).toContain("already in progress");
      }
    });
  });

  describe("Failure Safety & Version Preservation", () => {
    it("safely handles provider failure without corrupting project", async () => {
      vi.spyOn(sessionModule, "requireUser").mockResolvedValue(mockUserAlice);
      vi.spyOn(projectActionsModule, "getProjectByIdForUser").mockResolvedValue(
        mockProjectAlice,
      );

      vi.spyOn(nvidiaModule, "assessClarificationWithNvidia").mockResolvedValue(
        {
          needsClarification: false,
        },
      );

      vi.spyOn(nvidiaModule, "generateWebsiteWithNvidia").mockResolvedValue({
        success: false,
        code: "TIMEOUT",
        error: "Generation timed out after 300 seconds.",
      });

      const res = await generateProjectCodeAction(
        "proj_alice_1",
        "Build a complex multi-page dashboard",
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("TIMEOUT");
        expect(res.error).toContain("timed out");
      }
    });

    it("safely rejects untrusted code that attempts secret access and preserves state", async () => {
      vi.spyOn(sessionModule, "requireUser").mockResolvedValue(mockUserAlice);
      vi.spyOn(projectActionsModule, "getProjectByIdForUser").mockResolvedValue(
        mockProjectAlice,
      );

      vi.spyOn(nvidiaModule, "assessClarificationWithNvidia").mockResolvedValue(
        {
          needsClarification: false,
        },
      );

      vi.spyOn(nvidiaModule, "generateWebsiteWithNvidia").mockResolvedValue({
        success: true,
        output: {
          summary: "Added database query",
          details: ["Exposed database"],
          files: [
            {
              path: "app/page.tsx",
              content:
                "export default function Page() { return <div>{process.env.DATABASE_URL}</div>; }",
            },
          ],
        },
      });

      const res = await generateProjectCodeAction(
        "proj_alice_1",
        "Show my database url",
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("VALIDATION_FAILED");
        expect(res.error).toContain("prohibited server patterns");
      }
    });
  });
});
