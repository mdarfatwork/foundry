/**
 * Safe redirect URL validation for authentication flows.
 * Protects against Open Redirect vulnerabilities (CWE-601).
 * Adheres to AGENTS.md §7.4 and §11.
 */

export const DEFAULT_AUTHENTICATED_ROUTE = "/workspace";
export const DEFAULT_UNAUTHENTICATED_ROUTE = "/sign-in";

/**
 * Validates a requested redirect URL to ensure it is a safe internal relative path.
 * Rejects protocol-relative URLs (`//example.com`), absolute external URLs (`https://...`),
 * and unsafe schemes (`javascript:`, `data:`, etc.).
 */
export function getSafeRedirectUrl(
  requestedUrl?: string | null,
  fallback = DEFAULT_AUTHENTICATED_ROUTE,
): string {
  if (!requestedUrl || typeof requestedUrl !== "string") {
    return fallback;
  }

  const trimmed = requestedUrl.trim();

  // Reject empty or whitespace-only
  if (!trimmed) {
    return fallback;
  }

  // Must begin with a single slash '/' and not a double slash '//' (protocol-relative)
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return fallback;
  }

  // Reject backslash variations that some browsers interpret as protocol-relative (e.g. '/\evil.com')
  if (trimmed.startsWith("/\\") || trimmed.includes("\\")) {
    return fallback;
  }

  // Reject embedded protocol strings or control characters
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("javascript:") ||
    lower.includes("data:") ||
    lower.includes("vbscript:")
  ) {
    return fallback;
  }

  // Reject URL encoded carriage returns / newlines that could lead to HTTP response splitting
  if (/[\r\n]/.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}
