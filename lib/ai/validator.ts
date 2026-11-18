import { normalize } from "path/posix";
import type { FileModification, ValidationResult } from "./types";

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
/**
 * Deterministically synthesizes app/page.tsx when the model generated modular
 * section components (e.g. components/sections/*) but omitted the composition page.
 */
function synthesizePageFromSections(
  files: readonly FileModification[],
): FileModification | null {
  const sectionFiles = files.filter(
    (f) =>
      f.path.startsWith("components/sections/") &&
      (f.path.endsWith(".tsx") || f.path.endsWith(".jsx")),
  );

  if (sectionFiles.length === 0) return null;

  const imports: string[] = [];
  const componentUsages: string[] = [];

  for (const sf of sectionFiles) {
    const importPath = `@/${sf.path.replace(/\.[^/.]+$/, "")}`;
    const defaultExportMatch = sf.content.match(
      /export\s+default\s+(?:function\s+)?([A-Za-z0-9_]+)/,
    );
    const namedExportMatch = sf.content.match(
      /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/,
    );

    if (defaultExportMatch && defaultExportMatch[1]) {
      const compName = defaultExportMatch[1];
      imports.push(`import ${compName} from "${importPath}";`);
      componentUsages.push(`      <${compName} />`);
    } else if (namedExportMatch && namedExportMatch[1]) {
      const compName = namedExportMatch[1];
      imports.push(`import { ${compName} } from "${importPath}";`);
      componentUsages.push(`      <${compName} />`);
    } else {
      const base = sf.path
        .split("/")
        .pop()
        ?.replace(/\.[^/.]+$/, "");
      if (base) {
        const compName = base.charAt(0).toUpperCase() + base.slice(1);
        imports.push(`import ${compName} from "${importPath}";`);
        componentUsages.push(`      <${compName} />`);
      }
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

    // 8. Required entry point structure check
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
  // deterministically synthesize app/page.tsx so the application renders cleanly.
  if (!validatedFiles.some((f) => f.path === "app/page.tsx")) {
    const synthesized = synthesizePageFromSections(validatedFiles);
    if (synthesized) {
      validatedFiles.unshift(synthesized);
    }
  }

  return {
    valid: true,
    files: validatedFiles,
  };
}
