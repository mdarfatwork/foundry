import { normalize } from "path/posix";
import type { FileModification, ValidationResult } from "./types";
import {
  validateSourceIntegrity,
  validatePageSectionComposition,
} from "./syntax-validator";

/**
 * Validates AI-generated file modifications before saving.
 * Treats all model output as untrusted and strictly enforces tenant and file-system boundaries.
 * Adheres to AGENTS.md §1, §5.2, and Prompt §7.
 */

const MAX_FILE_SIZE_BYTES = 150 * 1024; // 150 KB per file
const MAX_TOTAL_SIZE_BYTES = 500 * 1024; // 500 KB total per generation
const MAX_FILES_PER_REQUEST = 20;

// Allowed top-level directories for user application files
const ALLOWED_DIRECTORIES = ["app/", "components/", "lib/", "public/"] as const;

// Disallowed files that must not be modified or overwritten by AI generation
const DISALLOWED_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "postcss.config.mjs",
  "postcss.config.js",
  "components.json",
  "drizzle.config.ts",
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.example",
  ".gitignore",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]);

// Disallowed directory paths
const DISALLOWED_DIR_PREFIXES = [
  "node_modules/",
  ".git/",
  ".github/",
  ".next/",
  "scripts/",
  "drizzle/",
  "tests/",
  ".husky/",
  ".agents/",
  "config/",
];

// Dangerous server patterns that should not appear in user frontend code
const DANGEROUS_CODE_PATTERNS = [
  /process\.env\.DATABASE_URL/i,
  /process\.env\.NVIDIA_API_KEY/i,
  /process\.env\.BETTER_AUTH_SECRET/i,
  /process\.env\.GOOGLE_CLIENT_SECRET/i,
  /require\s*\(\s*['"]child_process['"]\s*\)/i,
  /import\s+.*\s+from\s+['"]child_process['"]/i,
  /import\s+.*\s+from\s+['"]fs['"]/i,
  /require\s*\(\s*['"]fs['"]\s*\)/i,
];

/**
 * Automatically cleans known trivial corruption patterns in generated code before validation:
 * 1. Corrupted import paths like `\u00components/` or `\u0040/` or un-aliased `components/ui/`
 * 2. Relative traversal in internal import statements
 */
export function sanitizeGeneratedContent(content: string): string {
  if (!content || typeof content !== "string") return content;

  let sanitized = content;

  // Fix corrupted import paths:
  // 1. "\u00components/..." -> "@/components/..."
  sanitized = sanitized.replace(/(['"])\\u00components\//g, "$1@/components/");
  // 2. "\u0040/..." -> "@/..."
  sanitized = sanitized.replace(/(['"])\\u0040\//g, "$1@/");
  // 3. Fallback "\u00..." -> "@/..."
  sanitized = sanitized.replace(/(['"])\\u00/g, "$1@/");

  // Fix un-aliased internal imports: from "components/ui/..." -> from "@/components/ui/..."
  sanitized = sanitized.replace(
    /(from\s+['"])(?:(?:\.\.\/)+|\/)?(components\/|lib\/)/g,
    "$1@/$2",
  );

  return sanitized;
}

/**
 * Normalizes a file path to POSIX relative form, eliminating Windows backslashes
 * and directory traversal attempts.
 */
export function normalizeRelativePath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== "string" || !rawPath.trim()) {
    throw new Error("File path must be a non-empty string.");
  }

  // Replace Windows backslashes with forward slashes
  let cleanPath = rawPath.replace(/\\/g, "/").trim();

  // Strip leading slashes to prevent absolute paths
  while (cleanPath.startsWith("/")) {
    cleanPath = cleanPath.slice(1);
  }

  // Normalize via POSIX
  const normalized = normalize(cleanPath);

  // Reject paths that traverse upwards or remain absolute
  if (
    normalized.startsWith("..") ||
    normalized.startsWith("/") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Path traversal detected in file path: "${rawPath}"`);
  }

  return normalized;
}

/**
 * Validates an array of proposed file modifications.
 * Returns { valid: true, files: [...] } or { valid: false, error: "..." }.
 */
export type ValidationOptions = {
  readonly existingFiles?: readonly FileModification[];
  readonly requiredSections?: readonly string[];
  readonly minSections?: number;
};

/**
 * Deterministically synthesizes app/page.tsx when the model generated modular
 * section components (e.g. components/sections/*) but omitted the composition page.
 * Merges existing section files with newly modified section files.
 */
function synthesizePageFromSections(
  newFiles: readonly FileModification[],
  existingFiles: readonly FileModification[] = [],
): FileModification | null {
  const mergedMap = new Map<string, FileModification>();
  for (const f of existingFiles) {
    if (
      f.path.startsWith("components/sections/") &&
      (f.path.endsWith(".tsx") || f.path.endsWith(".jsx"))
    ) {
      mergedMap.set(f.path, f);
    }
  }
  for (const f of newFiles) {
    if (
      f.path.startsWith("components/sections/") &&
      (f.path.endsWith(".tsx") || f.path.endsWith(".jsx"))
    ) {
      mergedMap.set(f.path, f);
    }
  }

  const sectionFiles = Array.from(mergedMap.values()).sort((a, b) => {
    // Keep logical visual order: navbar/header first, hero second, footer last
    const aLower = a.path.toLowerCase();
    const bLower = b.path.toLowerCase();
    if (aLower.includes("nav") || aLower.includes("header")) return -1;
    if (bLower.includes("nav") || bLower.includes("header")) return 1;
    if (aLower.includes("hero")) return -1;
    if (bLower.includes("hero")) return 1;
    if (aLower.includes("footer")) return 1;
    if (bLower.includes("footer")) return -1;
    return a.path.localeCompare(b.path);
  });

  if (sectionFiles.length === 0) return null;

  const imports: string[] = [];
  const componentUsages: string[] = [];

  for (const sf of sectionFiles) {
    const importPath = `@/${sf.path.replace(/\.[^/.]+$/, "")}`;
    const defaultExportMatch = sf.content.match(
      /export\s+default\s+(?:function\s+|class\s+)?([A-Za-z0-9_]+)/,
    );
    const namedExportMatch = sf.content.match(
      /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/,
    );
    const constExportMatch = sf.content.match(
      /export\s+const\s+([A-Za-z0-9_]+)/,
    );

    if (defaultExportMatch && defaultExportMatch[1]) {
      const compName = defaultExportMatch[1];
      imports.push(`import ${compName} from "${importPath}";`);
      componentUsages.push(`      <${compName} />`);
    } else if (namedExportMatch && namedExportMatch[1]) {
      const compName = namedExportMatch[1];
      imports.push(`import { ${compName} } from "${importPath}";`);
      componentUsages.push(`      <${compName} />`);
    } else if (constExportMatch && constExportMatch[1]) {
      const compName = constExportMatch[1];
      imports.push(`import { ${compName} } from "${importPath}";`);
      componentUsages.push(`      <${compName} />`);
    }
  }

  if (componentUsages.length === 0) return null;

  const content = `${imports.join("\n")}

export default function Page() {
  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col">
${componentUsages.join("\n")}
    </main>
  );
}
`;

  return {
    path: "app/page.tsx",
    content,
  };
}

export function validateGeneratedFiles(
  proposedFiles: readonly FileModification[],
  options?: ValidationOptions,
): ValidationResult {
  if (!Array.isArray(proposedFiles)) {
    return {
      valid: false,
      error: "Proposed file modifications must be an array.",
    };
  }

  if (proposedFiles.length === 0) {
    return {
      valid: false,
      error: "AI generation returned an empty file list.",
    };
  }

  if (proposedFiles.length > MAX_FILES_PER_REQUEST) {
    return {
      valid: false,
      error: `Too many files modified in a single generation (maximum is ${MAX_FILES_PER_REQUEST}).`,
    };
  }

  const seenPaths = new Set<string>();
  let totalBytes = 0;
  const validatedFiles: FileModification[] = [];

  for (const file of proposedFiles) {
    if (!file || typeof file !== "object") {
      return {
        valid: false,
        error: "Invalid file entry: expected object with path and content.",
      };
    }

    if (typeof file.content !== "string") {
      return {
        valid: false,
        error: `File "${file.path ?? "unknown"}" content must be a string.`,
      };
    }

    const sanitizedContent = sanitizeGeneratedContent(file.content);
    const trimmedContent = sanitizedContent.trim();
    if (trimmedContent.length === 0) {
      return {
        valid: false,
        error: `File "${file.path}" has empty content. Empty files are not allowed.`,
      };
    }

    // 1. Path Normalization & Traversal Check
    let normalizedPath: string;
    try {
      normalizedPath = normalizeRelativePath(file.path);
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Invalid file path.",
      };
    }

    // 2. Duplicate Path Check
    if (seenPaths.has(normalizedPath)) {
      return {
        valid: false,
        error: `Duplicate file path in generation response: "${normalizedPath}".`,
      };
    }
    seenPaths.add(normalizedPath);

    // 3. Disallowed exact files
    if (DISALLOWED_FILES.has(normalizedPath)) {
      return {
        valid: false,
        error: `Modifying core system configuration file "${normalizedPath}" is not permitted.`,
      };
    }

    // 4. Disallowed directories
    for (const prefix of DISALLOWED_DIR_PREFIXES) {
      if (normalizedPath.startsWith(prefix)) {
        return {
          valid: false,
          error: `Modifying protected directory "${prefix}" is not permitted.`,
        };
      }
    }

    // 5. Allowed directory prefix check
    const isAllowedDir = ALLOWED_DIRECTORIES.some((dir) =>
      normalizedPath.startsWith(dir),
    );
    if (!isAllowedDir) {
      return {
        valid: false,
        error: `File "${normalizedPath}" is outside allowed application directories (${ALLOWED_DIRECTORIES.join(", ")}).`,
      };
    }

    // 6. Size limit check
    const fileBytes = Buffer.byteLength(file.content, "utf8");
    if (fileBytes > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: `File "${normalizedPath}" exceeds the size limit of ${MAX_FILE_SIZE_BYTES / 1024} KB.`,
      };
    }
    totalBytes += fileBytes;

    // 7. Security check against sensitive environment variable leaks
    for (const pattern of DANGEROUS_CODE_PATTERNS) {
      if (pattern.test(file.content)) {
        return {
          valid: false,
          error: `File "${normalizedPath}" contains prohibited server patterns or secret variable access.`,
        };
      }
    }

    // 8. Structural code integrity & truncation check (TSX, TS, JSX, JS)
    if (
      normalizedPath.endsWith(".tsx") ||
      normalizedPath.endsWith(".ts") ||
      normalizedPath.endsWith(".jsx") ||
      normalizedPath.endsWith(".js")
    ) {
      const integrity = validateSourceIntegrity(
        normalizedPath,
        sanitizedContent,
      );
      if (!integrity.valid) {
        return {
          valid: false,
          error: integrity.error,
        };
      }
    }

    // 9. Required entry point structure check
    if (normalizedPath === "app/page.tsx") {
      if (!file.content.includes("export default")) {
        return {
          valid: false,
          error:
            'File "app/page.tsx" must contain an "export default" component.',
        };
      }
    }

    validatedFiles.push({
      path: normalizedPath,
      content: sanitizedContent,
    });
  }

  if (totalBytes > MAX_TOTAL_SIZE_BYTES) {
    return {
      valid: false,
      error: `Total generated code size (${Math.round(totalBytes / 1024)} KB) exceeds limit of ${MAX_TOTAL_SIZE_BYTES / 1024} KB.`,
    };
  }

  // If section components were generated but app/page.tsx was omitted,
  // deterministically synthesize app/page.tsx using all available sections.
  if (!validatedFiles.some((f) => f.path === "app/page.tsx")) {
    const synthesized = synthesizePageFromSections(
      validatedFiles,
      options?.existingFiles,
    );
    if (synthesized) {
      validatedFiles.unshift(synthesized);
    }
  }

  // 10. Completeness & Import/Export Consistency Validation
  const completeFileMap = new Map<string, string>();
  if (options?.existingFiles) {
    for (const ef of options.existingFiles) {
      completeFileMap.set(ef.path, ef.content);
    }
  }
  for (const vf of validatedFiles) {
    completeFileMap.set(vf.path, vf.content);
  }

  const pageFile =
    validatedFiles.find((f) => f.path === "app/page.tsx") ??
    (completeFileMap.has("app/page.tsx")
      ? { path: "app/page.tsx", content: completeFileMap.get("app/page.tsx")! }
      : null);

  if (pageFile) {
    // Validate that all components imported from '@/components/...' actually exist
    const importRegex =
      /import\s+(?:(\w+)|\{([^}]+)\})\s+from\s+["']@\/([^"']+)["']/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(pageFile.content)) !== null) {
      const defaultImport = match[1]?.trim();
      const namedImports = match[2]
        ? match[2].split(",").map((s) =>
            s
              .trim()
              .split(/\s+as\s+/)[0]
              .trim(),
          )
        : [];
      const relPath = match[3];

      // Exclude standard packages or ui/utils libraries
      if (
        relPath === "lib/utils" ||
        relPath.startsWith("components/ui/") ||
        relPath.startsWith("hooks/")
      ) {
        continue;
      }

      // Candidate file extensions
      const candidates = [
        `${relPath}.tsx`,
        `${relPath}.ts`,
        `${relPath}.jsx`,
        `${relPath}.js`,
        `${relPath}/index.tsx`,
        `${relPath}/index.ts`,
      ];

      const targetPath = candidates.find((c) => completeFileMap.has(c));
      if (!targetPath) {
        return {
          valid: false,
          error: `Module not found in page composition: 'app/page.tsx' imports '@/${relPath}', but no matching file exists in the project.`,
        };
      }

      const targetContent = completeFileMap.get(targetPath)!;

      // Verify that default import exists
      if (defaultImport && !/export\s+default\b/.test(targetContent)) {
        return {
          valid: false,
          error: `Export mismatch: '${targetPath}' does not have a default export, but 'app/page.tsx' imports default '${defaultImport}'.`,
        };
      }

      // Verify that named imports exist
      for (const named of namedImports) {
        if (!named) continue;
        const namedRegex = new RegExp(
          `export\\s+(?:(?:async\\s+)?function|const|class|type|interface)\\s+${named}\\b`,
        );
        const exportBlockRegex = new RegExp(`export\\s*\\{[^}]*\\b${named}\\b`);
        if (
          !namedRegex.test(targetContent) &&
          !exportBlockRegex.test(targetContent)
        ) {
          return {
            valid: false,
            error: `Export mismatch: '${targetPath}' does not export '${named}', which is imported by 'app/page.tsx'.`,
          };
        }
      }
    }

    // Verify required sections completeness if specified
    if (options?.requiredSections && options.requiredSections.length > 0) {
      const composition = validatePageSectionComposition(
        pageFile.content,
        options.requiredSections,
      );

      // If user requested many sections (e.g. 5+ or 10 sections) and more than half are missing
      if (
        !composition.valid &&
        (options.requiredSections.length >= 4 ||
          options.minSections !== undefined)
      ) {
        const threshold =
          options.minSections ??
          Math.ceil(options.requiredSections.length * 0.7);
        const renderedCount =
          options.requiredSections.length - composition.missingSections.length;

        if (renderedCount < threshold) {
          return {
            valid: false,
            error: `Section completeness check failed: 'app/page.tsx' renders only ${renderedCount} section(s), but ${options.requiredSections.length} sections were requested (${options.requiredSections.join(", ")}). Missing sections: ${composition.missingSections.join(", ")}.`,
          };
        }
      }
    }
  }

  return {
    valid: true,
    files: validatedFiles,
  };
}
