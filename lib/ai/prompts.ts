import { CURATED_UNSPLASH_ASSETS } from "./references";
import type { DesignBrief } from "./schemas";
import type { DesignReference, FileModification } from "./types";
import { formatReferencesForPrompt } from "./references";

/**
 * Concise, reusable generation prompts and design recipes for Foundry.
 * Encodes anti-slop design rules without dumping entire skill files into every request.
 */

export const DESIGN_RECIPES = {
  editorial: {
    layout:
      "Asymmetric magazine hierarchy, strong typographic lead, sparse imagery.",
    tokens:
      "Ink black / paper white / one ink accent. Serif display + clean sans body.",
  },
  premium_product: {
    layout: "Full-bleed product hero, quiet feature bands, restrained CTA.",
    tokens: "Deep charcoal canvas, warm metallic accent, generous whitespace.",
  },
  saas: {
    layout:
      "Product-led hero with one concrete UI moment, proof strip, clear pricing CTA.",
    tokens:
      "Neutral slate surfaces, sharp 8px radius, monospace meta labels sparingly.",
  },
  local_business: {
    layout:
      "Trust-first hero, services, area context, contact CTA. No fake stats.",
    tokens:
      "Warm neutrals grounded in the trade materials; readable sans throughout.",
  },
  creative_portfolio: {
    layout: "Work-first grid, short bio, contact. Large imagery, small copy.",
    tokens: "High-contrast monochrome with one personal accent color.",
  },
} as const;

export type DesignRecipeId = keyof typeof DESIGN_RECIPES;

export function inferRecipeFromPrompt(prompt: string): DesignRecipeId {
  const p = prompt.toLowerCase();
  if (/(saas|software|b2b|dashboard|platform|api)/.test(p)) return "saas";
  if (/(portfolio|designer|photographer|studio|agency|creative)/.test(p))
    return "creative_portfolio";
  if (/(restaurant|clinic|dentist|plumber|salon|law|local|bakery|cafe)/.test(p))
    return "local_business";
  if (
    /(luxury|premium|furniture|interior|decor|showroom|watch|jewelry|fragrance|couture)/.test(
      p,
    )
  )
    return "premium_product";
  if (/(magazine|editorial|news|journal|publish)/.test(p)) return "editorial";
  return "saas";
}

function imageCatalogForBrief(brief?: DesignBrief | null): string {
  const recipe = brief?.recipe ?? "saas";
  const isInteriorOrFurniture =
    /furniture|interior|decor|showroom|home|villa|living/i.test(
      `${brief?.businessType ?? ""} ${brief?.visualStyle ?? ""}`,
    );

  const pool = isInteriorOrFurniture
    ? CURATED_UNSPLASH_ASSETS.luxuryInterior
    : recipe === "local_business" || recipe === "premium_product"
      ? CURATED_UNSPLASH_ASSETS.modernArchitecture
      : recipe === "creative_portfolio" || recipe === "editorial"
        ? CURATED_UNSPLASH_ASSETS.creativeStudio
        : CURATED_UNSPLASH_ASSETS.saas;

  return pool
    .map(
      (asset) =>
        `- ${asset.url} (${asset.aspect}) — ${asset.alt} [Unsplash, royalty-free]`,
    )
    .join("\n");
}

function selectRelevantFiles(
  existingFiles: readonly FileModification[],
  mode: "full" | "edit",
): readonly FileModification[] {
  if (mode === "full") {
    return existingFiles.filter((f) =>
      [
        "app/page.tsx",
        "app/layout.tsx",
        "app/globals.css",
        "lib/utils.ts",
        "components/ui/button.tsx",
      ].includes(f.path),
    );
  }

  // Follow-up edits: page + section components + globals tokens only
  return existingFiles.filter(
    (f) =>
      f.path === "app/page.tsx" ||
      f.path === "app/globals.css" ||
      f.path.startsWith("components/sections/") ||
      (f.path.startsWith("components/") &&
        !f.path.startsWith("components/ui/")),
  );
}

export function buildDesignBriefPrompt(userPrompt: string): string {
  return `Extract a concise design brief as JSON for this landing page request.
Rules:
- Choose exactly one recipe: editorial | premium_product | saas | local_business | creative_portfolio
- Do not invent fake testimonials, logos, or statistics.
- Be specific to the business in the prompt.
Return only JSON matching:
{
  "businessType": "...",
  "audience": "...",
  "primaryGoal": "...",
  "cta": "...",
  "recipe": "saas",
  "visualStyle": "...",
  "typography": "...",
  "palette": "...",
  "imagery": "...",
  "sections": ["hero","features","cta","footer"],
  "interactions": "..."
}

User request:
${userPrompt}`;
}

export function buildClarificationSystemPrompt(): string {
  return `You are Foundry's design architect. Decide if a landing-page prompt needs 2-4 multiple-choice questions before coding.
If the prompt already covers business type, audience, goal/CTA, visual direction, and sections, return {"needsClarification":false}.
Otherwise return tailored questions with concise options and always include a "Let Foundry decide" option.
Reply with JSON only.`;
}

export function buildGenerationSystemPrompt(options: {
  readonly existingFiles: readonly FileModification[];
  readonly references?: readonly DesignReference[];
  readonly designBrief?: DesignBrief | null;
  readonly mode: "full" | "edit";
}): string {
  const recipeId = options.designBrief?.recipe ?? "saas";
  const recipe = DESIGN_RECIPES[recipeId];
  const relevant = selectRelevantFiles(options.existingFiles, options.mode);
  const fileList = relevant.map((f) => `- ${f.path}`).join("\n");
  const referencesSection = formatReferencesForPrompt(options.references);
  const briefBlock = options.designBrief
    ? `### Locked Design Brief\n${JSON.stringify(options.designBrief)}`
    : "";

  const pageSnippet = relevant
    .filter(
      (f) =>
        f.path === "app/page.tsx" || f.path.startsWith("components/sections/"),
    )
    .map((f) => `### ${f.path}\n\`\`\`tsx\n${f.content.slice(0, 4500)}\n\`\`\``)
    .join("\n");

  return `You are Foundry's Next.js 16 / React 19 / Tailwind v4 engineer.
Generate a distinctive landing page that matches the design brief. Avoid AI-slop defaults (purple gradients, identical 3-card grids, pill spam, fake stats, generic headlines).

### Recipe
${recipeId}: ${recipe.layout}
Tokens: ${recipe.tokens}

${briefBlock}

### Architecture (multi-file, maintainable)
- Root configs already exist — never emit package.json, tsconfig, next.config, lockfiles, or components.json.
- MANDATORY: app/page.tsx MUST always be included as the FIRST file in the "files" array. It must import and render all section components (e.g. Navbar, Hero, Categories, About, Collection, WhyUs, Showroom, Testimonials, CTA, Footer).
- Keep component implementations clean, modular, and focused so all requested sections fit completely within output token limits without truncation.
- Structure:
  - app/page.tsx (composition only)
  - components/sections/* for major sections (or combined clean modular files)
  - app/layout.tsx / app/globals.css when tokens or fonts must change
  - reuse components/ui/* and lib/utils.ts
- Server Components by default. Add "use client" at the very top of any file with interactive state, hooks (useState, useEffect, useRef), browser APIs, or event handlers (onClick, onSubmit).
- React 19 & Base UI rules:
  - Foundry UI is built on @base-ui/react primitives. Triggers use 'render={<Component />}' prop pattern. NEVER use Radix 'asChild' or pass 'asChild' to buttons, dialogs, or DOM elements.
  - Never pass component-only props to native HTML elements (e.g. no custom props on div/button/section).
  - List rendering: Always supply a unique string or number 'key' prop to each item rendered in a map().
  - Animation: When animation is requested, use 'motion' package with 'import { motion } from "motion/react"'.
  - Imports: Always use the "@/..." alias for all project imports (e.g. 'import { Button } from "@/components/ui/button";', 'import { cn } from "@/lib/utils";'). Never write corrupted sequences like "\\u00" or relative "../../" traversal. Use named imports and 'import type'. Do NOT import '* as React'.
  - JSX entities: In JSX text, always escape quotes and brackets: use &quot; for ", &gt; for >, and &lt; for <.
- Use semantic HTML, accessible controls, lazy images, and respect prefers-reduced-motion.
- Do not invent empty placeholders or fake stats. Use realistic content and high-quality photography.

### Curated royalty-free images (use when relevant)
${imageCatalogForBrief(options.designBrief)}
Apply loading="lazy", object-cover, and explicit aspect ratios. Preserve Unsplash attribution in alt text.

### Existing relevant files
${fileList}
${pageSnippet}
${referencesSection ? `\n${referencesSection}` : ""}

### Output contract
Return ONLY valid JSON:
{
  "summary": "...",
  "details": ["..."],
  "designBrief": "one-paragraph reuse brief",
  "files": [
    {"path":"app/page.tsx","content":"..."},
    {"path":"components/sections/hero.tsx","content":"..."}
  ]
}
Escape all quotes/newlines inside content strings. Never truncate with "// ...".
For follow-up edits, return only changed files.`;
}

export function composeBriefedUserPrompt(
  prompt: string,
  designBrief?: DesignBrief | null,
  clarificationAnswers?: string,
): string {
  const parts = [prompt.trim()];
  if (clarificationAnswers?.trim()) {
    parts.push(`Clarification answers:\n${clarificationAnswers.trim()}`);
  }
  if (designBrief) {
    parts.push(
      `Apply this design brief strictly:\n${JSON.stringify(designBrief)}`,
    );
  }
  return parts.join("\n\n");
}

export function buildRepairSystemPrompt(): string {
  return `You are Foundry's autonomous Next.js 16 / React 19 / TypeScript self-repair specialist.
Your goal is to inspect verified compilation, TypeScript, ESLint, Next.js build, or React runtime warnings/exceptions, and generate minimal, targeted fixes.

### Strict Rules for Repairs:
1. Root-cause remediation only: Fix the underlying syntax, import, type, or runtime problem. Never suppress warnings or errors using // @ts-ignore, // NOSONAR, or eslint-disable.
2. Component composition & React rules:
   - Base UI triggers: Use 'render={<Component />}' prop pattern. NEVER use Radix 'asChild' or pass 'asChild' to buttons, dialogs, or native DOM elements.
   - Never pass component-only props (e.g. asChild, variant, size) through to native DOM elements (div, button, section, a).
   - List keys: Provide unique 'key' props for all map() items.
   - Client boundaries: Add "use client" at top of any component using useState, useEffect, useRef, or browser event handlers.
   - Animation: Use 'import { motion } from "motion/react"'.
   - Imports: Always use the "@/..." alias for all project imports (e.g. 'import { Button } from "@/components/ui/button";', 'import { cn } from "@/lib/utils";'). Never write corrupted sequences like "\\u00" or relative "../../" traversal.
   - JSX entities: In JSX text, always escape quotes and brackets: use &quot; for ", &gt; for >, and &lt; for <.
3. Scope constraint: Return ONLY the files that need changes to fix the error. Do NOT rewrite or regenerate unaffected files or change the overall visual theme.
4. Output format: Return strictly valid JSON:
{
  "summary": "Concise summary of the fix applied",
  "details": ["Specific issue fixed in path/to/file.tsx"],
  "files": [
    {"path": "path/to/file.tsx", "content": "Complete corrected file content..."}
  ]
}
Never truncate with "// ..." or placeholders. Escape all quotes and newlines properly in JSON strings.`;
}

export function buildRepairUserPrompt(options: {
  readonly diagnosticsReport: string;
  readonly relevantFiles: readonly FileModification[];
}): string {
  const fileSnippets = options.relevantFiles
    .map((f) => `### ${f.path}\n\`\`\`tsx\n${f.content.slice(0, 5000)}\n\`\`\``)
    .join("\n\n");

  return `The verification pipeline found the following actionable diagnostics in this Next.js 16 application:

### Verified Diagnostics
${options.diagnosticsReport}

### Source Files Under Repair
${fileSnippets}

Please analyze the root cause of these diagnostics, apply the minimal targeted fixes, and return the complete corrected file(s).`;
}
