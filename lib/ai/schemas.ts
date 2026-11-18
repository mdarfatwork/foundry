import { z } from "zod";

/**
 * Provider-independent Zod schemas for Foundry generation outputs.
 */

export const fileModificationSchema = z.object({
  path: z.string().min(1).max(260),
  content: z.string().min(1),
});

export const generationOutputSchema = z.object({
  summary: z.string().min(1).max(2000),
  details: z.array(z.string().min(1).max(500)).max(12).default([]),
  files: z.array(fileModificationSchema).min(1).max(20),
  designBrief: z.string().max(4000).optional(),
});

export const clarificationOptionSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  description: z.string().max(300).optional(),
});

export const clarificationQuestionSchema = z.object({
  id: z.string().min(1).max(80),
  question: z.string().min(1).max(300),
  options: z.array(clarificationOptionSchema).min(2).max(6),
  isMultiSelect: z.boolean().optional(),
});

export const clarificationResultSchema = z.discriminatedUnion(
  "needsClarification",
  [
    z.object({
      needsClarification: z.literal(false),
    }),
    z.object({
      needsClarification: z.literal(true),
      questions: z.array(clarificationQuestionSchema).min(1).max(4),
    }),
  ],
);

export const designBriefSchema = z.object({
  businessType: z.string().min(1).max(120),
  audience: z.string().min(1).max(200),
  primaryGoal: z.string().min(1).max(200),
  cta: z.string().min(1).max(120),
  recipe: z.enum([
    "editorial",
    "premium_product",
    "saas",
    "local_business",
    "creative_portfolio",
  ]),
  visualStyle: z.string().min(1).max(240),
  typography: z.string().min(1).max(200),
  palette: z.string().min(1).max(240),
  imagery: z.string().min(1).max(240),
  sections: z.array(z.string().min(1).max(80)).min(2).max(10),
  interactions: z.string().min(1).max(240),
});

export type DesignBrief = z.infer<typeof designBriefSchema>;
export type GenerationOutputParsed = z.infer<typeof generationOutputSchema>;
