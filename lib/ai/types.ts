/**
 * Core types for AI code generation, multi-provider inference, and clarification in Foundry.
 */

import type { AIProviderId } from "./registry";
import type { DesignBrief } from "./schemas";

export type AIProvider = AIProviderId;

export type UrlReference = {
  readonly type: "url";
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  readonly notes?: string;
};

export type ImageReference = {
  readonly type: "image";
  readonly imageUrl?: string;
  readonly imageBase64?: string;
  readonly mimeType?: string;
  readonly notes?: string;
};

export type DesignReference = UrlReference | ImageReference;

export type FileModification = {
  readonly path: string;
  readonly content: string;
};

export type GenerationOutput = {
  readonly summary: string;
  readonly details: readonly string[];
  readonly files: readonly FileModification[];
  readonly designBriefText?: string;
};

export type AIModelMessage = {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
};

export type ClarificationOption = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type ClarificationQuestion = {
  readonly id: string;
  readonly question: string;
  readonly options: readonly ClarificationOption[];
  readonly isMultiSelect?: boolean;
  readonly defaultSelected?: readonly string[];
};

export type ClarificationPayload = {
  readonly type: "clarification";
  readonly questions: readonly ClarificationQuestion[];
  readonly originalPrompt: string;
  readonly answered?: boolean;
  readonly answers?: Record<string, readonly string[]>;
  readonly references?: readonly DesignReference[];
};

export type ClarificationResult =
  | {
      readonly needsClarification: true;
      readonly questions: readonly ClarificationQuestion[];
    }
  | {
      readonly needsClarification: false;
    };

export type GenerationTask =
  | "clarification"
  | "design_brief"
  | "landing_page"
  | "follow_up_edit"
  | "error_repair";

export type GenerateWebsiteOptions = {
  readonly prompt: string;
  readonly existingFiles: readonly FileModification[];
  readonly previousMessages?: readonly AIModelMessage[];
  readonly references?: readonly DesignReference[];
  /** @deprecated Ignored — routing is automatic and free-only. */
  readonly provider?: AIProvider;
  /** @deprecated Ignored — routing is automatic and free-only. */
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly designBrief?: DesignBrief | null;
  readonly task?: GenerationTask;
  readonly clarificationAnswers?: string;
};

export type GenerationErrorCode =
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "CONFIG_ERROR"
  | "PROVIDER_ERROR"
  | "MALFORMED_OUTPUT"
  | "VALIDATION_FAILED"
  | "NO_FREE_PROVIDER";

export type AIGenerationResult =
  | {
      readonly success: true;
      readonly output: GenerationOutput;
      readonly provider?: AIProvider | string;
      readonly model?: string;
      readonly latencyMs?: number;
      readonly retries?: number;
      readonly routeReason?: string;
      readonly designBrief?: DesignBrief | null;
      readonly usage?: {
        readonly promptTokens?: number;
        readonly completionTokens?: number;
        readonly reasoningTokens?: number;
      };
    }
  | {
      readonly success: false;
      readonly error: string;
      readonly code: GenerationErrorCode;
      readonly provider?: AIProvider | string;
      readonly model?: string;
      readonly latencyMs?: number;
      readonly retries?: number;
    };

export type ValidationResult =
  | { readonly valid: true; readonly files: readonly FileModification[] }
  | { readonly valid: false; readonly error: string };
