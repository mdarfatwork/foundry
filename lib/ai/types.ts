/**
 * Core types for AI code generation, multi-provider inference, and clarification in Foundry.
 * Adheres to AGENTS.md §5.2, §5.3, and Prompt §4, §5, §6.
 */

export type AIProvider = "nvidia" | "google" | "openrouter";

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

export type GenerateWebsiteOptions = {
  readonly prompt: string;
  readonly existingFiles: readonly FileModification[];
  readonly previousMessages?: readonly AIModelMessage[];
  readonly references?: readonly DesignReference[];
  readonly provider?: AIProvider;
  readonly model?: string;
  readonly timeoutMs?: number;
};

export type AIGenerationResult =
  | {
      readonly success: true;
      readonly output: GenerationOutput;
      readonly provider?: AIProvider | string;
      readonly model?: string;
      readonly latencyMs?: number;
      readonly usage?: {
        readonly promptTokens?: number;
        readonly completionTokens?: number;
        readonly reasoningTokens?: number;
      };
    }
  | {
      readonly success: false;
      readonly error: string;
      readonly code:
        | "TIMEOUT"
        | "RATE_LIMIT"
        | "CONFIG_ERROR"
        | "PROVIDER_ERROR"
        | "MALFORMED_OUTPUT"
        | "VALIDATION_FAILED";
      readonly provider?: AIProvider | string;
      readonly model?: string;
    };

export type ValidationResult =
  | { readonly valid: true; readonly files: readonly FileModification[] }
  | { readonly valid: false; readonly error: string };
