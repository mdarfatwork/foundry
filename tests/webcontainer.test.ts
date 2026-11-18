import { describe, it, expect, vi } from "vitest";
import { buildFileSystemTree } from "@/lib/webcontainer/tree";
import {
  isLocalOrPrivateHost,
  normalizeProjectFiles,
  isTurbopackUnsupportedError,
  WebContainerRuntimeManager,
} from "@/lib/webcontainer/runtime-manager";
import type { DirectoryNode, FileNode } from "@webcontainer/api";

describe("WebContainer FileSystemTree Builder", () => {
  it("converts root files into FileNode entries", () => {
    const files = [
      { path: "package.json", content: '{"name":"test"}' },
      { path: "tsconfig.json", content: '{"compilerOptions":{}}' },
    ];

    const tree = buildFileSystemTree(files);

    expect(tree["package.json"]).toBeDefined();
    expect((tree["package.json"] as FileNode).file.contents).toBe(
      '{"name":"test"}',
    );

    expect(tree["tsconfig.json"]).toBeDefined();
    expect((tree["tsconfig.json"] as FileNode).file.contents).toBe(
      '{"compilerOptions":{}}',
    );
  });

  it("handles nested directory structures accurately", () => {
    const files = [
      { path: "app/page.tsx", content: "export default function Page() {}" },
      {
        path: "app/layout.tsx",
        content: "export default function Layout() {}",
      },
      {
        path: "components/ui/button.tsx",
        content: "export function Button() {}",
      },
      { path: "lib/utils.ts", content: "export const cn = () => {}" },
    ];

    const tree = buildFileSystemTree(files);

    expect(tree["app"]).toBeDefined();
    const appDir = (tree["app"] as DirectoryNode).directory;
    expect((appDir["page.tsx"] as FileNode).file.contents).toBe(
      "export default function Page() {}",
    );
    expect((appDir["layout.tsx"] as FileNode).file.contents).toBe(
      "export default function Layout() {}",
    );

    expect(tree["components"]).toBeDefined();
    const compDir = (tree["components"] as DirectoryNode).directory;
    expect(compDir["ui"]).toBeDefined();
    const uiDir = (compDir["ui"] as DirectoryNode).directory;
    expect((uiDir["button.tsx"] as FileNode).file.contents).toBe(
      "export function Button() {}",
    );

    expect(tree["lib"]).toBeDefined();
    const libDir = (tree["lib"] as DirectoryNode).directory;
    expect((libDir["utils.ts"] as FileNode).file.contents).toBe(
      "export const cn = () => {}",
    );
  });

  it("normalizes Windows backslashes and redundant leading/trailing slashes", () => {
    const files = [
      { path: "\\app\\globals.css", content: "@import 'tailwindcss';" },
      {
        path: "/components/ui/card.tsx/",
        content: "export function Card() {}",
      },
    ];

    const tree = buildFileSystemTree(files);

    expect(tree["app"]).toBeDefined();
    const appDir = (tree["app"] as DirectoryNode).directory;
    expect((appDir["globals.css"] as FileNode).file.contents).toBe(
      "@import 'tailwindcss';",
    );

    expect(tree["components"]).toBeDefined();
    const compDir = (tree["components"] as DirectoryNode).directory;
    const uiDir = (compDir["ui"] as DirectoryNode).directory;
    expect((uiDir["card.tsx"] as FileNode).file.contents).toBe(
      "export function Card() {}",
    );
  });

  it("gracefully ignores empty or invalid file paths", () => {
    const files = [
      { path: "", content: "ignored" },
      { path: "   ", content: "ignored" },
      { path: "valid.txt", content: "hello" },
    ];

    const tree = buildFileSystemTree(files);
    expect(Object.keys(tree)).toEqual(["valid.txt"]);
  });
});

describe("WebContainer Host Environment Detection", () => {
  it("identifies localhost and loopback hosts as local environments", () => {
    expect(isLocalOrPrivateHost("localhost")).toBe(true);
    expect(isLocalOrPrivateHost("127.0.0.1")).toBe(true);
    expect(isLocalOrPrivateHost("[::1]")).toBe(true);
    expect(isLocalOrPrivateHost("0.0.0.0")).toBe(true);
    expect(isLocalOrPrivateHost("app.localhost")).toBe(true);
    expect(isLocalOrPrivateHost("my-site.local")).toBe(true);
  });

  it("identifies RFC 1918 private IPv4 network ranges as local environments", () => {
    expect(isLocalOrPrivateHost("192.168.1.5")).toBe(true);
    expect(isLocalOrPrivateHost("10.0.0.1")).toBe(true);
    expect(isLocalOrPrivateHost("172.16.0.1")).toBe(true);
    expect(isLocalOrPrivateHost("172.31.255.255")).toBe(true);
  });

  it("identifies public production domains as non-local", () => {
    expect(isLocalOrPrivateHost("foundry.vercel.app")).toBe(false);
    expect(isLocalOrPrivateHost("example.com")).toBe(false);
    expect(isLocalOrPrivateHost("buildfoundry.ai")).toBe(false);
    expect(isLocalOrPrivateHost("172.32.0.1")).toBe(false);
  });

  it("handles empty or falsy host inputs safely", () => {
    expect(isLocalOrPrivateHost("")).toBe(false);
  });
});

describe("WebContainer normalizeProjectFiles Helper", () => {
  it("injects @tailwindcss/postcss and postcss into package.json devDependencies when missing", () => {
    const rawFiles = [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "demo",
          dependencies: { next: "16.4.6" },
          devDependencies: { tailwindcss: "^4" },
        }),
      },
    ];

    const normalized = normalizeProjectFiles(rawFiles);
    const parsed = JSON.parse(normalized[0].content);

    expect(parsed.devDependencies["@tailwindcss/postcss"]).toBe("^4");
    expect(parsed.devDependencies["postcss"]).toBe("^8");
    expect(parsed.devDependencies["tailwindcss"]).toBe("^4");
    expect(parsed.dependencies["next"]).toBe("16.4.6");
  });

  it("normalizes legacy Next.js 15 to verified Next.js 16.4.6 baseline", () => {
    const rawFiles = [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "demo",
          dependencies: { next: "15.3.9" },
        }),
      },
    ];

    const normalized = normalizeProjectFiles(rawFiles);
    const parsed = JSON.parse(normalized[0].content);

    expect(parsed.dependencies["next"]).toBe("16.4.6");
  });

  it("preserves stable Next.js 16 in dependencies", () => {
    const rawFiles = [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "demo",
          dependencies: { next: "16.4.6" },
        }),
      },
    ];

    const normalized = normalizeProjectFiles(rawFiles);
    const parsed = JSON.parse(normalized[0].content);

    expect(parsed.dependencies["next"]).toBe("16.4.6");
  });

  it("does not overwrite @tailwindcss/postcss if already present in dependencies or devDependencies", () => {
    const rawFiles = [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "demo",
          devDependencies: {
            "@tailwindcss/postcss": "4.1.0",
            postcss: "8.4.38",
          },
        }),
      },
    ];

    const normalized = normalizeProjectFiles(rawFiles);
    const parsed = JSON.parse(normalized[0].content);

    expect(parsed.devDependencies["@tailwindcss/postcss"]).toBe("4.1.0");
    expect(parsed.devDependencies["postcss"]).toBe("8.4.38");
  });

  it("leaves files without package.json intact", () => {
    const rawFiles = [
      { path: "app/page.tsx", content: "export default () => null" },
    ];
    const normalized = normalizeProjectFiles(rawFiles);
    expect(normalized).toEqual(rawFiles);
  });

  it("ensures scripts.dev uses --webpack without duplicating flags", () => {
    const testCases = [
      {
        input: "next dev",
        expected: "next dev --webpack",
      },
      {
        input: "next dev --webpack",
        expected: "next dev --webpack",
      },
      {
        input: "next dev --port 3000",
        expected: "next dev --port 3000 --webpack",
      },
      {
        input: "next dev --webpack -p 3000",
        expected: "next dev --webpack -p 3000",
      },
    ];

    for (const { input, expected } of testCases) {
      const rawFiles = [
        {
          path: "package.json",
          content: JSON.stringify({
            name: "test-app",
            scripts: { dev: input },
          }),
        },
      ];

      const normalized = normalizeProjectFiles(rawFiles);
      const parsed = JSON.parse(normalized[0].content);
      expect(parsed.scripts.dev).toBe(expected);
      // Ensure --webpack appears exactly once
      const matches = parsed.scripts.dev.match(/--webpack/g);
      expect(matches?.length).toBe(1);
    }
  });

  it("creates scripts.dev with next dev --webpack when scripts object or dev script is missing", () => {
    const rawFilesWithoutScripts = [
      {
        path: "package.json",
        content: JSON.stringify({ name: "no-scripts" }),
      },
    ];
    const normalized1 = normalizeProjectFiles(rawFilesWithoutScripts);
    const parsed1 = JSON.parse(normalized1[0].content);
    expect(parsed1.scripts?.dev).toBe("next dev --webpack");

    const rawFilesWithoutDev = [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "no-dev",
          scripts: { build: "next build" },
        }),
      },
    ];
    const normalized2 = normalizeProjectFiles(rawFilesWithoutDev);
    const parsed2 = JSON.parse(normalized2[0].content);
    expect(parsed2.scripts.dev).toBe("next dev --webpack");
    expect(parsed2.scripts.build).toBe("next build");
  });
});

describe("WebContainer Turbopack Error Classifier", () => {
  it("matches real Turbopack unsupported error strings in WebContainer WASM environment", () => {
    const realError1 =
      "Turbopack is not supported on this platform ... Only WebAssembly (WASM) bindings were loaded, and Turbopack requires native bindings.";
    expect(isTurbopackUnsupportedError(realError1)).toBe(true);

    const realError2 =
      "Failed to start dev server: Only WebAssembly (WASM) bindings were loaded";
    expect(isTurbopackUnsupportedError(realError2)).toBe(true);

    const realError3 =
      "Error: Turbopack requires native bindings to execute in this environment";
    expect(isTurbopackUnsupportedError(realError3)).toBe(true);

    const realError4 = "turbopack is not supported on this platform";
    expect(isTurbopackUnsupportedError(realError4)).toBe(true);
  });

  it("strictly rejects normal Next.js warnings, runtime errors, and compilation failures", () => {
    const falsePositives = [
      "Module not found: Can't resolve '@/components/ui/button'",
      "SyntaxError: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
      "Error: listen EADDRINUSE: address already in use :::3000",
      "Fast Refresh: rebuilding app/page.tsx",
      "Warning: Extra attributes from the server: class, style",
      "TypeError: Cannot read properties of undefined (reading 'map')",
      "Failed to compile: Type error: Property 'title' does not exist on type 'Props'",
      "✓ Compiled in 1420ms",
      "ready - started server on 0.0.0.0:3000, url: http://localhost:3000",
      "",
      "   ",
    ];

    for (const msg of falsePositives) {
      expect(isTurbopackUnsupportedError(msg)).toBe(false);
    }
  });
});

describe("WebContainerRuntimeManager State and Lifecycle", () => {
  it("initializes with idle state and null previewUrl", () => {
    const manager = new WebContainerRuntimeManager();
    const state = manager.getState();
    expect(state.status).toBe("idle");
    expect(state.previewUrl).toBeNull();
    expect(state.isServerRunning).toBe(false);
    expect(state.port).toBeNull();
  });

  it("subscribes and notifies listeners on state changes", () => {
    const manager = new WebContainerRuntimeManager();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);

    manager.teardown();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("tears down cleanly and transitions to stopped state", () => {
    const manager = new WebContainerRuntimeManager();
    manager.teardown();
    const state = manager.getState();
    expect(state.status).toBe("stopped");
    expect(state.previewUrl).toBeNull();
    expect(state.port).toBeNull();
    expect(state.error).toBeNull();
    expect(state.isServerRunning).toBe(false);
    expect(state.isInstalling).toBe(false);
  });
});
