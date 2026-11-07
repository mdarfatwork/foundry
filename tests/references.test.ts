import { describe, it, expect } from "vitest";
import {
  validateSafePublicUrl,
  validateImageReference,
  formatReferencesForPrompt,
} from "@/lib/ai/references";

describe("Design References & SSRF Protection", () => {
  describe("validateSafePublicUrl", () => {
    it("allows valid public HTTPS and HTTP URLs", () => {
      const resHttps = validateSafePublicUrl("https://example.com/landing");
      expect(resHttps.safe).toBe(true);
      expect(resHttps.normalizedUrl).toBe("https://example.com/landing");

      const resHttp = validateSafePublicUrl("http://example.org");
      expect(resHttp.safe).toBe(true);
    });

    it("rejects non-HTTP protocols (file, ftp, javascript)", () => {
      expect(validateSafePublicUrl("file:///etc/passwd").safe).toBe(false);
      expect(validateSafePublicUrl("ftp://ftp.example.com").safe).toBe(false);
      expect(validateSafePublicUrl("javascript:alert(1)").safe).toBe(false);
    });

    it("rejects loopback and local hostnames", () => {
      expect(validateSafePublicUrl("http://localhost:3000").safe).toBe(false);
      expect(validateSafePublicUrl("http://127.0.0.1:8080").safe).toBe(false);
      expect(validateSafePublicUrl("http://0.0.0.0").safe).toBe(false);
    });

    it("rejects cloud instance metadata endpoints (AWS, GCP, Azure)", () => {
      expect(
        validateSafePublicUrl("http://169.254.169.254/latest/meta-data/").safe,
      ).toBe(false);
      expect(
        validateSafePublicUrl(
          "http://metadata.google.internal/computeMetadata/v1/",
        ).safe,
      ).toBe(false);
    });

    it("rejects private RFC1918 IP addresses", () => {
      expect(validateSafePublicUrl("http://10.0.0.1/admin").safe).toBe(false);
      expect(validateSafePublicUrl("http://192.168.1.1").safe).toBe(false);
      expect(validateSafePublicUrl("http://172.16.0.5").safe).toBe(false);
      expect(validateSafePublicUrl("http://172.31.255.255").safe).toBe(false);
    });

    it("rejects internal domain suffixes (.local, .internal, .localhost)", () => {
      expect(validateSafePublicUrl("https://app.local").safe).toBe(false);
      expect(validateSafePublicUrl("https://vault.internal").safe).toBe(false);
    });

    it("rejects non-standard ports to prevent port scanning", () => {
      expect(validateSafePublicUrl("https://example.com:22").safe).toBe(false);
      expect(validateSafePublicUrl("https://example.com:5432").safe).toBe(
        false,
      );
      expect(validateSafePublicUrl("https://example.com:6379").safe).toBe(
        false,
      );
    });
  });

  describe("validateImageReference", () => {
    it("accepts valid image MIME types (png, jpeg, webp)", () => {
      const smallBase64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      expect(validateImageReference(smallBase64, "image/png").valid).toBe(true);
      expect(validateImageReference(smallBase64, "image/jpeg").valid).toBe(
        true,
      );
      expect(validateImageReference(smallBase64, "image/webp").valid).toBe(
        true,
      );
    });

    it("rejects unsupported MIME types", () => {
      const res = validateImageReference("dummy", "image/gif");
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Unsupported image format/);
    });

    it("rejects oversized base64 images exceeding 4MB", () => {
      // 4MB base64 is ~5.33M characters
      const largeBase64 = "a".repeat(6 * 1024 * 1024);
      const res = validateImageReference(largeBase64, "image/png");
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/exceeds the 4 MB file size limit/);
    });
  });

  describe("formatReferencesForPrompt", () => {
    it("formats URL and image references into structured prompt instructions", () => {
      const promptText = formatReferencesForPrompt([
        {
          type: "url",
          url: "https://linear.app",
          title: "Linear — A better way to build products",
          description: "Issue tracking built for high-performance teams.",
        },
        {
          type: "image",
          notes: "Dark mode luxury layout with subtle gold borders",
        },
      ]);

      expect(promptText).toContain("### User Design References:");
      expect(promptText).toContain("Reference Website: https://linear.app");
      expect(promptText).toContain(
        "Title: Linear — A better way to build products",
      );
      expect(promptText).toContain(
        "Dark mode luxury layout with subtle gold borders",
      );
    });
  });
});
