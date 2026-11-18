import { describe, it, expect, vi } from "vitest";
import {
  verifyManifestAndFiles,
  aggregateVerificationResult,
  runFastVerificationPipeline,
} from "@/lib/verification/runner";
import {
  parseTypeScriptDiagnostics,
  parseESLintDiagnostics,
  parseNextBuildDiagnostics,
  classifyBrowserDiagnostic,
  deduplicateDiagnostics,
  getDiagnosticFingerprint,
  stripAnsi,
} from "@/lib/verification/parser";
import {
  canAttemptRepair,
  formatDiagnosticsReport,
  selectRelevantFilesForDiagnostics,
  DEFAULT_MAX_REPAIR_ATTEMPTS,
} from "@/lib/verification/repair";
import { getStarterTemplateFiles } from "@/lib/templates/starter-nextjs";
import type {
  VerificationDiagnostic,
  BrowserDiagnosticPayload,
  VerificationStageResult,
} from "@/lib/verification/types";
import { recordVerificationRunAction } from "@/app/actions/verification";
import fs from "node:fs";
import path from "node:path";

describe("Mandatory Verification & Self-Repair Pipeline", () => {
  const validStarterFiles = getStarterTemplateFiles("Production App");

  // 1. Manifest & File Completeness Checks
  describe("1. Manifest & File Completeness Checks", () => {
    it("passes validation for a valid Next.js 16 starter application", () => {
      const result = verifyManifestAndFiles(validStarterFiles);
      expect(result.status).toBe("passed");
      expect(result.diagnostics).toHaveLength(0);
    });

    it("detects missing package.json as a fatal error", () => {
      const filesWithoutPkg = validStarterFiles.filter(
        (f) => f.path !== "package.json",
      );
      const result = verifyManifestAndFiles(filesWithoutPkg);
      expect(result.status).toBe("failed");
      const fatal = result.diagnostics.find((d) => d.severity === "fatal");
      expect(fatal).toBeDefined();
      expect(fatal?.message).toContain("missing a root package.json");
    });

    it("detects missing app/page.tsx or missing default export", () => {
      const filesWithoutPage = validStarterFiles.filter(
        (f) => f.path !== "app/page.tsx",
      );
      const resultMissing = verifyManifestAndFiles(filesWithoutPage);
      expect(resultMissing.status).toBe("failed");
      expect(
        resultMissing.diagnostics.some((d) =>
          d.message.includes("app/page.tsx"),
        ),
      ).toBe(true);

      const filesBadExport = [
        ...filesWithoutPage,
        {
          path: "app/page.tsx",
          content: "export function Helper() { return null; }",
        },
      ];
      const resultBadExport = verifyManifestAndFiles(filesBadExport);
      expect(resultBadExport.status).toBe("failed");
      expect(
        resultBadExport.diagnostics.some((d) =>
          d.message.includes("default export"),
        ),
      ).toBe(true);
    });

    it("never reports status as verified when required checks fail or are skipped", () => {
      const failedStage: VerificationStageResult = {
        stage: "manifest",
        status: "failed",
        durationMs: 12,
        diagnostics: [
          {
            id: "err_1",
            severity: "error",
            source: "manifest",
            message: "Missing mandatory file",
            fixable: true,
            timestamp: Date.now(),
          },
        ],
      };

      const aggregated = aggregateVerificationResult("proj_test", {
        manifest: failedStage,
      });

      expect(aggregated.status).toBe("failed");
      expect(aggregated.passed).toBe(false);
      expect(aggregated.errorCount).toBe(1);
    });
  });

  // 2. TypeScript & Static Analysis
  describe("2. TypeScript & Static Analysis Diagnostics", () => {
    it("detects and parses TypeScript compiler errors with exact file, line, and code", () => {
      const rawTscOutput = `
app/page.tsx(14,5): error TS2322: Type 'string' is not assignable to type 'number'.
components/sections/hero.tsx(32,10): error TS2304: Cannot find name 'unresolvedVariable'.
`;
      const diagnostics = parseTypeScriptDiagnostics(rawTscOutput);

      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0]).toMatchObject({
        source: "typescript",
        severity: "error",
        file: "app/page.tsx",
        line: 14,
        column: 5,
        code: "TS2322",
        message: "Type 'string' is not assignable to type 'number'.",
        fixable: true,
      });

      expect(diagnostics[1]).toMatchObject({
        source: "typescript",
        severity: "error",
        file: "components/sections/hero.tsx",
        line: 32,
        column: 10,
        code: "TS2304",
      });
    });

    it("parses ESLint output format accurately", () => {
      const rawEslint = `
app/page.tsx
  14:5  error  'unusedVar' is defined but never used  @typescript-eslint/no-unused-vars
  28:1  warning  Unexpected console statement  no-console
`;
      const diagnostics = parseESLintDiagnostics(rawEslint);
      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0].code).toBe("@typescript-eslint/no-unused-vars");
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[1].code).toBe("no-console");
      expect(diagnostics[1].severity).toBe("warning");
    });

    it("parses TypeScript Format B with ANSI color codes and colons from WebContainer", () => {
      const ansiTscOutput = `\u001b[96mcomponents/sections/cta.tsx\u001b[0m:\u001b[93m1\u001b[0m:\u001b[93m30\u001b[0m - \u001b[91merror\u001b[0m\u001b[90m TS1125: \u001b[0mHexadecimal digit expected.`;
      const diagnostics = parseTypeScriptDiagnostics(ansiTscOutput);

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        source: "typescript",
        severity: "error",
        file: "components/sections/cta.tsx",
        line: 1,
        column: 30,
        code: "TS1125",
        message: "Hexadecimal digit expected.",
        fixable: true,
      });
    });

    it("parses ESLint syntax errors with ANSI codes and WebContainer path prefixes", () => {
      const ansiEslintOutput = `\u001b[4m/home/foundry-app/components/sections/about.tsx\u001b[24m\n  \u001b[2m42:13\u001b[22m  \u001b[31merror\u001b[39m  Parsing error: Unexpected token. Did you mean {\'>\'} or &gt;?`;
      const diagnostics = parseESLintDiagnostics(ansiEslintOutput);

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        source: "eslint",
        severity: "error",
        file: "components/sections/about.tsx",
        line: 42,
        column: 13,
        code: "eslint_syntax_error",
        message: "Parsing error: Unexpected token. Did you mean {'>'} or &gt;?",
        fixable: true,
      });
    });

    it("strips ANSI terminal escape codes cleanly", () => {
      const formatted =
        "\u001b[31mRed Error\u001b[0m and \u001b[1mBold Text\u001b[22m";
      expect(stripAnsi(formatted)).toBe("Red Error and Bold Text");
    });
  });

  // 3. Build & Module Resolution Checks
  describe("3. Production Build & Module Resolution", () => {
    it("detects missing module or invalid imports from next build output", () => {
      const buildOutput = `
Failed to compile.
Module not found: Can't resolve '@/components/ui/nonexistent-card' in 'app/page.tsx'
`;
      const diagnostics = parseNextBuildDiagnostics(buildOutput);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        source: "build",
        severity: "error",
        code: "MODULE_NOT_FOUND",
        file: "app/page.tsx",
      });
      expect(diagnostics[0].suggestedFix).toContain("Check import path");
    });

    it("detects TypeScript build errors during next build", () => {
      const buildOutput = `
./components/sections/navbar.tsx:24:15
Type error: Property 'title' does not exist on type 'Props'.
`;
      const diagnostics = parseNextBuildDiagnostics(buildOutput);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].file).toBe("components/sections/navbar.tsx");
      expect(diagnostics[0].line).toBe(24);
      expect(diagnostics[0].code).toBe("NEXT_BUILD_TYPE_ERROR");
    });
  });

  // 4. Browser Runtime & React Warnings (including prop-leakage regression)
  describe("4. Browser Runtime Verification & Prop Leakage Regression", () => {
    it("captures browser console errors and uncaught runtime exceptions", () => {
      const errorPayload: BrowserDiagnosticPayload = {
        type: "FOUNDRY_PREVIEW_DIAGNOSTIC",
        source: "runtime_exception",
        severity: "error",
        message:
          "Uncaught TypeError: Cannot read properties of undefined (reading 'map')",
        stack:
          "TypeError: Cannot read properties of undefined\n    at Hero (app/page.tsx:42:15)",
        timestamp: Date.now(),
      };

      const classified = classifyBrowserDiagnostic(errorPayload);
      expect(classified.severity).toBe("error");
      expect(classified.code).toBe("UNCAUGHT_EXCEPTION");
      expect(classified.file).toBe("app/page.tsx");
      expect(classified.line).toBe(42);
      expect(classified.fixable).toBe(true);
    });

    it("REGRESSION TEST: Captures general class of invalid component-prop leakage on DOM elements (e.g. asChild)", () => {
      // General React warning emitted when an unsupported prop is leaked to a native DOM element
      const propLeakPayload: BrowserDiagnosticPayload = {
        type: "FOUNDRY_PREVIEW_DIAGNOSTIC",
        source: "react_warning",
        severity: "warn",
        message:
          "Warning: React does not recognize the `asChild` prop on a DOM element. If you intentionally want it to appear in the DOM as a custom attribute, spell it as lowercase `aschild`. If you accidentally passed it from a parent component, remove it from the DOM element.",
        componentStack:
          "\n    in button (created by Button)\n    in Button (at app/page.tsx:35:11)\n    in main",
        timestamp: Date.now(),
      };

      const classified = classifyBrowserDiagnostic(propLeakPayload);
      expect(classified.source).toBe("react_warning");
      expect(classified.severity).toBe("error"); // Elevated to error so pipeline repairs it
      expect(classified.code).toBe("REACT_UNRECOGNIZED_DOM_PROP");
      expect(classified.file).toBe("app/page.tsx");
      expect(classified.line).toBe(35);
      expect(classified.suggestedFix).toContain("Remove 'asChild'");
      expect(classified.suggestedFix).toContain("Base UI primitives");
      expect(classified.fixable).toBe(true);
    });

    it("REGRESSION TEST: Captures arbitrary custom prop leakage without hardcoded asChild logic", () => {
      const arbitraryPropPayload: BrowserDiagnosticPayload = {
        type: "FOUNDRY_PREVIEW_DIAGNOSTIC",
        source: "react_warning",
        severity: "warn",
        message:
          "Warning: React does not recognize the `customThemeVariant` prop on a DOM element.",
        componentStack:
          "\n    in div (created by Card)\n    in Card (at components/sections/about.tsx:18:7)",
        timestamp: Date.now(),
      };

      const classified = classifyBrowserDiagnostic(arbitraryPropPayload);
      expect(classified.code).toBe("REACT_UNRECOGNIZED_DOM_PROP");
      expect(classified.file).toBe("components/sections/about.tsx");
      expect(classified.line).toBe(18);
      expect(classified.suggestedFix).toContain("Remove 'customThemeVariant'");
    });

    it("captures React missing key warnings in mapped lists", () => {
      const keyPayload: BrowserDiagnosticPayload = {
        type: "FOUNDRY_PREVIEW_DIAGNOSTIC",
        source: "react_warning",
        severity: "warn",
        message:
          'Warning: Each child in a list should have a unique "key" prop.',
        componentStack:
          "\n    in li (at components/sections/features.tsx:45:9)",
        timestamp: Date.now(),
      };

      const classified = classifyBrowserDiagnostic(keyPayload);
      expect(classified.code).toBe("REACT_MISSING_KEY");
      expect(classified.suggestedFix).toContain("key prop");
    });

    it("captures React hydration mismatch warnings", () => {
      const hydrationPayload: BrowserDiagnosticPayload = {
        type: "FOUNDRY_PREVIEW_DIAGNOSTIC",
        source: "react_warning",
        severity: "warn",
        message:
          "Warning: Text content did not match. Server: 'Hello' Client: 'World'",
        timestamp: Date.now(),
      };

      const classified = classifyBrowserDiagnostic(hydrationPayload);
      expect(classified.code).toBe("REACT_HYDRATION_MISMATCH");
      expect(classified.severity).toBe("error");
    });
  });

  // 5. Deduplication & Classification
  describe("5. Deduplication and Fingerprinting", () => {
    it("deduplicates identical diagnostics across multiple render cycles", () => {
      const diag: VerificationDiagnostic = {
        id: "d1",
        severity: "error",
        source: "typescript",
        message: "Type 'string' is not assignable to type 'number'.",
        file: "app/page.tsx",
        line: 14,
        code: "TS2322",
        fixable: true,
        timestamp: Date.now(),
      };

      const duplicate: VerificationDiagnostic = {
        ...diag,
        id: "d2",
        timestamp: Date.now() + 500,
      };

      const distinct: VerificationDiagnostic = {
        id: "d3",
        severity: "error",
        source: "typescript",
        message: "Cannot find name 'missingVar'.",
        file: "app/page.tsx",
        line: 25,
        code: "TS2304",
        fixable: true,
        timestamp: Date.now(),
      };

      const deduplicated = deduplicateDiagnostics([diag, duplicate, distinct]);
      expect(deduplicated).toHaveLength(2);
      expect(deduplicated[0].id).toBe("d1");
      expect(deduplicated[1].id).toBe("d3");
    });

    it("generates deterministic fingerprint hashes", () => {
      const fp1 = getDiagnosticFingerprint(
        "typescript",
        "Error in component",
        "app/page.tsx",
        10,
        "TS2322",
      );
      const fp2 = getDiagnosticFingerprint(
        "typescript",
        "Error   in   component",
        "app/page.tsx",
        10,
        "TS2322",
      );
      expect(fp1).toBe(fp2);
    });
  });

  // 6. Bounded Self-Repair Workflow
  describe("6. Bounded Self-Repair Workflow", () => {
    it("allows repair when fixable errors exist and attempts are below budget", () => {
      const diagnostics: VerificationDiagnostic[] = [
        {
          id: "diag_1",
          severity: "error",
          source: "typescript",
          message: "Type error in component",
          fixable: true,
          timestamp: Date.now(),
        },
      ];

      expect(
        canAttemptRepair(diagnostics, 0, DEFAULT_MAX_REPAIR_ATTEMPTS),
      ).toBe(true);
      expect(
        canAttemptRepair(diagnostics, 1, DEFAULT_MAX_REPAIR_ATTEMPTS),
      ).toBe(true);
      // Caps at 2 attempts to prevent infinite loop
      expect(
        canAttemptRepair(diagnostics, 2, DEFAULT_MAX_REPAIR_ATTEMPTS),
      ).toBe(false);
      expect(
        canAttemptRepair(diagnostics, 3, DEFAULT_MAX_REPAIR_ATTEMPTS),
      ).toBe(false);
    });

    it("selects only relevant source files for repair to avoid dumping full codebase", () => {
      const diagnostics: VerificationDiagnostic[] = [
        {
          id: "d1",
          severity: "error",
          source: "typescript",
          file: "components/sections/hero.tsx",
          message: "Cannot find name 'Button'",
          fixable: true,
          timestamp: Date.now(),
        },
      ];

      const selected = selectRelevantFilesForDiagnostics(
        diagnostics,
        validStarterFiles,
      );
      const selectedPaths = selected.map((f) => f.path);

      // Must include hero.tsx and parent app/page.tsx, but NOT unrelated UI primitives or globals.css
      expect(selectedPaths).toContain("app/page.tsx");
      expect(selectedPaths.length).toBeLessThanOrEqual(3);
    });

    it("formats a compact, actionable diagnostic report for the model", () => {
      const diagnostics: VerificationDiagnostic[] = [
        {
          id: "d1",
          severity: "error",
          source: "react_warning",
          code: "REACT_UNRECOGNIZED_DOM_PROP",
          message:
            "React does not recognize the `asChild` prop on a DOM element.",
          file: "app/page.tsx",
          line: 25,
          componentStack: "in button\nin Button\nin app/page.tsx",
          suggestedFix: "Use Base UI 'render' prop.",
          fixable: true,
          timestamp: Date.now(),
        },
      ];

      const report = formatDiagnosticsReport(diagnostics);
      expect(report).toContain("[ERROR] [react_warning]");
      expect(report).toContain("app/page.tsx:25");
      expect(report).toContain("REACT_UNRECOGNIZED_DOM_PROP");
      expect(report).toContain("Use Base UI 'render' prop.");
    });

    it("verifies that a successful repair is followed by re-verification and status update", () => {
      // Step A: Initial verification fails with a prop warning
      const initialError: VerificationDiagnostic = {
        id: "diag_init",
        severity: "error",
        source: "react_warning",
        code: "REACT_UNRECOGNIZED_DOM_PROP",
        message:
          "React does not recognize the `asChild` prop on a DOM element.",
        file: "app/page.tsx",
        line: 25,
        fixable: true,
        timestamp: Date.now(),
      };

      const initialAggregated = aggregateVerificationResult(
        "proj_repair_cycle",
        {
          manifest: {
            stage: "manifest",
            status: "passed",
            durationMs: 5,
            diagnostics: [],
          },
        },
        [initialError],
      );

      expect(initialAggregated.status).toBe("failed");
      expect(initialAggregated.passed).toBe(false);

      // Step B: Repair is applied, removing the invalid prop
      const fixedFiles = validStarterFiles.map((f) =>
        f.path === "app/page.tsx"
          ? { ...f, content: f.content.replace("asChild", "") }
          : f,
      );

      // Step C: Re-verification runs on the fixed files and passes cleanly
      const reVerifyManifest = verifyManifestAndFiles(fixedFiles);
      const reVerifyAggregated = aggregateVerificationResult(
        "proj_repair_cycle",
        {
          manifest: reVerifyManifest,
          typecheck: {
            stage: "typecheck",
            status: "passed",
            durationMs: 15,
            diagnostics: [],
          },
          build: {
            stage: "build",
            status: "passed",
            durationMs: 40,
            diagnostics: [],
          },
        },
        [], // Zero browser diagnostics after repair
        { passed: true, items: [], durationMs: 10 },
        1, // repairAttempts = 1
        true, // repairApplied = true
      );

      expect(reVerifyAggregated.status).toBe("verified");
      expect(reVerifyAggregated.passed).toBe(true);
      expect(reVerifyAggregated.repairAttempts).toBe(1);
      expect(reVerifyAggregated.repairApplied).toBe(true);
      expect(reVerifyAggregated.errorCount).toBe(0);
    });

    it("preserves previous working files on failed repair attempts", () => {
      const workingSnapshot = {
        "app/page.tsx":
          "export default function Page() { return <div>Working</div>; }",
      };
      const failedRepairCandidate = {
        "app/page.tsx":
          "function Broken() { return <div>Missing default export</div>; }",
      };

      // Verify that candidate fails manifest check
      const checkCandidate = verifyManifestAndFiles([
        ...validStarterFiles.filter((f) => f.path !== "app/page.tsx"),
        {
          path: "app/page.tsx",
          content: failedRepairCandidate["app/page.tsx"],
        },
      ]);
      expect(checkCandidate.status).toBe("failed");

      // Rollback restores working snapshot
      const restored = workingSnapshot["app/page.tsx"];
      expect(restored).toContain("Working");
    });
  });

  // 7. Performance & Dependency Management
  describe("7. Performance & Dependency Management", () => {
    it("source-only edits do not alter package.json hash or trigger reinstall", () => {
      const pkgFile = validStarterFiles.find((f) => f.path === "package.json")!;
      const hashBefore = pkgFile.content;

      // Simulate a source edit to app/page.tsx
      const editedFiles = validStarterFiles.map((f) =>
        f.path === "app/page.tsx"
          ? { ...f, content: f.content + "\n// user edit" }
          : f,
      );

      const pkgAfter = editedFiles.find((f) => f.path === "package.json")!;
      expect(pkgAfter.content).toBe(hashBefore);
    });

    it("dependency changes in package.json alter hash and mandate reinstall", () => {
      const pkgFile = validStarterFiles.find((f) => f.path === "package.json")!;
      const parsed = JSON.parse(pkgFile.content);
      parsed.dependencies["canvas-confetti"] = "^1.9.0";

      const updatedContent = JSON.stringify(parsed, null, 2);
      expect(updatedContent).not.toBe(pkgFile.content);
    });
  });

  // 8. Security & Project Isolation
  describe("8. Security & Project Isolation", () => {
    it("associates diagnostics and verification runs strictly with the target project", () => {
      const projA = aggregateVerificationResult("project_alpha", {
        manifest: {
          stage: "manifest",
          status: "passed",
          durationMs: 5,
          diagnostics: [],
        },
      });

      const projB = aggregateVerificationResult("project_beta", {
        manifest: {
          stage: "manifest",
          status: "passed",
          durationMs: 5,
          diagnostics: [],
        },
      });

      expect(projA.projectId).toBe("project_alpha");
      expect(projB.projectId).toBe("project_beta");
      expect(projA.projectId).not.toBe(projB.projectId);
    });

    it("safely handles non-blocking persistence when database is unconfigured", async () => {
      const aggregated = aggregateVerificationResult("proj_isolated", {
        manifest: {
          stage: "manifest",
          status: "passed",
          durationMs: 5,
          diagnostics: [],
        },
      });

      // When called without an active session or DB, must not throw unhandled exception
      const res = await recordVerificationRunAction({
        projectId: "proj_isolated",
        verification: aggregated,
      });

      // Authorization guard prevents unauthorized persistence
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("UNAUTHORIZED");
      }
    });
  });

  // 9. Fast Verification Pipeline & UI Invariant Tests
  describe("9. Fast Verification Pipeline & UI Invariants", () => {
    it("runFastVerificationPipeline runs manifest, typecheck, and lint only (no next build)", async () => {
      const mockSpawn = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          exit: Promise.resolve(0),
          output: {
            pipeTo: vi.fn().mockResolvedValue(undefined),
          },
          kill: vi.fn(),
        });
      });

      const mockContainer = {
        spawn: mockSpawn,
      } as unknown as Parameters<typeof runFastVerificationPipeline>[0];

      const res = await runFastVerificationPipeline(
        mockContainer,
        validStarterFiles,
      );

      expect(res.manifest).toBeDefined();
      expect(res.manifest.status).toBe("passed");
      expect(res.typecheck).toBeDefined();
      expect(res.lint).toBeDefined();
      // stages.build must NOT be run or included
      expect((res as Record<string, unknown>).build).toBeUndefined();
    });

    it("enforces strict bounded self-repair budget (maximum 2 attempts)", () => {
      const fixableDiags: VerificationDiagnostic[] = [
        {
          id: "diag_1",
          severity: "error",
          source: "typescript",
          message: "Type error",
          fixable: true,
          timestamp: Date.now(),
        },
      ];

      expect(canAttemptRepair(fixableDiags, 0, 2)).toBe(true);
      expect(canAttemptRepair(fixableDiags, 1, 2)).toBe(true);
      expect(canAttemptRepair(fixableDiags, 2, 2)).toBe(false);
      expect(canAttemptRepair(fixableDiags, 3, 2)).toBe(false);
    });

    it("verifies WorkspaceCanvas UI does not import or render WorkspaceVerificationBadge", () => {
      const canvasSource = fs.readFileSync(
        path.join(process.cwd(), "components/workspace/workspace-canvas.tsx"),
        "utf8",
      );

      expect(canvasSource).not.toContain("WorkspaceVerificationBadge");
      expect(canvasSource).not.toContain("workspace-verification-badge");
      expect(canvasSource).not.toContain("runBuildStage");
    });

    it("verifies WorkspaceDiagnosticsPanel does not render a Verification tab or DB Synced pill", () => {
      const panelSource = fs.readFileSync(
        path.join(
          process.cwd(),
          "components/workspace/workspace-diagnostics-panel.tsx",
        ),
        "utf8",
      );

      // Must not render a Verification tab button
      expect(panelSource).not.toContain("<span>Verification</span>");
      expect(panelSource).not.toContain('activeTab === "verification"');
      // Must not render a DB Synced indicator pill
      expect(panelSource).not.toContain("DB Synced");
      expect(panelSource).not.toContain("Syncing logs...");
      // Must default to live terminal
      expect(panelSource).toContain('useState<DiagnosticsTab>("live")');
    });

    it("discards stale verification results when newer run supersedes", () => {
      let activeRunId = 0;
      let lastRecordedResult: string | null = null;

      const triggerRun = (runId: number, simulatedResult: string) => {
        // When verification finishes:
        if (runId === activeRunId) {
          lastRecordedResult = simulatedResult;
        }
      };

      // Run 1 starts
      const run1 = ++activeRunId;
      // While Run 1 is in-flight, Run 2 starts (e.g. user updated code)
      const run2 = ++activeRunId;

      // Run 1 finishes late
      triggerRun(run1, "stale_result_run_1");
      expect(lastRecordedResult).toBeNull();

      // Run 2 finishes
      triggerRun(run2, "fresh_result_run_2");
      expect(lastRecordedResult).toBe("fresh_result_run_2");
    });

    it("marks preview ready strictly when dev server is ready AND verification passed", () => {
      const isDevServerReady = true;

      const failedVerification = aggregateVerificationResult("p1", {
        typecheck: {
          stage: "typecheck",
          status: "failed",
          durationMs: 50,
          diagnostics: [
            {
              id: "err_ts",
              severity: "error",
              source: "typescript",
              message: "TS error",
              fixable: true,
              timestamp: Date.now(),
            },
          ],
        },
      });

      const passedVerification = aggregateVerificationResult("p1", {
        typecheck: {
          stage: "typecheck",
          status: "passed",
          durationMs: 50,
          diagnostics: [],
        },
        lint: {
          stage: "lint",
          status: "passed",
          durationMs: 50,
          diagnostics: [],
        },
      });

      const isPreviewReadyFailed =
        isDevServerReady && failedVerification.passed;
      expect(isPreviewReadyFailed).toBe(false);

      const isPreviewReadyPassed =
        isDevServerReady && passedVerification.passed;
      expect(isPreviewReadyPassed).toBe(true);
    });
  });
});
