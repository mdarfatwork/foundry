import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  getSafeRedirectUrl,
  DEFAULT_AUTHENTICATED_ROUTE,
} from "@/lib/auth/redirect";
import { getAuthEnv, checkAuthEnvStatus } from "@/lib/auth/env";
import { auth } from "@/lib/auth";
import { proxy } from "@/proxy";
import {
  createProjectAction,
  getUserProjectsAction,
  deleteProjectAction,
  getProjectByIdAction,
  getProjectByIdForUser,
} from "@/app/actions/project";
import * as sessionModule from "@/lib/auth/session";

describe("1. Safe Redirect URL Validation (CWE-601 Prevention)", () => {
  it("allows safe internal relative paths", () => {
    expect(getSafeRedirectUrl("/workspace")).toBe("/workspace");
    expect(getSafeRedirectUrl("/workspace/settings")).toBe(
      "/workspace/settings",
    );
    expect(getSafeRedirectUrl("/dashboard?tab=projects")).toBe(
      "/dashboard?tab=projects",
    );
    expect(getSafeRedirectUrl("/")).toBe("/");
  });

  it("rejects absolute external URLs and falls back to default", () => {
    expect(getSafeRedirectUrl("https://evil.com")).toBe(
      DEFAULT_AUTHENTICATED_ROUTE,
    );
    expect(getSafeRedirectUrl("http://phishing.site/login")).toBe(
      DEFAULT_AUTHENTICATED_ROUTE,
    );
    expect(getSafeRedirectUrl("//evil.com")).toBe(DEFAULT_AUTHENTICATED_ROUTE);
  });

  it("rejects dangerous URI schemes (javascript, data, vbscript)", () => {
    expect(getSafeRedirectUrl("javascript:alert(1)")).toBe(
      DEFAULT_AUTHENTICATED_ROUTE,
    );
    expect(getSafeRedirectUrl("data:text/html,<script>alert(1)</script>")).toBe(
      DEFAULT_AUTHENTICATED_ROUTE,
    );
    expect(getSafeRedirectUrl("vbscript:msgbox(1)")).toBe(
      DEFAULT_AUTHENTICATED_ROUTE,
    );
  });

  it("rejects backslash evasion techniques", () => {
    expect(getSafeRedirectUrl("/\\evil.com")).toBe(DEFAULT_AUTHENTICATED_ROUTE);
    expect(getSafeRedirectUrl("\\evil.com")).toBe(DEFAULT_AUTHENTICATED_ROUTE);
    expect(getSafeRedirectUrl("/path\\something")).toBe(
      DEFAULT_AUTHENTICATED_ROUTE,
    );
  });

  it("rejects CRLF injection attempts", () => {
    expect(getSafeRedirectUrl("/workspace\r\nSet-Cookie:malicious=1")).toBe(
      DEFAULT_AUTHENTICATED_ROUTE,
    );
  });

  it("handles null, undefined, and empty string safely", () => {
    expect(getSafeRedirectUrl(null)).toBe(DEFAULT_AUTHENTICATED_ROUTE);
    expect(getSafeRedirectUrl(undefined)).toBe(DEFAULT_AUTHENTICATED_ROUTE);
    expect(getSafeRedirectUrl("")).toBe(DEFAULT_AUTHENTICATED_ROUTE);
    expect(getSafeRedirectUrl("   ")).toBe(DEFAULT_AUTHENTICATED_ROUTE);
  });
});

describe("2. Authentication Environment Validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("fails closed when required credentials are missing", () => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.DATABASE_URL;

    expect(() => getAuthEnv()).toThrowError(
      /Missing required authentication environment configuration/,
    );
  });

  it("accurately reports missing variables via checkAuthEnvStatus", () => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;

    const status = checkAuthEnvStatus();
    expect(status.isConfigured).toBe(false);
    expect(status.missingVariables).toContain("BETTER_AUTH_SECRET");
    expect(status.missingVariables).toContain("GOOGLE_CLIENT_ID");
  });

  it("returns validated configuration when all variables are present", () => {
    process.env.BETTER_AUTH_SECRET = "super-secret-key-at-least-32-chars-long";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.DATABASE_URL = "postgresql://postgres:pass@localhost:5432/test";
    process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

    const env = getAuthEnv();
    expect(env.betterAuthSecret).toBe(
      "super-secret-key-at-least-32-chars-long",
    );
    expect(env.googleClientId).toBe(
      "test-client-id.apps.googleusercontent.com",
    );
    expect(env.googleClientSecret).toBe("test-client-secret");
    expect(env.databaseUrl).toBe(
      "postgresql://postgres:pass@localhost:5432/test",
    );
  });
});

describe("3. Better Auth Server Configuration", () => {
  it("mounts Google as the sole enabled social provider with identity scopes", () => {
    const providers = auth.options.socialProviders;
    expect(providers).toBeDefined();
    expect(providers?.google).toBeDefined();
    expect(providers?.google.scope).toEqual(["openid", "email", "profile"]);
  });

  it("has session cookie caching enabled for database efficiency", () => {
    expect(auth.options.session?.cookieCache?.enabled).toBe(true);
    expect(auth.options.session?.cookieCache?.maxAge).toBe(300);
  });
});

describe("4. Proxy / Middleware Route Protection", () => {
  it("redirects unauthenticated requests from protected /workspace to /sign-in", () => {
    const request = new NextRequest("http://localhost:3000/workspace");
    const response = proxy(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toContain("/sign-in");
    expect(location).toContain("callbackUrl=%2Fworkspace");
  });

  it("redirects unauthenticated requests from protected /dashboard to /sign-in", () => {
    const request = new NextRequest("http://localhost:3000/dashboard");
    const response = proxy(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toContain("/sign-in");
    expect(location).toContain("callbackUrl=%2Fdashboard");
  });

  it("allows unauthenticated access to public root /", () => {
    const request = new NextRequest("http://localhost:3000/");
    const response = proxy(request);

    expect(response.status).toBe(200);
  });

  it("allows unauthenticated access to /sign-in page", () => {
    const request = new NextRequest("http://localhost:3000/sign-in");
    const response = proxy(request);

    expect(response.status).toBe(200);
  });

  it("redirects authenticated users visiting /sign-in to /workspace", () => {
    const request = new NextRequest("http://localhost:3000/sign-in", {
      headers: {
        cookie: "better-auth.session_token=mock-valid-session-token;",
      },
    });
    const response = proxy(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBe("http://localhost:3000/workspace");
  });

  it("redirects authenticated users visiting /sign-in with safe callbackUrl", () => {
    const request = new NextRequest(
      "http://localhost:3000/sign-in?callbackUrl=%2Fworkspace%2Fproject-1",
      {
        headers: {
          cookie: "better-auth.session_token=mock-valid-session-token;",
        },
      },
    );
    const response = proxy(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBe("http://localhost:3000/workspace/project-1");
  });

  it("sanitizes malicious callbackUrl when redirecting authenticated user", () => {
    const request = new NextRequest(
      "http://localhost:3000/sign-in?callbackUrl=https%3A%2F%2Fevil.com",
      {
        headers: {
          cookie: "better-auth.session_token=mock-valid-session-token;",
        },
      },
    );
    const response = proxy(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBe("http://localhost:3000/workspace");
  });
});

describe("5. Protected Server Actions & Tenant Isolation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects project creation when caller is unauthenticated", async () => {
    vi.spyOn(sessionModule, "requireUser").mockRejectedValue(
      new Error("UNAUTHORIZED"),
    );

    const result = await createProjectAction("My Test Project");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("UNAUTHORIZED");
    }
  });

  it("rejects project creation with invalid input", async () => {
    vi.spyOn(sessionModule, "requireUser").mockResolvedValue({
      id: "usr_123",
      name: "Test User",
      email: "test@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await createProjectAction("");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("INVALID_INPUT");
    }
  });

  it("successfully creates a project scoped to the authenticated user", async () => {
    const mockUser = {
      id: "usr_123",
      name: "Test User",
      email: "test@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.spyOn(sessionModule, "requireUser").mockResolvedValue(mockUser);

    const result = await createProjectAction("Foundry Showcase");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Foundry Showcase");
      expect(result.data.ownerId).toBe("usr_123");
    }
  });

  it("rejects querying projects when unauthenticated", async () => {
    vi.spyOn(sessionModule, "requireUser").mockRejectedValue(
      new Error("UNAUTHORIZED"),
    );

    const result = await getUserProjectsAction();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("UNAUTHORIZED");
    }
  });

  it("rejects deleting projects when unauthenticated", async () => {
    vi.spyOn(sessionModule, "requireUser").mockRejectedValue(
      new Error("UNAUTHORIZED"),
    );

    const result = await deleteProjectAction("proj_123");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("UNAUTHORIZED");
    }
  });

  it("rejects fetching project by ID when unauthenticated", async () => {
    vi.spyOn(sessionModule, "requireUser").mockRejectedValue(
      new Error("UNAUTHORIZED"),
    );

    const result = await getProjectByIdAction("proj_123");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("UNAUTHORIZED");
    }
  });

  it("rejects fetching project with invalid project ID", async () => {
    vi.spyOn(sessionModule, "requireUser").mockResolvedValue({
      id: "usr_123",
      name: "Test User",
      email: "test@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await getProjectByIdAction("   ");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("INVALID_INPUT");
    }
  });

  it("safely handles getProjectByIdForUser with empty inputs", async () => {
    const res1 = await getProjectByIdForUser("", "usr_123");
    expect(res1).toBeNull();

    const res2 = await getProjectByIdForUser("proj_123", "");
    expect(res2).toBeNull();
  });
});

describe("6. Drizzle ORM Schema & Model Integrity", () => {
  it("defines the core Better Auth tables and application project table", async () => {
    const schema = await import("@/lib/db/schema");
    expect(schema.user).toBeDefined();
    expect(schema.session).toBeDefined();
    expect(schema.account).toBeDefined();
    expect(schema.verification).toBeDefined();
    expect(schema.project).toBeDefined();
  });

  it("has correct field definitions on user and project tables", async () => {
    const { user, project } = await import("@/lib/db/schema");
    expect(user.id).toBeDefined();
    expect(user.email).toBeDefined();
    expect(user.name).toBeDefined();
    expect(user.emailVerified).toBeDefined();

    expect(project.id).toBeDefined();
    expect(project.name).toBeDefined();
    expect(project.ownerId).toBeDefined();
  });
});
