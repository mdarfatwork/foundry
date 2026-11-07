import type { UrlReference, ImageReference } from "./types";

/**
 * Design References, URL Inspection with strict SSRF Guards, and Curated Free Assets.
 * Adheres strictly to AGENTS.md §1, §5.1, §5.2, and Prompt §6.
 */

// Max allowed bytes for URL metadata scraping (64 KB)
const MAX_URL_RESPONSE_BYTES = 64 * 1024;
const URL_FETCH_TIMEOUT_MS = 4000;

// Blocked private/reserved hostname patterns
const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254", // AWS/GCP/Azure instance metadata
  "metadata.google.internal",
  "instance-data",
]);

/**
 * Checks whether an IPv4 address belongs to a private, loopback, or link-local range.
 */
function isPrivateIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  const [a, b] = parts;
  // Loopback (127.0.0.0/8)
  if (a === 127) return true;
  // Private Class A (10.0.0.0/8)
  if (a === 10) return true;
  // Private Class B (172.16.0.0/12)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // Private Class C (192.168.0.0/16)
  if (a === 192 && b === 168) return true;
  // Link-local / Cloud metadata (169.254.0.0/16)
  if (a === 169 && b === 254) return true;
  // Zero address (0.0.0.0/8)
  if (a === 0) return true;

  return false;
}

/**
 * Validates and checks a candidate URL for SSRF vulnerabilities.
 * Returns the normalized URL if safe, or null with a reason if rejected.
 */
export function validateSafePublicUrl(rawUrl: string): {
  readonly safe: boolean;
  readonly normalizedUrl?: string;
  readonly reason?: string;
} {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { safe: false, reason: "URL must be a non-empty string." };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { safe: false, reason: "Invalid URL format." };
  }

  // Only allow public http: or https:
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      safe: false,
      reason: `Disallowed protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check blocked hostnames
  if (BLOCKED_HOSTS.has(hostname)) {
    return {
      safe: false,
      reason: `Host "${hostname}" is a private or internal network endpoint.`,
    };
  }

  // Reject internal TLDs
  if (
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".onion")
  ) {
    return {
      safe: false,
      reason: `Host "${hostname}" resolves to an internal or non-public domain.`,
    };
  }

  // Check if hostname is directly an IP address
  if (isPrivateIp(hostname)) {
    return {
      safe: false,
      reason: `IP address "${hostname}" is in a private network range.`,
    };
  }

  // Reject uncommon ports to prevent internal service port scanning
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    return {
      safe: false,
      reason: "Custom network ports are not permitted for security.",
    };
  }

  return {
    safe: true,
    normalizedUrl: parsed.toString(),
  };
}

/**
 * Safely inspects a public inspiration website to extract title and description metadata.
 * Strictly bounded by timeout and size limits to protect server resources.
 */
export async function inspectReferenceWebsite(
  rawUrl: string,
): Promise<UrlReference> {
  const check = validateSafePublicUrl(rawUrl);
  if (!check.safe || !check.normalizedUrl) {
    return {
      type: "url",
      url: rawUrl,
      notes: `Inspection skipped: ${check.reason || "Invalid URL"}`,
    };
  }

  const url = check.normalizedUrl;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Foundry-Inspiration-Inspector/1.0 (Website Builder Preview)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return {
        type: "url",
        url,
        notes: `HTTP error ${res.status} when accessing reference.`,
      };
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
      return {
        type: "url",
        url,
        notes: "Reference URL does not serve HTML.",
      };
    }

    // Read only up to MAX_URL_RESPONSE_BYTES
    const reader = res.body?.getReader();
    if (!reader) {
      return { type: "url", url };
    }

    const chunks: Uint8Array[] = [];
    let bytesRead = 0;

    while (bytesRead < MAX_URL_RESPONSE_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      bytesRead += value.length;
    }

    // Cancel remaining stream
    reader.cancel().catch(() => {});

    const decoder = new TextDecoder();
    const html = chunks
      .map((c) => decoder.decode(c, { stream: true }))
      .join("");

    // Extract Title
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    const title = titleMatch?.[1]?.trim() || undefined;

    // Extract Meta Description
    const descMatch =
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i.exec(
        html,
      ) ||
      /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i.exec(
        html,
      );
    const description = descMatch?.[1]?.trim() || undefined;

    return {
      type: "url",
      url,
      title,
      description,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      type: "url",
      url,
      notes: `Could not retrieve URL content (${err instanceof Error ? err.message : "Network error"}).`,
    };
  }
}

/**
 * Validates uploaded screenshot image metadata.
 */
export function validateImageReference(
  base64Data: string,
  mimeType: string,
): { readonly valid: boolean; readonly error?: string } {
  const allowedMimeTypes = ["image/png", "image/jpeg", "image/webp"];
  if (!allowedMimeTypes.includes(mimeType)) {
    return {
      valid: false,
      error: `Unsupported image format "${mimeType}". Only PNG, JPEG, and WebP are supported.`,
    };
  }

  // Base64 size estimation: 4MB limit
  const approxSizeBytes = Math.round((base64Data.length * 3) / 4);
  if (approxSizeBytes > 4 * 1024 * 1024) {
    return {
      valid: false,
      error: "Screenshot exceeds the 4 MB file size limit.",
    };
  }

  return { valid: true };
}

/**
 * Curated, verified, functional Unsplash photo references for generated landing pages.
 * Grouped by page theme to provide consistent, high-aesthetic visuals without broken links.
 */
export const CURATED_UNSPLASH_ASSETS = {
  saas: [
    {
      url: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80",
      alt: "Data visualization and analytics dashboard on high resolution monitor",
      aspect: "16/9",
    },
    {
      url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80",
      alt: "Financial statistics and performance metrics chart",
      aspect: "16/9",
    },
  ],
  modernArchitecture: [
    {
      url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
      alt: "Contemporary luxury architectural villa with warm ambient lighting",
      aspect: "16/9",
    },
    {
      url: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80",
      alt: "Minimalist residential facade with clean geometry",
      aspect: "16/9",
    },
  ],
  creativeStudio: [
    {
      url: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80",
      alt: "Professional creative director in modern architectural workspace",
      aspect: "4/3",
    },
    {
      url: "https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1200&q=80",
      alt: "Minimalist studio workplace with natural sunlight",
      aspect: "16/9",
    },
  ],
  testimonials: [
    {
      url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80",
      alt: "Portrait of Sarah Jenkins, VP of Engineering",
      aspect: "1/1",
    },
    {
      url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80",
      alt: "Portrait of Marcus Vance, Founder & CEO",
      aspect: "1/1",
    },
    {
      url: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&q=80",
      alt: "Portrait of Elena Rostova, Product Architect",
      aspect: "1/1",
    },
  ],
} as const;

/**
 * Formats user design references into an informative design brief block for the AI system prompt.
 */
export function formatReferencesForPrompt(
  references?: readonly (UrlReference | ImageReference)[],
): string {
  if (!references || references.length === 0) return "";

  const lines: string[] = ["### User Design References:"];
  for (const ref of references) {
    if (ref.type === "url") {
      lines.push(`- Reference Website: ${ref.url}`);
      if (ref.title) lines.push(`  Title: ${ref.title}`);
      if (ref.description) lines.push(`  Description: ${ref.description}`);
      if (ref.notes) lines.push(`  Notes: ${ref.notes}`);
    } else if (ref.type === "image") {
      lines.push("- Reference Screenshot provided by user.");
      if (ref.notes) lines.push(`  Analysis notes: ${ref.notes}`);
    }
  }

  return lines.join("\n");
}
