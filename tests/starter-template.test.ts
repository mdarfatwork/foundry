import { describe, it, expect } from "vitest";
import {
  getStarterTemplateFiles,
  STARTER_TEMPLATE_ID,
} from "@/lib/templates/starter-nextjs";

describe("Starter Template Generator", () => {
  it("uses the canonical template ID", () => {
    expect(STARTER_TEMPLATE_ID).toBe("nextjs-shadcn-v1");
  });

  it("produces deterministic starter files for a project", () => {
    const files = getStarterTemplateFiles("My SaaS Platform");
    expect(files.length).toBeGreaterThanOrEqual(11);

    const paths = files.map((f) => f.path);
    expect(paths).toContain("package.json");
    expect(paths).toContain("tsconfig.json");
    expect(paths).toContain("next.config.ts");
    expect(paths).toContain("postcss.config.mjs");
    expect(paths).toContain("components.json");
    expect(paths).toContain("app/layout.tsx");
    expect(paths).toContain("app/page.tsx");
    expect(paths).toContain("app/globals.css");
    expect(paths).toContain("lib/utils.ts");
    expect(paths).toContain("components/ui/button.tsx");
    expect(paths).toContain("components/ui/card.tsx");
    expect(paths).toContain("components/ui/badge.tsx");
  });

  it("ensures root-level configuration files are stored at project root, NOT under config/", () => {
    const files = getStarterTemplateFiles("Foundry Project");
    const paths = files.map((f) => f.path);

    // None should start with "config/"
    for (const p of paths) {
      expect(p.startsWith("config/")).toBe(false);
    }

    // Root configuration files must have no directory component
    expect(paths).toContain("package.json");
    expect(paths).toContain("tsconfig.json");
    expect(paths).toContain("next.config.ts");
    expect(paths).toContain("postcss.config.mjs");
    expect(paths).toContain("components.json");

    // Utilities must be under lib/
    expect(paths).toContain("lib/utils.ts");
  });

  it("generates valid package.json with sanitized project name", () => {
    const files = getStarterTemplateFiles("My Awesome Project!");
    const pkgFile = files.find((f) => f.path === "package.json");
    expect(pkgFile).toBeDefined();

    const parsed = JSON.parse(pkgFile!.content);
    expect(parsed.name).toBe("my-awesome-project");
    expect(parsed.dependencies["next"]).toBe("15.3.9");
    expect(parsed.dependencies["react"]).toBe("19.3.0");
    expect(parsed.dependencies["@base-ui/react"]).toBe("^1.9.0");
    expect(parsed.devDependencies["@tailwindcss/postcss"]).toBeDefined();
    expect(parsed.devDependencies["postcss"]).toBeDefined();
  });

  it("generates valid app/page.tsx with export default component", () => {
    const files = getStarterTemplateFiles("Analytics Dashboard");
    const pageFile = files.find((f) => f.path === "app/page.tsx");
    expect(pageFile).toBeDefined();
    expect(pageFile!.content).toContain("export default function");
    expect(pageFile!.content).toContain("Analytics Dashboard");
  });

  it("includes valid components.json matching shadcn base-nova config", () => {
    const files = getStarterTemplateFiles("Test App");
    const componentsJson = files.find((f) => f.path === "components.json");
    expect(componentsJson).toBeDefined();

    const parsed = JSON.parse(componentsJson!.content);
    expect(parsed.style).toBe("base-nova");
    expect(parsed.aliases.ui).toBe("@/components/ui");
    expect(parsed.aliases.utils).toBe("@/lib/utils");
  });
});
