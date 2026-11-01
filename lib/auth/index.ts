import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import {
  user,
  session,
  account,
  verification,
  project,
  userRelations,
  sessionRelations,
  accountRelations,
  projectRelations,
} from "@/lib/db/schema";

/**
 * Foundry Better Auth Server Configuration.
 * Powered by Drizzle ORM and Supabase PostgreSQL.
 * Single source of truth for authentication across the application.
 * Adheres to AGENTS.md §2, §5.1, §7, §9, §10, and §11.
 */

const authBaseUrl =
  process.env.BETTER_AUTH_URL ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");

const trustedOrigins: string[] = [];
if (authBaseUrl) {
  trustedOrigins.push(authBaseUrl);
}
if (process.env.NODE_ENV !== "production") {
  trustedOrigins.push("http://localhost:3000", "http://127.0.0.1:3000");
}

export const auth = betterAuth({
  baseURL: authBaseUrl,
  secret:
    process.env.BETTER_AUTH_SECRET ||
    "placeholder-secret-at-least-32-characters-for-build",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user,
      session,
      account,
      verification,
      project,
      userRelations,
      sessionRelations,
      accountRelations,
      projectRelations,
    },
  }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      scope: ["openid", "email", "profile"],
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes signed cookie cache
    },
    expiresIn: 60 * 60 * 24 * 7, // 7 days session lifetime
    updateAge: 60 * 60 * 24, // Update session once per 24 hours
  },
  trustedOrigins,
  advanced: {
    database: {
      joins: true, // Optimized Drizzle relationship joins
    },
    useSecureCookies: process.env.NODE_ENV === "production",
  },
});

export type Session = typeof auth.$Infer.Session;
