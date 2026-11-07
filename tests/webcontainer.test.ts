import { describe, it, expect } from "vitest";
import { buildFileSystemTree } from "@/lib/webcontainer/tree";
import { isLocalOrPrivateHost } from "@/lib/webcontainer/runtime-manager";
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
