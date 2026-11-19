/**
 * Structural syntax and integrity validator for AI-generated code.
 * Detects truncated responses, unbalanced braces/brackets, unterminated strings/templates,
 * unclosed JSX tags, missing exports, and disallowed patterns without running full compiler.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2 and Prompt §3, §8.
 */

export type SyntaxValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly error: string; readonly line?: number };

/**
 * Validates that string literals, template literals, comments, and brackets
 * are completely closed and not truncated.
 */
export function validateSourceIntegrity(
  filePath: string,
  content: string,
): SyntaxValidationResult {
  if (!content || !content.trim()) {
    return { valid: false, error: `File "${filePath}" is empty.` };
  }

  const trimmed = content.trim();

  // 1. Detect obvious truncation markers or trailing incomplete tokens
  if (
    /\/\/\s*\.\.\.\s*(rest|existing|code|truncated)/i.test(trimmed) ||
    /\/\*\s*\.\.\.\s*(rest|existing|code|truncated)\s*\*\//i.test(trimmed)
  ) {
    return {
      valid: false,
      error: `File "${filePath}" contains incomplete ellipsis truncation comments.`,
    };
  }

  // Trailing dangling tag or attribute truncation, e.g.: `<button className="...` or `text-[#FD`
  if (
    /<[A-Za-z0-9_-]+\s+[^>]*$/.test(trimmed) ||
    /<\/[A-Za-z0-9_-]*$/.test(trimmed) ||
    /=\s*["'][^"']*$/.test(trimmed)
  ) {
    return {
      valid: false,
      error: `File "${filePath}" appears truncated at the end (unclosed JSX tag or attribute).`,
    };
  }

  // 2. Lexical Bracket & Literal Balance Scanner
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateLiteral = false;
  let inLineComment = false;
  let inBlockComment = false;

  const bracketStack: Array<{ char: string; line: number }> = [];
  let lineNumber = 1;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    const next = i + 1 < trimmed.length ? trimmed[i + 1] : "";
    const prev = i > 0 ? trimmed[i - 1] : "";

    if (ch === "\n") {
      lineNumber++;
      inLineComment = false;
      continue;
    }

    // Handle comments
    if (inLineComment) continue;
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inTemplateLiteral) {
      if (ch === "/" && next === "/") {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
    }

    // Handle string & template escapes
    const isEscaped = prev === "\\" && (i < 2 || trimmed[i - 2] !== "\\");

    if (inSingleQuote) {
      if (ch === "'" && !isEscaped) inSingleQuote = false;
      continue;
    }

    if (inDoubleQuote) {
      if (ch === '"' && !isEscaped) inDoubleQuote = false;
      continue;
    }

    if (inTemplateLiteral) {
      if (ch === "`" && !isEscaped) {
        inTemplateLiteral = false;
      } else if (ch === "$" && next === "{" && !isEscaped) {
        bracketStack.push({ char: "${", line: lineNumber });
        i++;
      }
      continue;
    }

    // Start quotes
    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (ch === "`") {
      inTemplateLiteral = true;
      continue;
    }

    // Brackets
    if (ch === "{" || ch === "(" || ch === "[") {
      bracketStack.push({ char: ch, line: lineNumber });
    } else if (ch === "}") {
      const top = bracketStack.pop();
      if (!top || (top.char !== "{" && top.char !== "${")) {
        return {
          valid: false,
          error: `Unmatched closing brace '}' at line ${lineNumber} in "${filePath}".`,
          line: lineNumber,
        };
      }
    } else if (ch === ")") {
      const top = bracketStack.pop();
      if (!top || top.char !== "(") {
        return {
          valid: false,
          error: `Unmatched closing parenthesis ')' at line ${lineNumber} in "${filePath}".`,
          line: lineNumber,
        };
      }
    } else if (ch === "]") {
      const top = bracketStack.pop();
      if (!top || top.char !== "[") {
        return {
          valid: false,
          error: `Unmatched closing bracket ']' at line ${lineNumber} in "${filePath}".`,
          line: lineNumber,
        };
      }
    }
  }

  if (inSingleQuote || inDoubleQuote || inTemplateLiteral) {
    return {
      valid: false,
      error: `File "${filePath}" ends with an unterminated string or template literal (truncated).`,
      line: lineNumber,
    };
  }

  if (inBlockComment) {
    return {
      valid: false,
      error: `File "${filePath}" ends with an unclosed block comment (truncated).`,
      line: lineNumber,
    };
  }

  if (bracketStack.length > 0) {
    const unclosed = bracketStack[bracketStack.length - 1];
    return {
      valid: false,
      error: `File "${filePath}" has unclosed '${unclosed.char}' opened at line ${unclosed.line} (truncated).`,
      line: unclosed.line,
    };
  }

  // 3. Export validation for components
  if (filePath === "app/page.tsx") {
    const hasDefaultExport =
      /export\s+default\s+(?:function\s+|class\s+|[A-Za-z0-9_]+)/.test(trimmed);
    if (!hasDefaultExport) {
      return {
        valid: false,
        error: `File "${filePath}" must contain an "export default" component.`,
      };
    }
  } else if (
    filePath.startsWith("components/") &&
    (filePath.endsWith(".tsx") || filePath.endsWith(".jsx"))
  ) {
    const hasExport =
      /export\s+(?:default\s+|function\s+|const\s+|class\s+|async\s+function\s+)/.test(
        trimmed,
      );
    if (!hasExport) {
      return {
        valid: false,
        error: `Component file "${filePath}" does not export any component.`,
      };
    }
  }

  // 4. Base UI asChild prohibition check
  if (
    /\bButton\b[^>]*\basChild\b/i.test(trimmed) ||
    /\bDialogTrigger\b[^>]*\basChild\b/i.test(trimmed)
  ) {
    return {
      valid: false,
      error: `File "${filePath}" uses unsupported Radix-style 'asChild' prop. Foundry's Base UI primitives require the 'render={<Component />}' prop pattern.`,
    };
  }

  return { valid: true };
}

/**
 * Validates that app/page.tsx actually renders the required sections.
 */
export function validatePageSectionComposition(
  pageContent: string,
  requiredSectionNames: readonly string[],
): { readonly valid: boolean; readonly missingSections: readonly string[] } {
  const missing: string[] = [];

  for (const rawName of requiredSectionNames) {
    const normalized = rawName.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (!normalized) continue;

    // Check if component is rendered in JSX: <SectionName or <section-name
    // Or component import name exists in the page
    const found =
      pageContent.toLowerCase().includes(`<${normalized}`) ||
      pageContent.toLowerCase().includes(`<${rawName.toLowerCase()}`) ||
      new RegExp(`<[A-Za-z0-9_]*${normalized}[A-Za-z0-9_]*`, "i").test(
        pageContent,
      );

    if (!found) {
      missing.push(rawName);
    }
  }

  return {
    valid: missing.length === 0,
    missingSections: missing,
  };
}
