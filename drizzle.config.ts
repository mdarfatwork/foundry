import { defineConfig } from "drizzle-kit";

/**
 * Load .env.local if present in development environment
 */
try {
  process.loadEnvFile?.(".env.local");
} catch {
  // Ignore in CI or environments without .env.local
}

/**
 * Drizzle Kit Configuration for Foundry.
 * Manages migrations and schema synchronization for Supabase PostgreSQL.
 * Adheres to AGENTS.md §9 and §10.
 */
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
});
