import type {
  VerificationDiagnostic,
  DiagnosticSeverity,
  DiagnosticSource,
  BrowserDiagnosticPayload,
} from "./types";

/**
 * Diagnostic normalization, extraction, and deduplication engine.
 * Parses compiler, linter, build, dev server, and browser runtime diagnostics.
 * Adheres strictly to AGENTS.md §1, §5.2, §5.3, and Project Prompt §5.A, §5.B, §6.
 */

/**
 * Generates a stable deterministic fingerprint hash for a diagnostic to prevent duplicates.
 */
export function getDiagnosticFingerprint(
  source: DiagnosticSource,
  message: string,
  file?: string,
  line?: number,
  code?: string,
): string {
  const normMsg = message
    .replace(/\s+/g, " ")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "",
    )
    .slice(0, 140)
    .trim();

  return `${source}:${code ?? "none"}:${file ?? "unknown"}:${line ?? 0}:${normMsg}`;
}

/**
 * Strips ANSI terminal escape sequences (colors, cursor control, text styling).
 */
export function stripAnsi(input: string): string {
  if (!input || typeof input !== "string") return "";
  return input.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

/**
 * Parses raw output from `tsc --noEmit`.
 * Example (Format A): `app/page.tsx(14,5): error TS2322: Type 'string' is not assignable to type 'number'.`
 * Example (Format B): `components/sections/cta.tsx:1:30 - error TS1125: Hexadecimal digit expected.`
 */
export function parseTypeScriptDiagnostics(
  output: string,
): readonly VerificationDiagnostic[] {
  if (!output || typeof output !== "string") return [];

  const cleanOutput = stripAnsi(output);
  const diagnostics: VerificationDiagnostic[] = [];
  const lines = cleanOutput.split(/\r?\n/);
  // Format A: app/page.tsx(14,5): error TS2322: ...
  const tsFormatARegex =
    /^([^(]+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;
  // Format B: app/page.tsx:14:5 - error TS2322: ...
  const tsFormatBRegex =
    /^([^:]+):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match =
      trimmed.match(tsFormatARegex) || trimmed.match(tsFormatBRegex);
    if (match) {
      const [, rawFile, lineStr, colStr, severityStr, code, message] = match;
      const file = rawFile
        .replace(/\\/g, "/")
        .replace(/^(?:\/home\/[^/]+\/|\.\/)/, "")
        .trim();
      const lineNum = parseInt(lineStr, 10);
      const colNum = parseInt(colStr, 10);
      const severity: DiagnosticSeverity =
        severityStr === "warning" ? "warning" : "error";

      diagnostics.push({
        id: `ts_${code}_${file.replace(/[^a-zA-Z0-9]/g, "_")}_${lineNum}_${colNum}`,
        severity,
        source: "typescript",
        message: message.trim(),
        file,
        line: lineNum,
        column: colNum,
        code,
        fixable: true,
        timestamp: Date.now(),
      });
    }
  }

  return deduplicateDiagnostics(diagnostics);
}

/**
 * Parses raw output from ESLint.
 * Handles stylish format: `app/page.tsx: line 14, col 5, Error - 'foo' is defined but never used. (no-unused-vars)`
 * or standard: `app/page.tsx\n  14:5  error  'foo' is defined but never used  no-unused-vars`
 * Handles syntax/parsing errors where rule ID is omitted.
 */
export function parseESLintDiagnostics(
  output: string,
): readonly VerificationDiagnostic[] {
  if (!output || typeof output !== "string") return [];

  const cleanOutput = stripAnsi(output);
  const diagnostics: VerificationDiagnostic[] = [];
  const lines = cleanOutput.split(/\r?\n/);
  let currentFile = "";

  const standardLineRegex =
    /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s+([a-zA-Z0-9@_/-]+))?$/;
  const stylishFileRegex =
    /^(?:\/home\/[^/]+\/|\.\/)?([a-zA-Z0-9._/-]+\.[a-zA-Z0-9]+)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const fileMatch = trimmed.match(stylishFileRegex);
    if (
      fileMatch &&
      (trimmed.endsWith(".tsx") ||
        trimmed.endsWith(".ts") ||
        trimmed.endsWith(".js") ||
        trimmed.endsWith(".jsx"))
    ) {
      currentFile = fileMatch[1]
        .replace(/\\/g, "/")
        .replace(/^(?:\/home\/[^/]+\/|\.\/)/, "")
        .trim();
      continue;
    }

    const match = line.match(standardLineRegex);
    if (match) {
      const [, lineStr, colStr, severityStr, message, ruleId] = match;
      const lineNum = parseInt(lineStr, 10);
      const colNum = parseInt(colStr, 10);
      const severity: DiagnosticSeverity =
        severityStr === "warning" ? "warning" : "error";
      const code = ruleId || "eslint_syntax_error";

      diagnostics.push({
        id: `eslint_${code}_${currentFile.replace(/[^a-zA-Z0-9]/g, "_")}_${lineNum}`,
        severity,
        source: "eslint",
        message: message.trim(),
        file: currentFile || undefined,
        line: lineNum,
        column: colNum,
        code,
        fixable: true,
        timestamp: Date.now(),
      });
    }
  }

  return deduplicateDiagnostics(diagnostics);
}

/**
 * Parses Next.js production build (`next build`) output.
 * Detects module not found, compile errors, export issues, and route errors.
 */
export function parseNextBuildDiagnostics(
  output: string,
): readonly VerificationDiagnostic[] {
  if (!output || typeof output !== "string") return [];

  const cleanOutput = stripAnsi(output);
  const diagnostics: VerificationDiagnostic[] = [];
  const lines = cleanOutput.split(/\r?\n/);

  // Patterns for Next.js build errors
  // Pattern 1: ./app/page.tsx:12:5 Type error: ...
  const nextTypeErrorRegex =
    /^\s*\.\/([^:]+):(\d+):(\d+)\s+(Type error|Error):\s+(.+)$/;
  // Pattern 1b: ./app/page.tsx:12:5 (filename on its own line)
  const nextFilePosRegex = /^\s*\.\/([^:]+):(\d+):(\d+)\s*$/;
  // Pattern 2: Module not found: Can't resolve '@/foo' in '...'
  const moduleNotFoundRegex =
    /Module not found: Can't resolve '([^']+)' in '([^']+)'/;
  // Pattern 3: Failed to compile.
  const failedToCompileRegex = /Failed to compile\./;

  let hasSpecificDiagnostic = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const typeMatch = line.match(nextTypeErrorRegex);
    if (typeMatch) {
      const [, rawFile, lineStr, colStr, errType, message] = typeMatch;
      const file = rawFile.replace(/\\/g, "/").trim();
      const lineNum = parseInt(lineStr, 10);
      const colNum = parseInt(colStr, 10);

      diagnostics.push({
        id: `build_type_${file.replace(/[^a-zA-Z0-9]/g, "_")}_${lineNum}`,
        severity: "error",
        source: "build",
        message: `${errType}: ${message.trim()}`,
        file,
        line: lineNum,
        column: colNum,
        code: "NEXT_BUILD_TYPE_ERROR",
        fixable: true,
        timestamp: Date.now(),
      });
      hasSpecificDiagnostic = true;
      continue;
    }

    const posMatch = line.match(nextFilePosRegex);
    if (posMatch && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      const nextTypeMatch = nextLine.match(/^(Type error|Error):\s+(.+)$/);
      if (nextTypeMatch) {
        const [, rawFile, lineStr, colStr] = posMatch;
        const [, errType, message] = nextTypeMatch;
        const file = rawFile.replace(/\\/g, "/").trim();
        const lineNum = parseInt(lineStr, 10);
        const colNum = parseInt(colStr, 10);

        diagnostics.push({
          id: `build_type_${file.replace(/[^a-zA-Z0-9]/g, "_")}_${lineNum}`,
          severity: "error",
          source: "build",
          message: `${errType}: ${message.trim()}`,
          file,
          line: lineNum,
          column: colNum,
          code: "NEXT_BUILD_TYPE_ERROR",
          fixable: true,
          timestamp: Date.now(),
        });
        hasSpecificDiagnostic = true;
        i++; // skip next line
        continue;
      }
    }

    const modMatch = line.match(moduleNotFoundRegex);
    if (modMatch) {
      const [, missingMod, inLocation] = modMatch;
      diagnostics.push({
        id: `build_mod_${missingMod.replace(/[^a-zA-Z0-9]/g, "_")}`,
        severity: "error",
        source: "build",
        message: `Module not found: Cannot resolve '${missingMod}' in '${inLocation}'`,
        file: inLocation.replace(/\\/g, "/"),
        code: "MODULE_NOT_FOUND",
        fixable: true,
        suggestedFix: `Check import path for '${missingMod}' or add to package.json.`,
        timestamp: Date.now(),
      });
      hasSpecificDiagnostic = true;
      continue;
    }
  }

  // Fallback: If "Failed to compile" is present but no specific diagnostic was parsed,
  // capture the compilation error block
  if (!hasSpecificDiagnostic) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (failedToCompileRegex.test(line)) {
        const nextLines = lines
          .slice(i + 1, i + 5)
          .join(" ")
          .trim();
        if (nextLines) {
          diagnostics.push({
            id: `build_compile_fail_${i}`,
            severity: "error",
            source: "build",
            message: `Failed to compile: ${nextLines.slice(0, 300)}`,
            code: "BUILD_FAILED",
            fixable: true,
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  return deduplicateDiagnostics(diagnostics);
}

/**
 * Classifies a browser runtime diagnostic or React warning.
 * Extracts prop leakage, key warnings, hydration errors, invalid nesting, and unhandled exceptions.
 * Crucially: general purpose - does NOT hardcode `asChild`.
 */
export function classifyBrowserDiagnostic(
  payload: BrowserDiagnosticPayload,
): VerificationDiagnostic {
  const msg = payload.message;
  let severity: DiagnosticSeverity =
    payload.severity === "error" ? "error" : "warning";
  let code = "RUNTIME_DIAGNOSTIC";
  const fixable = true;
  let file: string | undefined;
  let line = payload.line;
  let column = payload.column;
  let suggestedFix: string | undefined;

  // 1. General React Unrecognized DOM Prop Warning:
  // "Warning: React does not recognize the `xyz` prop on a DOM element..."
  const unrecognizedPropMatch = msg.match(
    /React does not recognize the\s+[`'"]?([a-zA-Z0-9_-]+)[`'"]?\s+prop on a DOM element/i,
  );
  if (unrecognizedPropMatch) {
    const propName = unrecognizedPropMatch[1];
    code = "REACT_UNRECOGNIZED_DOM_PROP";
    severity = "error"; // Treat prop leakage as an actionable error to be repaired
    suggestedFix = `Remove '${propName}' from native DOM element or check component composition. If using Base UI primitives, use 'render={<Component />}' instead of passing unsupported props.`;
  }

  // 2. React Missing Key in List:
  // "Warning: Each child in a list should have a unique "key" prop."
  if (
    /Each child in a list should have a unique\s+[`'"]?key[`'"]?\s+prop/i.test(
      msg,
    )
  ) {
    code = "REACT_MISSING_KEY";
    severity = "warning";
    suggestedFix =
      "Add a unique key prop to each item rendered in a map() loop.";
  }

  // 3. React Hydration Mismatch:
  if (
    /hydration failed|did not match|Extra attributes from the server/i.test(msg)
  ) {
    code = "REACT_HYDRATION_MISMATCH";
    severity = "error";
    suggestedFix =
      "Ensure rendered HTML on server matches initial client render. Wrap non-deterministic values or window access in useEffect or useSyncExternalStore.";
  }

  // 4. React Invalid DOM Nesting:
  // "Warning: validateDOMNesting(...): <a> cannot appear as a descendant of <a>."
  const nestingMatch = msg.match(
    /validateDOMNesting\(\.\.\.\):\s+(<[^>]+>)\s+cannot appear as a descendant of\s+(<[^>]+>)/i,
  );
  if (nestingMatch) {
    code = "REACT_INVALID_DOM_NESTING";
    severity = "warning";
    suggestedFix = `Avoid nesting ${nestingMatch[1]} inside ${nestingMatch[2]}. Use valid HTML structure.`;
  }

  // 5. Unhandled runtime exception or syntax error:
  if (payload.source === "runtime_exception") {
    code = "UNCAUGHT_EXCEPTION";
    severity = "error";
  }

  // 6. Network failure:
  if (payload.source === "network") {
    code = "RESOURCE_NOT_FOUND";
    severity = "warning";
  }

  // Extract file and line from component stack or stack trace if available
  if (payload.componentStack) {
    const stackFileMatch =
      payload.componentStack.match(/\(at\s+([^:\s()]+):(\d+)(?::(\d+))?\)/) ||
      payload.componentStack.match(
        /at\s+(?:[A-Za-z0-9_]+\s+)?\(?([^:\s()]+):(\d+)(?::(\d+))?\)?/,
      );
    if (stackFileMatch) {
      file = stackFileMatch[1].replace(/\\/g, "/");
      line = parseInt(stackFileMatch[2], 10);
      column = stackFileMatch[3] ? parseInt(stackFileMatch[3], 10) : undefined;
    }
  } else if (payload.stack) {
    const fileMatch =
      payload.stack.match(/at\s+.*?\(([^:]+):(\d+):(\d+)\)/) ||
      payload.stack.match(/at\s+([^:]+):(\d+):(\d+)/);
    if (fileMatch) {
      file = fileMatch[1].replace(/\\/g, "/");
      line = parseInt(fileMatch[2], 10);
      column = parseInt(fileMatch[3], 10);
    }
  }

  // Normalize path if pointing to app, components, or lib
  if (file) {
    const normalizedFile = file.replace(
      /^(?:https?:\/\/[^/]+)?(?:\/_next\/static\/chunks\/)?/,
      "",
    );
    const appMatch = normalizedFile.match(
      /(?:app|components|lib)\/[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+/,
    );
    if (appMatch) {
      file = appMatch[0];
    }
  }

  return {
    id: `browser_${code}_${Math.random().toString(36).substring(2, 8)}`,
    severity,
    source:
      payload.source === "react_warning"
        ? "react_warning"
        : payload.source === "runtime_exception"
          ? "runtime_exception"
          : payload.source === "network"
            ? "network"
            : "browser_console",
    message: msg.trim(),
    file,
    line,
    column,
    code,
    stack: payload.stack,
    componentStack: payload.componentStack,
    fixable,
    suggestedFix,
    timestamp: payload.timestamp || Date.now(),
  };
}

/**
 * Deduplicates an array of diagnostics based on their fingerprint hash.
 */
export function deduplicateDiagnostics(
  diagnostics: readonly VerificationDiagnostic[],
): readonly VerificationDiagnostic[] {
  const seen = new Set<string>();
  const result: VerificationDiagnostic[] = [];

  for (const diag of diagnostics) {
    const fp = getDiagnosticFingerprint(
      diag.source,
      diag.message,
      diag.file,
      diag.line,
      diag.code,
    );

    if (!seen.has(fp)) {
      seen.add(fp);
      result.push(diag);
    }
  }

  return result;
}
