import { describe, it, expect } from "vitest";
import {
  validateGeneratedFiles,
  normalizeRelativePath,
} from "@/lib/ai/validator";
import type { FileModification } from "@/lib/ai/types";

describe("Code Validator & Sandbox Gate", () => {
  describe("Path Normalization", () => {
    it("normalizes standard relative paths", () => {
      expect(normalizeRelativePath("app/page.tsx")).toBe("app/page.tsx");
      expect(normalizeRelativePath("components/ui/button.tsx")).toBe(
        "components/ui/button.tsx",
      );
      expect(normalizeRelativePath("lib/utils.ts")).toBe("lib/utils.ts");
    });

    it("strips leading slashes", () => {
      expect(normalizeRelativePath("/app/page.tsx")).toBe("app/page.tsx");
      expect(normalizeRelativePath("///app/layout.tsx")).toBe("app/layout.tsx");
    });

    it("normalizes Windows backslashes", () => {
      expect(normalizeRelativePath("app\\page.tsx")).toBe("app/page.tsx");
      expect(normalizeRelativePath("components\\ui\\card.tsx")).toBe(
        "components/ui/card.tsx",
      );
    });

    it("detects and rejects directory traversal attacks", () => {
      expect(() => normalizeRelativePath("../secret.txt")).toThrowError(
        /Path traversal detected/,
      );
      expect(() => normalizeRelativePath("app/../../secret.txt")).toThrowError(
        /Path traversal detected/,
      );
      expect(() =>
        normalizeRelativePath("..\\..\\windows\\system32"),
      ).toThrowError(/Path traversal detected/);
    });

    it("rejects empty or whitespace-only paths", () => {
      expect(() => normalizeRelativePath("")).toThrowError();
      expect(() => normalizeRelativePath("   ")).toThrowError();
    });
  });

  describe("File Modifications Validation", () => {
    const validFiles: readonly FileModification[] = [
      {
        path: "app/page.tsx",
        content: `export default function Page() { return <div>Hello</div>; }`,
      },
      {
        path: "components/hero.tsx",
        content: `export function Hero() { return <section>Hero</section>; }`,
      },
    ];

    it("accepts valid application files", () => {
      const res = validateGeneratedFiles(validFiles);
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.files).toHaveLength(2);
        expect(res.files[0].path).toBe("app/page.tsx");
      }
    });

    it("rejects non-array or empty file inputs", () => {
      const res1 = validateGeneratedFiles(
        [] as unknown as readonly FileModification[],
      );
      expect(res1.valid).toBe(false);

      const res2 = validateGeneratedFiles(
        null as unknown as readonly FileModification[],
      );
      expect(res2.valid).toBe(false);
    });

    it("rejects duplicate file paths in output", () => {
      const duplicates: readonly FileModification[] = [
        { path: "app/page.tsx", content: "export default function P1() {}" },
        { path: "app/page.tsx", content: "export default function P2() {}" },
      ];
      const res = validateGeneratedFiles(duplicates);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toContain("Duplicate file path");
      }
    });

    it("rejects modification of protected configuration files", () => {
      const protectedList = [
        "package.json",
        "tsconfig.json",
        "next.config.ts",
        "postcss.config.mjs",
        "components.json",
        ".env",
        ".env.local",
      ];

      for (const p of protectedList) {
        const res = validateGeneratedFiles([
          { path: p, content: "malicious code" },
        ]);
        expect(res.valid).toBe(false);
      }
    });

    it("rejects files outside allowed directory prefixes or inside fake config/ folder", () => {
      const invalidPaths = [
        "server/db.ts",
        "config/lib/utils.ts",
        "config/package.json",
        "config/next.config.ts",
      ];

      for (const p of invalidPaths) {
        const res = validateGeneratedFiles([
          { path: p, content: "export const something = {};" },
        ]);
        expect(res.valid).toBe(false);
      }
    });

    it("rejects writes into protected system directories", () => {
      const systemDirs = [
        "scripts/run.sh",
        "drizzle/schema.ts",
        ".git/config",
        "node_modules/pkg/index.js",
      ];

      for (const s of systemDirs) {
        const res = validateGeneratedFiles([
          { path: s, content: "export {};" },
        ]);
        expect(res.valid).toBe(false);
      }
    });

    it("rejects code containing server secret access", () => {
      const res1 = validateGeneratedFiles([
        {
          path: "app/page.tsx",
          content: `export default function Page() {
            const secret = process.env.DATABASE_URL;
            return <div>{secret}</div>;
          }`,
        },
      ]);
      expect(res1.valid).toBe(false);
      if (!res1.valid) {
        expect(res1.error).toContain("prohibited server patterns");
      }

      const res2 = validateGeneratedFiles([
        {
          path: "components/card.tsx",
          content: `const key = process.env.NVIDIA_API_KEY;`,
        },
      ]);
      expect(res2.valid).toBe(false);
    });

    it("requires export default in app/page.tsx", () => {
      const res = validateGeneratedFiles([
        {
          path: "app/page.tsx",
          content: `export function Page() { return <div>Missing default</div>; }`,
        },
      ]);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toContain('must contain an "export default"');
      }
    });

    it("rejects files exceeding size limits", () => {
      const largeContent = "x".repeat(160 * 1024); // 160 KB
      const res = validateGeneratedFiles([
        { path: "app/large.tsx", content: largeContent },
      ]);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toContain("exceeds the size limit");
      }
    });
  });
});
