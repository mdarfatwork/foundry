import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Load environment variables from .env.local when running locally.
 */
try {
  process.loadEnvFile?.(".env.local");
} catch {
  // Ignore in CI or environments without .env.local
}

/**
 * Migration runner for Foundry Drizzle ORM on Supabase PostgreSQL.
 * Applies versioned migrations tracked in the ./drizzle directory.
 * Adheres to AGENTS.md §9 and Prompt §9.
 */
async function runMigrations() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error(
      "❌ Migration aborted: DATABASE_URL (or DIRECT_URL) is not defined in .env.local",
    );
    process.exit(1);
  }

  console.log("🚀 Applying Drizzle migrations to Supabase PostgreSQL...");

  const isLocal =
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1");

  const pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool);

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("✅ Drizzle migrations applied successfully to Supabase!");
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown database error";
    console.error("❌ Migration failed:", errorMessage);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
