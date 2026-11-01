/**
 * Environment configuration and validation for Foundry Better Auth.
 * Adheres to AGENTS.md §7.3 and §11: Server-side validation, zero secrets in client code.
 */

export type AuthEnv = Readonly<{
  betterAuthSecret: string;
  betterAuthUrl: string;
  databaseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  directUrl?: string;
}>;

/**
 * Validates and retrieves required authentication environment variables.
 * Fails closed with descriptive errors when mandatory credentials are missing.
 */
export function getAuthEnv(): AuthEnv {
  const betterAuthSecret = process.env.BETTER_AUTH_SECRET;
  const betterAuthUrl =
    process.env.BETTER_AUTH_URL ||
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  const databaseUrl = process.env.DATABASE_URL;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const directUrl = process.env.DIRECT_URL;

  const missing: string[] = [];

  if (!betterAuthSecret) {
    missing.push("BETTER_AUTH_SECRET");
  }
  if (!betterAuthUrl) {
    missing.push("BETTER_AUTH_URL");
  }
  if (!databaseUrl) {
    missing.push("DATABASE_URL");
  }
  if (!googleClientId) {
    missing.push("GOOGLE_CLIENT_ID");
  }
  if (!googleClientSecret) {
    missing.push("GOOGLE_CLIENT_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required authentication environment configuration: ${missing.join(
        ", ",
      )}. Please verify your .env file or deployment settings.`,
    );
  }

  return {
    betterAuthSecret: betterAuthSecret!,
    betterAuthUrl,
    databaseUrl: databaseUrl!,
    googleClientId: googleClientId!,
    googleClientSecret: googleClientSecret!,
    directUrl,
  };
}

/**
 * Non-throwing environment check for diagnostic reporting and readiness probes.
 */
export function checkAuthEnvStatus(): Readonly<{
  isConfigured: boolean;
  missingVariables: readonly string[];
}> {
  const missing: string[] = [];

  if (!process.env.BETTER_AUTH_SECRET) missing.push("BETTER_AUTH_SECRET");
  if (!process.env.BETTER_AUTH_URL && process.env.NODE_ENV === "production") {
    missing.push("BETTER_AUTH_URL");
  }
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");

  return {
    isConfigured: missing.length === 0,
    missingVariables: missing,
  };
}
