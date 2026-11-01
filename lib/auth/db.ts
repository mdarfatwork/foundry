import { Pool, type PoolConfig } from "pg";

/**
 * PostgreSQL connection management for Supabase and Better Auth.
 * Adheres to AGENTS.md §9 and §10: connection pooling, SSL safety, no connection string leaks.
 */

declare global {
  var __foundryPgPool: Pool | undefined;
}

const DEFAULT_POOL_MAX = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;

export function createPoolConfig(connectionString: string): PoolConfig {
  const isLocal =
    connectionString.includes("localhost") ||
    connectionString.includes("127.0.0.1");

  return {
    connectionString,
    ssl: isLocal
      ? false
      : {
          rejectUnauthorized: false,
        },
    max: process.env.NODE_ENV === "production" ? DEFAULT_POOL_MAX : 5,
    idleTimeoutMillis: DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
  };
}

/**
 * Returns the cached or newly initialized PostgreSQL Pool singleton.
 */
export function getDbPool(): Pool {
  if (globalThis.__foundryPgPool) {
    return globalThis.__foundryPgPool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is not defined. Ensure your Supabase PostgreSQL connection string is set in .env.local",
    );
  }

  const pool = new Pool(createPoolConfig(connectionString));

  pool.on("error", (err) => {
    // Redact connection details when logging database pool errors
    console.error("[Foundry DB Pool Error]:", err.message);
  });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__foundryPgPool = pool;
  }

  return pool;
}
