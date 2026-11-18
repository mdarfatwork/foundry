import {
  clarificationResultSchema,
  designBriefSchema,
  generationOutputSchema,
  type DesignBrief,
  type GenerationOutputParsed,
} from "./schemas";
import type {
  ClarificationResult,
  FileModification,
  GenerationOutput,
} from "./types";

/**
 * Provider-independent JSON extraction, Zod validation, and one-shot repair helpers.
 */

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (fenced?.[1]) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return trimmed;
}

/**
 * Recovers files from malformed JSON with unescaped JSX quotes.
 */
export function extractFilesFromMalformedJson(rawText: string): {
  readonly summary?: string;
  readonly details?: readonly string[];
  readonly files: readonly FileModification[];
} {
  const files: FileModification[] = [];

  let summary: string | undefined;
  const summaryMatch = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/i.exec(rawText);
  if (summaryMatch?.[1]) {
    try {
      summary = JSON.parse(`"${summaryMatch[1]}"`);
    } catch {
      summary = summaryMatch[1].replace(/\\"/g, '"');
    }
  }

  let details: string[] | undefined;
  const detailsMatch = /"details"\s*:\s*\[([\s\S]*?)\]/i.exec(rawText);
  if (detailsMatch?.[1]) {
    const itemRegex = /"((?:[^"\\]|\\.)*)"/g;
    const items: string[] = [];
    let itemMatch;
    while ((itemMatch = itemRegex.exec(detailsMatch[1])) !== null) {
      try {
        items.push(JSON.parse(`"${itemMatch[1]}"`));
      } catch {
        items.push(itemMatch[1].replace(/\\"/g, '"'));
      }
    }
    if (items.length > 0) details = items;
  }

  const pathRegex = /"path"\s*:\s*"([^"]+)"/g;
  let pathMatch;
  while ((pathMatch = pathRegex.exec(rawText)) !== null) {
    const filePath = pathMatch[1].trim();
    const afterIndex = pathMatch.index + pathMatch[0].length;
    const contentKeyRegex = /"content"\s*:\s*/g;
    contentKeyRegex.lastIndex = afterIndex;
    const contentKeyMatch = contentKeyRegex.exec(rawText);
    if (!contentKeyMatch) continue;

    let contentStart = contentKeyMatch.index + contentKeyMatch[0].length;
    if (rawText[contentStart] === '"') contentStart++;

    let contentEnd = rawText.length;
    const nextPathRegex = /,\s*\{\s*"path"\s*:/g;
    nextPathRegex.lastIndex = contentStart;
    const nextPathMatch = nextPathRegex.exec(rawText);
    if (nextPathMatch) {
      contentEnd = nextPathMatch.index;
      const chunk = rawText.slice(contentStart, contentEnd);
      const lastQuote = chunk.lastIndexOf('"');
      if (lastQuote !== -1 && lastQuote > chunk.length - 30) {
        contentEnd = contentStart + lastQuote;
      }
    } else {
      const trailingEndRegex = /(?:"\s*\}\s*\]|"\s*\}|\}\s*\]\s*\}|\n```)/g;
      trailingEndRegex.lastIndex = contentStart;
      let lastMatch: RegExpExecArray | null = null;
      let m: RegExpExecArray | null;
      while ((m = trailingEndRegex.exec(rawText)) !== null) {
        lastMatch = m;
      }
      if (lastMatch && lastMatch.index > contentStart) {
        contentEnd = lastMatch.index;
      }
    }

    let rawCode = rawText.slice(contentStart, contentEnd);
    rawCode = rawCode
      .replace(/```\s*$/, "")
      .replace(/"\s*\}\s*\]\s*\}?\s*$/, "")
      .replace(/"\s*\}\s*$/, "")
      .replace(/"\s*$/, "");

    if (rawCode.includes("\\n") || rawCode.includes('\\"')) {
      rawCode = rawCode
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }

    const trimmedCode = rawCode.trim();
    if (trimmedCode.length > 20) {
      files.push({ path: filePath, content: trimmedCode });
    }
  }

  return { summary, details, files };
}

export function extractStructuredOutput(rawText: string): GenerationOutput {
  if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("Model returned empty or non-string response.");
  }

  const trimmedRaw = rawText.trim();
  let parsed: Record<string, unknown> | null = null;
  let parseError: Error | null = null;

  const candidate = stripCodeFence(trimmedRaw);
  try {
    const res = JSON.parse(candidate);
    if (res && typeof res === "object") {
      parsed = res as Record<string, unknown>;
    }
  } catch (e) {
    parseError = e instanceof Error ? e : new Error(String(e));
  }

  let summary = "Updated project files according to your instructions.";
  let details: string[] = [];
  const files: FileModification[] = [];

  if (parsed) {
    if (typeof parsed.summary === "string" && parsed.summary.trim()) {
      summary = parsed.summary.trim();
    }
    if (Array.isArray(parsed.details)) {
      details = parsed.details
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
        .map((item) => item.trim());
    }

    if (Array.isArray(parsed.files)) {
      for (const f of parsed.files) {
        if (!f || typeof f !== "object") continue;
        const fileObj = f as Record<string, unknown>;
        if (
          typeof fileObj.path === "string" &&
          fileObj.path.trim() &&
          typeof fileObj.content === "string"
        ) {
          files.push({
            path: fileObj.path.trim(),
            content: fileObj.content,
          });
        }
      }
    } else if (parsed.files && typeof parsed.files === "object") {
      const fileRecord = parsed.files as Record<string, unknown>;
      if (
        typeof fileRecord.path === "string" &&
        typeof fileRecord.content === "string"
      ) {
        files.push({
          path: fileRecord.path.trim(),
          content: fileRecord.content,
        });
      } else {
        for (const [filePath, fileContent] of Object.entries(fileRecord)) {
          if (typeof fileContent === "string" && fileContent.trim()) {
            files.push({ path: filePath.trim(), content: fileContent });
          }
        }
      }
    }

    if (files.length === 0 && typeof parsed.code === "string") {
      files.push({ path: "app/page.tsx", content: parsed.code.trim() });
    }
  }

  if (files.length === 0) {
    const recovered = extractFilesFromMalformedJson(trimmedRaw);
    if (recovered.files.length > 0) {
      files.push(...recovered.files);
      if (recovered.summary) summary = recovered.summary;
      if (recovered.details?.length) details = [...recovered.details];
    }
  }

  if (files.length === 0) {
    const codeBlockRegex =
      /```(?:tsx|jsx|typescript|javascript|react)?\s*([\s\S]*?(?:export\s+default|function\s+[A-Z]|return\s*\()[\s\S]*?)\s*```/i;
    const codeMatch = codeBlockRegex.exec(trimmedRaw);
    if (codeMatch?.[1] && codeMatch[1].trim().length > 50) {
      files.push({ path: "app/page.tsx", content: codeMatch[1].trim() });
      summary = "Updated app/page.tsx with your requested changes.";
    }
  }

  if (files.length === 0) {
    throw new Error(
      parseError
        ? `Failed to parse model output as JSON: ${parseError.message}`
        : 'JSON output must contain a non-empty "files" array with { path, content } objects.',
    );
  }

  const validated = generationOutputSchema.safeParse({
    summary,
    details,
    files,
    designBrief:
      typeof parsed?.designBrief === "string" ? parsed.designBrief : undefined,
  });

  if (!validated.success) {
    // Soft-accept after recovery: keep extracted files when schema extras fail
    return { summary, details, files };
  }

  return {
    summary: validated.data.summary,
    details: validated.data.details,
    files: validated.data.files,
  };
}

export function extractClarificationOutput(
  rawText: string,
): ClarificationResult {
  if (!rawText?.trim()) return { needsClarification: false };
  try {
    const parsed = JSON.parse(stripCodeFence(rawText));
    const result = clarificationResultSchema.safeParse(parsed);
    if (!result.success) return { needsClarification: false };
    if (!result.data.needsClarification) return { needsClarification: false };

    const questions = result.data.questions.map((q) => {
      const hasDefault = q.options.some(
        (o) =>
          o.id.toLowerCase().includes("default") ||
          o.label.toLowerCase().includes("foundry decide"),
      );
      const options = [...q.options];
      if (!hasDefault && options.length < 5) {
        options.push({ id: "foundry_default", label: "Let Foundry decide" });
      }
      return { ...q, options };
    });

    if (questions.length === 0) return { needsClarification: false };
    return {
      needsClarification: true,
      questions: questions.slice(0, 4),
    };
  } catch {
    return { needsClarification: false };
  }
}

export function parseDesignBrief(rawText: string): DesignBrief | null {
  if (!rawText?.trim()) return null;
  try {
    const parsed = JSON.parse(stripCodeFence(rawText));
    const result = designBriefSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function validateGenerationOutput(
  value: unknown,
):
  | { readonly ok: true; readonly data: GenerationOutputParsed }
  | { readonly ok: false; readonly error: string } {
  const result = generationOutputSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues.map((i) => i.message).join("; "),
    };
  }
  return { ok: true, data: result.data };
}

export const JSON_REPAIR_INSTRUCTION = `Your previous response was invalid JSON or failed schema validation.
Return ONLY a corrected JSON object with keys summary, details, files.
Each files[] item must be { "path": "...", "content": "..." } with properly escaped strings.
Do not include markdown fences or commentary.`;
