import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import eslintConfigPrettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  eslintConfigPrettier,
  {
    rules: {
      // Enforce AGENTS.md §5.1: Prohibit full React namespace imports
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'ImportDeclaration[source.value="react"] > ImportNamespaceSpecifier',
          message:
            'Do not import * as React. Use named imports instead (e.g. import { useState } from "react"). See AGENTS.md §5.1.',
        },
      ],
      // Enforce AGENTS.md §6.1: Prohibit inline static-analysis evasion comments
      "no-warning-comments": [
        "error",
        {
          terms: ["NOSONAR"],
          location: "anywhere",
        },
      ],
      // Clean Code: No empty catch blocks (AGENTS.md §6.1)
      "no-empty": [
        "error",
        {
          allowEmptyCatch: false,
        },
      ],
      // Clean Code: Strict equality
      eqeqeq: ["error", "always", { null: "ignore" }],
      // Clean Code: Prefer const for immutability
      "prefer-const": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // External agent skills vendor directory
    ".agents/**",
  ]),
]);

export default eslintConfig;
