import { describe, it, expect } from "vitest";
import { validateGeneratedFiles } from "@/lib/ai/validator";
import { validateSourceIntegrity } from "@/lib/ai/syntax-validator";
import { extractFilesFromMalformedJson } from "@/lib/ai/parse";
import { extractRequestedSectionsFromPrompt } from "@/lib/ai/prompts";
import {
  computeDeterministicHash,
  computeFileTreeHash,
  diffFileTrees,
  extractDependencyHash,
} from "@/lib/crypto-hash";
import { canAttemptRepair } from "@/lib/verification/repair";
import { getStarterTemplateFiles } from "@/lib/templates/starter-nextjs";
import type { VerificationDiagnostic } from "@/lib/verification/types";

describe("Regression Fixes & Production Reliability Suite", () => {
  describe("1. Section Completeness & Composition Validation", () => {
    it("extracts all explicitly requested sections from a multi-section prompt", () => {
      const prompt =
        "Create a furniture showroom landing page with 10 sections: Navbar, Hero, Categories, AboutUs, Collection, Materials, VirtualShowroom, WhyUs, Testimonials, and Footer.";
      const sections = extractRequestedSectionsFromPrompt(prompt).map((s) =>
        s.toLowerCase(),
      );

      expect(sections.length).toBeGreaterThanOrEqual(8);
      expect(sections).toContain("hero");
      expect(sections).toContain("collection");
      expect(sections).toContain("why-us");
      expect(sections).toContain("testimonials");
    });

    it("rejects generation when 10 sections were requested but app/page.tsx only renders 1 section (WhyUs)", () => {
      const requestedSections = [
        "Navbar",
        "Hero",
        "Categories",
        "AboutUs",
        "Collection",
        "Materials",
        "VirtualShowroom",
        "WhyUs",
        "Testimonials",
        "Footer",
      ];

      const files = [
        {
          path: "app/page.tsx",
          content: `
import { WhyUs } from "@/components/sections/why-us";
export default function Page() {
  return (
    <main>
      <WhyUs />
    </main>
  );
}
`,
        },
        {
          path: "components/sections/why-us.tsx",
          content: `export function WhyUs() { return <section>Why Us</section>; }`,
        },
      ];

      const res = validateGeneratedFiles(files, {
        requiredSections: requestedSections,
      });

      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toContain("Section completeness check failed");
        expect(res.error).toContain("renders only 1 section(s)");
      }
    });

    it("accepts generation when all required sections are imported and rendered", () => {
      const requestedSections = ["Hero", "Showroom", "WhyUs", "Footer"];

      const files = [
        {
          path: "app/page.tsx",
          content: `
import { Hero } from "@/components/sections/hero";
import { Showroom } from "@/components/sections/showroom";
import { WhyUs } from "@/components/sections/why-us";
import { Footer } from "@/components/sections/footer";

export default function Page() {
  return (
    <main>
      <Hero />
      <Showroom />
      <WhyUs />
      <Footer />
    </main>
  );
}
`,
        },
        {
          path: "components/sections/hero.tsx",
          content: `export function Hero() { return <section>Hero</section>; }`,
        },
        {
          path: "components/sections/showroom.tsx",
          content: `export function Showroom() { return <section>Showroom</section>; }`,
        },
        {
          path: "components/sections/why-us.tsx",
          content: `export function WhyUs() { return <section>Why Us</section>; }`,
        },
        {
          path: "components/sections/footer.tsx",
          content: `export function Footer() { return <footer>Footer</footer>; }`,
        },
      ];

      const res = validateGeneratedFiles(files, {
        requiredSections: requestedSections,
      });

      expect(res.valid).toBe(true);
    });

    it("rejects app/page.tsx if it imports a section component that does not exist in the files", () => {
      const files = [
        {
          path: "app/page.tsx",
          content: `
import { MissingSection } from "@/components/sections/missing-section";
export default function Page() {
  return <main><MissingSection /></main>;
}
`,
        },
      ];

      const res = validateGeneratedFiles(files);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toContain("Module not found in page composition");
      }
    });

    it("rejects app/page.tsx if it imports a named export that the target component does not export", () => {
      const files = [
        {
          path: "app/page.tsx",
          content: `
import { WrongName } from "@/components/sections/collection";
export default function Page() {
  return <main><WrongName /></main>;
}
`,
        },
        {
          path: "components/sections/collection.tsx",
          content: `export function Collection() { return <section>Collection</section>; }`,
        },
      ];

      const res = validateGeneratedFiles(files);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toContain("Export mismatch");
        expect(res.error).toContain("does not export 'WrongName'");
      }
    });
  });

  describe("2. Truncation & Syntax Integrity Scanner", () => {
    it("detects and rejects truncated JSX attribute at EOF (regression from collection.tsx)", () => {
      // Exactly reproducing the regression evidence: truncated midway through button className
      const truncatedSource = `
export function Collection() {
  return (
    <section>
      <h2>Autumn Collection</h2>
      <button className="bg-[#1A1817] text-[#FD
`;

      const result = validateSourceIntegrity(
        "components/sections/collection.tsx",
        truncatedSource,
      );

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("truncated");
      }
    });

    it("detects and rejects unclosed JSX tag at EOF", () => {
      const truncatedSource = `
export function About() {
  return (
    <section className="py-12">
      <div className="container">
        <h3>About Us</h3>
`;

      const result = validateSourceIntegrity(
        "components/sections/about.tsx",
        truncatedSource,
      );

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("unclosed");
        expect(result.error).toContain("truncated");
      }
    });

    it("detects and rejects unsupported Radix asChild usage", () => {
      const sourceWithAsChild = `
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <Button asChild variant="outline">
      <a href="/shop">Shop Now</a>
    </Button>
  );
}
`;

      const result = validateSourceIntegrity(
        "components/sections/hero.tsx",
        sourceWithAsChild,
      );

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain("asChild");
        expect(result.error).toContain("render={<Component />}");
      }
    });

    it("extractFilesFromMalformedJson rejects files that contain truncated JSX syntax", () => {
      const malformedJson = `
{
  "summary": "Showroom",
  "files": [
    {
      "path": "components/sections/collection.tsx",
      "content": "export function Collection() {\\n  return (\\n    <button className=\\"bg-[#1A1817] text-[#FD"
    }
  ]
}
`;

      const extracted = extractFilesFromMalformedJson(malformedJson).files;
      // Truncated file must not be admitted
      expect(
        extracted.find((f) => f.path.includes("collection")),
      ).toBeUndefined();
    });
  });

  describe("3. Deterministic Hashing & Accurate File Tree Diffing", () => {
    it("detects same-length content modifications that length-based checks miss", () => {
      const original = "export const title = 'Showroom A';";
      const modified = "export const title = 'Showroom B';";

      expect(original.length).toBe(modified.length);

      const hashA = computeDeterministicHash(original);
      const hashB = computeDeterministicHash(modified);

      expect(hashA).not.toBe(hashB);

      const treeA = [{ path: "app/page.tsx", content: original }];
      const treeB = [{ path: "app/page.tsx", content: modified }];

      const diff = diffFileTrees(treeA, treeB);
      expect(diff.changed.length).toBe(1);
      expect(diff.unchanged.length).toBe(0);
      expect(diff.changed[0].path).toBe("app/page.tsx");
    });

    it("detects removed and renamed files so stale files are purged", () => {
      const current = [
        { path: "app/page.tsx", content: "page" },
        { path: "components/sections/old-section.tsx", content: "old" },
      ];
      const updated = [
        { path: "app/page.tsx", content: "page" },
        { path: "components/sections/new-section.tsx", content: "new" },
      ];

      const diff = diffFileTrees(current, updated);
      expect(diff.removed.length).toBe(1);
      expect(diff.removed[0].path).toBe("components/sections/old-section.tsx");
      expect(diff.added.length).toBe(1);
      expect(diff.added[0].path).toBe("components/sections/new-section.tsx");
      expect(diff.unchanged.length).toBe(1);
    });

    it("extractDependencyHash isolates dependencies and ignores scripts and formatting changes", () => {
      const pkg1 = JSON.stringify({
        name: "test-app",
        scripts: { dev: "next dev --webpack" },
        dependencies: { next: "16.4.6", react: "19.3.0" },
      });

      const pkg2 = JSON.stringify({
        name: "test-app-renamed",
        scripts: { dev: "next dev --turbopack" },
        dependencies: { react: "19.3.0", next: "16.4.6" }, // Different key order
      });

      const pkg3 = JSON.stringify({
        name: "test-app",
        scripts: { dev: "next dev --webpack" },
        dependencies: { next: "16.4.6", react: "19.3.0", lucide: "^1.0.0" }, // Added dependency
      });

      const hash1 = extractDependencyHash(pkg1);
      const hash2 = extractDependencyHash(pkg2);
      const hash3 = extractDependencyHash(pkg3);

      expect(hash1).toBe(hash2); // Scripts and key order do NOT trigger reinstall
      expect(hash1).not.toBe(hash3); // Actual dependency addition DOES trigger reinstall
    });

    it("computeFileTreeHash produces deterministic, order-independent signatures", () => {
      const filesA = [
        { path: "b.tsx", content: "b" },
        { path: "a.tsx", content: "a" },
      ];
      const filesB = [
        { path: "a.tsx", content: "a" },
        { path: "b.tsx", content: "b" },
      ];

      const hashA = computeFileTreeHash(filesA);
      const hashB = computeFileTreeHash(filesB);

      expect(hashA).toBe(hashB);
    });
  });

  describe("4. Verification Runner, Toolchain & Repair Guards", () => {
    it("excludes toolchain unavailable errors from AI repair loops (fixable: false)", () => {
      const toolchainDiag: VerificationDiagnostic = {
        id: "diag_1",
        severity: "error",
        source: "toolchain",
        message:
          "TypeScript compiler ('tsc') is not installed in the container environment.",
        code: "TOOLCHAIN_UNAVAILABLE",
        fixable: false,
        timestamp: Date.now(),
      };

      const canRepair = canAttemptRepair([toolchainDiag], 0, 2);
      expect(canRepair).toBe(false);
    });

    it("excludes verification timeouts from AI repair loops (fixable: false)", () => {
      const timeoutDiag: VerificationDiagnostic = {
        id: "diag_2",
        severity: "error",
        source: "typescript",
        message: "TypeScript typecheck timed out after 45000ms.",
        code: "TIMEOUT",
        fixable: false,
        timestamp: Date.now(),
      };

      const canRepair = canAttemptRepair([timeoutDiag], 0, 2);
      expect(canRepair).toBe(false);
    });

    it("allows repair for legitimate fixable TypeScript compiler diagnostics", () => {
      const fixableDiag: VerificationDiagnostic = {
        id: "diag_3",
        severity: "error",
        source: "typescript",
        file: "components/sections/hero.tsx",
        line: 12,
        message: "Property 'title' does not exist on type 'Props'.",
        code: "TS2339",
        fixable: true,
        timestamp: Date.now(),
      };

      const canRepair = canAttemptRepair([fixableDiag], 0, 2);
      expect(canRepair).toBe(true);
    });
  });

  describe("5. Starter Template Configuration & Runtime Diagnostics", () => {
    it("starter template next.config.ts includes remotePatterns for Unsplash images", () => {
      const files = getStarterTemplateFiles("test-showroom");
      const nextConfig = files.find((f) => f.path === "next.config.ts");

      expect(nextConfig).toBeDefined();
      expect(nextConfig!.content).toContain("images.unsplash.com");
      expect(nextConfig!.content).toContain("plus.unsplash.com");
    });

    it("starter template app/layout.tsx uses client PreviewDiagnostics component instead of inline script", () => {
      const files = getStarterTemplateFiles("test-showroom");
      const layout = files.find((f) => f.path === "app/layout.tsx");

      expect(layout).toBeDefined();
      expect(layout!.content).not.toContain("dangerouslySetInnerHTML");
      expect(layout!.content).toContain("<PreviewDiagnostics />");
    });
  });
});
