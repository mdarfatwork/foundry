import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getDbPool } from "@/lib/auth/db";
import * as schema from "./schema";

/**
 * Foundry Typed Drizzle ORM Database Instance.
 * Connects to Supabase PostgreSQL using connection pooling.
 * Adheres to AGENTS.md §2, §9, and §10.
 */

function resolvePool(): Pool {
  if (process.env.DATABASE_URL) {
    return getDbPool();
  }
  // Safe fallback for static CI build where database is unconfigured
  return new Pool({
    connectionString: "postgresql://localhost:5432/foundry_placeholder",
  });
}

export const db: NodePgDatabase<typeof schema> = drizzle(resolvePool(), {
  schema,
});

export * from "./schema";
