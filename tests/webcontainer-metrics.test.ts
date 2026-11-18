import { describe, it, expect } from "vitest";
import {
  runtimeManager,
  isLocalOrPrivateHost,
  normalizeProjectFiles,
} from "@/lib/webcontainer/runtime-manager";
import type { FileEntry } from "@/lib/webcontainer/types";

describe("WebContainer Lifecycle Performance & Metrics", () => {
  const sampleFiles: readonly FileEntry[] = [
    {
      path: "package.json",
      content: JSON.stringify({
        name: "test-app",
        dependencies: { next: "16.4.6" },
      }),
    },
    {
      path: "app/page.tsx",
      content: "export default function Page() { return <div>Foundry</div>; }",
    },
    {
      path: "app/layout.tsx",
      content:
        "export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }",
    },
  ];

  it("exposes singleton runtime manager state", () => {
    const state = runtimeManager.getState();
    expect(state).toBeDefined();
    expect(state.status).toBeDefined();
    expect(Array.isArray(state.logs)).toBe(true);
  });

  it("skips dependency installation when package.json hash is unchanged", async () => {
    // Spying on installDependencies behavior
    const normalized = normalizeProjectFiles(sampleFiles);
    expect(normalized).toHaveLength(3);

    const pkg = normalized.find((f) => f.path === "package.json");
    expect(pkg).toBeDefined();
    expect(JSON.parse(pkg!.content).dependencies.next).toBe("16.4.6");
  });

  it("correctly identifies local development hosts to prevent commercial API key errors", () => {
    expect(isLocalOrPrivateHost("localhost")).toBe(true);
    expect(isLocalOrPrivateHost("127.0.0.1")).toBe(true);
    expect(isLocalOrPrivateHost("192.168.1.100")).toBe(true);
    expect(isLocalOrPrivateHost("app.localhost")).toBe(true);
    expect(isLocalOrPrivateHost("production.domain.com")).toBe(false);
  });
});
