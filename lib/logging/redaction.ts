/**
 * Centralized secret redaction and diagnostic sanitization for Foundry.
 * Safely sanitizes log entries, exception messages, and structured metadata
 * before transport and database persistence.
 * Adheres strictly to AGENTS.md §1, §5.1, §6, and §7.
 */

// Common credential and API key regex patterns
const SECRET_PATTERNS: readonly {
  readonly regex: RegExp;
  readonly replacement: string;
}[] = [
  // NVIDIA NIM / API keys (e.g., nvapi-...)
  {
    regex: /nvapi-[a-zA-Z0-9_-]{16,}/gi,
    replacement: "[REDACTED_NVIDIA_KEY]",
  },
  // OpenAI / Generic secret keys (e.g., sk-..., sk-proj-...)
  {
    regex: /sk-[a-zA-Z0-9_-]{16,}/gi,
    replacement: "[REDACTED_API_KEY]",
  },
  // GitHub Personal Access Tokens (ghp_..., gho_..., etc.)
  {
    regex: /gh[pousr]_[a-zA-Z0-9]{36,}/gi,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  // Generic Bearer tokens in headers or logs
  {
    regex: /Bearer\s+[a-zA-Z0-9_.\-+/=]{16,}/gi,
    replacement: "Bearer [REDACTED_BEARER_TOKEN]",
  },
  // PostgreSQL connection strings with passwords (postgres://user:password@host...)
  {
    regex: /(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi,
    replacement: "$1[REDACTED_DB_PASSWORD]$3",
  },
  // Authorization headers
  {
    regex: /(["']?authorization["']?\s*:\s*["'])[^"']+(["'])/gi,
    replacement: "$1[REDACTED_AUTH]$2",
  },
  // Cookie values or session secrets
  {
    regex: /(["']?cookie["']?\s*:\s*["'])[^"']+(["'])/gi,
    replacement: "$1[REDACTED_COOKIE]$2",
  },
  // AWS Access Key IDs
  {
    regex: /AKIA[0-9A-Z]{16}/g,
    replacement: "[REDACTED_AWS_KEY]",
  },
  // Google API keys (AIza...)
  {
    regex: /AIza[0-9A-Za-z-_]{35}/g,
    replacement: "[REDACTED_GOOGLE_KEY]",
  },
  // StackBlitz WebContainer API Keys
  {
    regex: /wcp_[a-zA-Z0-9_-]{16,}/gi,
    replacement: "[REDACTED_WEBCONTAINER_KEY]",
  },
];

export const MAX_LOG_MESSAGE_LENGTH = 4096; // 4 KB per message line
export const MAX_DETAILS_LENGTH = 16384; // 16 KB for serialized details

/**
 * Sanitizes and redacts secrets from a raw string message.
 * Enforces length bounds to prevent log injection or database exhaustion.
 */
export function redactSensitiveText(input: string): string {
  if (!input) return "";

  let sanitized = input;

  for (const { regex, replacement } of SECRET_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }

  // Bound message length
  if (sanitized.length > MAX_LOG_MESSAGE_LENGTH) {
    return `${sanitized.slice(0, MAX_LOG_MESSAGE_LENGTH)}... [TRUNCATED]`;
  }

  return sanitized;
}

/**
 * Safely sanitizes arbitrary objects or values into a clean JSON string,
 * preventing circular references and redacting sensitive values.
 */
export function sanitizeStructuredDetails(details: unknown): string | null {
  if (details === null || details === undefined) {
    return null;
  }

  try {
    const seen = new WeakSet();
    const serialized = JSON.stringify(details, (_key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
      }

      if (typeof value === "string") {
        return redactSensitiveText(value);
      }

      return value;
    });

    if (!serialized) return null;

    if (serialized.length > MAX_DETAILS_LENGTH) {
      return `${serialized.slice(0, MAX_DETAILS_LENGTH)}... [TRUNCATED_JSON]`;
    }

    return serialized;
  } catch {
    return JSON.stringify({ error: "Failed to serialize diagnostic details" });
  }
}
