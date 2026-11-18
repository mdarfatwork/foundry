import type { VerificationDiagnostic } from "./types";
import type { FileRecord } from "./runner";

/**
 * AI self-repair coordinator.
 * Prepares compact error reports, selects only affected source files,
 * enforces retry budgets, and manages version snapshots for safe rollback.
 * Adheres strictly to AGENTS.md §1, §5.2, §5.3, and Project Prompt §6.
 */

export const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;

/**
 * Formats a compact, structured diagnostics report for the AI repair model.
 */
export function formatDiagnosticsReport(
  diagnostics: readonly VerificationDiagnostic[],
): string {
  const fixable = diagnostics.filter((d) => d.fixable);
  if (fixable.length === 0) {
    return "No fixable diagnostics reported.";
  }

  return fixable
    .map((d, i) => {
      const parts = [
        `${i + 1}. [${d.severity.toUpperCase()}] [${d.source}] ${d.code ? `(${d.code}) ` : ""}${d.message}`,
      ];

      if (d.file) {
        parts.push(
          `   Location: ${d.file}${d.line ? `:${d.line}` : ""}${d.column ? `:${d.column}` : ""}`,
        );
      }

      if (d.componentStack) {
        parts.push(
          `   Component Stack:\n   ${d.componentStack.trim().replace(/\n/g, "\n   ")}`,
        );
      }

      if (d.suggestedFix) {
        parts.push(`   Suggested Fix: ${d.suggestedFix}`);
      }

      return parts.join("\n");
    })
    .join("\n\n");
}

/**
 * Selects only the subset of files related to the reported diagnostics.
 * Prevents dumping the entire repository into repair prompts.
 */
export function selectRelevantFilesForDiagnostics(
  diagnostics: readonly VerificationDiagnostic[],
  allFiles: readonly FileRecord[],
): readonly FileRecord[] {
  const targetFilePaths = new Set<string>();

  for (const d of diagnostics) {
    if (d.file) {
      // Normalize path
      let cleanPath = d.file.replace(/\\/g, "/").replace(/^\/+/, "");
      if (cleanPath.startsWith("./")) cleanPath = cleanPath.slice(2);
      targetFilePaths.add(cleanPath);

      // If error is in a component, also inspect app/page.tsx for composition issues
      if (cleanPath.startsWith("components/")) {
        targetFilePaths.add("app/page.tsx");
      }
    }
  }

  // If no specific file was extracted, fallback to app/page.tsx
  if (targetFilePaths.size === 0) {
    targetFilePaths.add("app/page.tsx");
  }

  const selected = allFiles.filter((f) => targetFilePaths.has(f.path));

  // If selected is still empty, include app/page.tsx if present
  if (selected.length === 0) {
    const page = allFiles.find((f) => f.path === "app/page.tsx");
    return page ? [page] : allFiles.slice(0, 3);
  }

  return selected;
}

/**
 * Determines whether self-repair can be attempted within the bounded budget.
 */
export function canAttemptRepair(
  diagnostics: readonly VerificationDiagnostic[],
  currentAttempts: number,
  maxAttempts = DEFAULT_MAX_REPAIR_ATTEMPTS,
): boolean {
  if (currentAttempts >= maxAttempts) {
    return false;
  }

  const hasFixableError = diagnostics.some(
    (d) =>
      d.fixable &&
      (d.severity === "error" ||
        d.severity === "fatal" ||
        (d.severity === "warning" && d.source === "react_warning")),
  );

  return hasFixableError;
}
