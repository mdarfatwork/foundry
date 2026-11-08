import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  redactSensitiveText,
  sanitizeStructuredDetails,
  MAX_LOG_MESSAGE_LENGTH,
} from "@/lib/logging/redaction";
import { WebContainerLogger } from "@/lib/webcontainer/logger";
import {
  persistRuntimeLogsAction,
  getProjectRuntimeLogsAction,
  clearProjectRuntimeLogsAction,
} from "@/app/actions/project-logs";

// Mock auth session to return deterministic users
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    id: "usr_authorized_1",
    name: "Arfat",
    email: "arfat@example.com",
  })),
  getServerSession: vi.fn(async () => ({
    user: {
      id: "usr_authorized_1",
      name: "Arfat",
      email: "arfat@example.com",
    },
    session: {
      id: "sess_1",
      userId: "usr_authorized_1",
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })),
}));

describe("Secret Redaction and Diagnostic Sanitization", () => {
  it("redacts NVIDIA NIM API keys", () => {
    const raw =
      "Connecting with key nvapi-1234567890abcdef12345678 to endpoint";
    const redacted = redactSensitiveText(raw);
    expect(redacted).not.toContain("nvapi-1234567890abcdef12345678");
    expect(redacted).toContain("[REDACTED_NVIDIA_KEY]");
  });

  it("redacts OpenAI API keys", () => {
    const raw = "Bearer sk-proj-1234567890abcdef1234567890";
    const redacted = redactSensitiveText(raw);
    expect(redacted).not.toContain("sk-proj-1234567890abcdef1234567890");
    expect(redacted).toContain("[REDACTED_API_KEY]");
  });

  it("redacts GitHub personal tokens", () => {
    const raw = "Cloning with token ghp_1234567890abcdefghijklmnopqrstuvwxyz12";
    const redacted = redactSensitiveText(raw);
    expect(redacted).not.toContain(
      "ghp_1234567890abcdefghijklmnopqrstuvwxyz12",
    );
    expect(redacted).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  it("redacts PostgreSQL credentials embedded in connection strings", () => {
    const raw =
      "Connecting to postgres://postgres:super_secret_pw123@db.supabase.co:5432/foundry";
    const redacted = redactSensitiveText(raw);
    expect(redacted).not.toContain("super_secret_pw123");
    expect(redacted).toBe(
      "Connecting to postgres://postgres:[REDACTED_DB_PASSWORD]@db.supabase.co:5432/foundry",
    );
  });

  it("redacts HTTP Authorization and Cookie headers", () => {
    const raw =
      'Request headers: authorization: "Bearer my-secret-jwt-token", cookie: "session=secret_value"';
    const redacted = redactSensitiveText(raw);
    expect(redacted).not.toContain("my-secret-jwt-token");
    expect(redacted).not.toContain("secret_value");
    expect(redacted).toContain("[REDACTED_AUTH]");
    expect(redacted).toContain("[REDACTED_COOKIE]");
  });

  it("enforces maximum message length truncation", () => {
    const longString = "A".repeat(MAX_LOG_MESSAGE_LENGTH + 500);
    const redacted = redactSensitiveText(longString);
    expect(redacted.length).toBeLessThan(longString.length);
    expect(redacted).toContain("[TRUNCATED]");
  });

  it("safely sanitizes structured JSON details with circular reference prevention", () => {
    const circularObj: Record<string, unknown> = {
      name: "test",
      key: "sk-1234567890abcdef12345678",
    };
    circularObj.self = circularObj;

    const result = sanitizeStructuredDetails(circularObj);
    expect(result).toBeDefined();
    expect(result).not.toContain("sk-1234567890abcdef12345678");
    expect(result).toContain("[REDACTED_API_KEY]");
    expect(result).toContain("[Circular]");
  });

  it("returns null for empty or null structured details", () => {
    expect(sanitizeStructuredDetails(null)).toBeNull();
    expect(sanitizeStructuredDetails(undefined)).toBeNull();
  });
});

describe("Client WebContainerLogger", () => {
  let logger: WebContainerLogger;

  beforeEach(() => {
    logger = new WebContainerLogger();
    logger.setProjectContext("proj_test_123");
  });

  it("maintains an active runtime session identifier", () => {
    const sessId = logger.getSessionId();
    expect(sessId).toBeDefined();
    expect(sessId.startsWith("sess_")).toBe(true);

    const newSess = logger.createNewSession();
    expect(newSess).not.toBe(sessId);
    expect(logger.getSessionId()).toBe(newSess);
  });

  it("enqueues structured log entries and increments sequence numbers", () => {
    logger.log({
      level: "info",
      source: "webcontainer",
      eventType: "boot_start",
      message: "Booting Node.js runtime",
    });

    const state = logger.getState();
    expect(state.queuedCount).toBe(1);

    logger.log({
      level: "info",
      source: "installer",
      eventType: "install_output",
      message: "npm install output",
    });

    expect(logger.getState().queuedCount).toBe(2);
  });

  it("notifies subscribed listeners on state changes", () => {
    let callCount = 0;
    const unsubscribe = logger.subscribe((state) => {
      callCount += 1;
      expect(state).toBeDefined();
    });

    logger.log({
      level: "info",
      source: "client",
      eventType: "test_event",
      message: "Testing listener",
    });

    expect(callCount).toBeGreaterThanOrEqual(2); // Initial call + log call
    unsubscribe();
  });
});

describe("Server-Side Persistent Logs Action Security & Validation", () => {
  it("rejects unauthorized calls when user is not signed in", async () => {
    const { requireUser } = await import("@/lib/auth/session");
    vi.mocked(requireUser).mockRejectedValueOnce(new Error("UNAUTHORIZED"));

    const res = await persistRuntimeLogsAction("proj_test_123", [
      {
        runtimeSessionId: "sess_1",
        level: "info",
        source: "client",
        eventType: "ping",
        message: "hello",
      },
    ]);

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe("UNAUTHORIZED");
    }
  });

  it("rejects empty or missing project IDs", async () => {
    const res = await persistRuntimeLogsAction("   ", [
      {
        runtimeSessionId: "sess_1",
        level: "info",
        source: "client",
        eventType: "ping",
        message: "hello",
      },
    ]);

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe("INVALID_INPUT");
    }
  });

  it("validates batch size limits (rejects empty batches)", async () => {
    const res = await persistRuntimeLogsAction("proj_test_123", []);

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe("INVALID_PAYLOAD");
    }
  });

  it("rejects invalid log levels", async () => {
    const res = await persistRuntimeLogsAction("proj_test_123", [
      {
        runtimeSessionId: "sess_1",
        // @ts-expect-error - Testing runtime validation against invalid level
        level: "invalid_level",
        source: "client",
        eventType: "ping",
        message: "hello",
      },
    ]);

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe("INVALID_PAYLOAD");
    }
  });

  it("requires valid project ID for log retrieval", async () => {
    const res = await getProjectRuntimeLogsAction("");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe("INVALID_INPUT");
    }
  });

  it("requires valid project ID for log clearing", async () => {
    const res = await clearProjectRuntimeLogsAction("   ");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.code).toBe("INVALID_INPUT");
    }
  });
});
