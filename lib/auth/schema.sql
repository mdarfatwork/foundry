-- ==============================================================================
-- Foundry Authentication & Core Schema (PostgreSQL / Supabase)
-- Single source of truth: Better Auth V1
-- Adheres to AGENTS.md §2, §7, §9, §10, and Supabase Security Guidelines.
-- ==============================================================================

-- 1. Core Users Table
CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Sessions Table
CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT PRIMARY KEY,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

-- 3. Accounts Table (OAuth Identity Providers - Google V1)
CREATE TABLE IF NOT EXISTS "account" (
    "id" TEXT PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
    "refreshTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_provider_account_unique" UNIQUE ("providerId", "accountId")
);

-- 4. Verification Table (Transient security tokens, state, nonces)
CREATE TABLE IF NOT EXISTS "verification" (
    "id" TEXT PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Foundry Application Domain: Projects Table
CREATE TABLE IF NOT EXISTS "project" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "prompt" TEXT,
    "ownerId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "session_token_idx" ON "session" ("token");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");
CREATE INDEX IF NOT EXISTS "project_ownerId_idx" ON "project" ("ownerId");

-- Row Level Security (RLS) for Supabase Exposed Public Schema Defense-in-Depth
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project" ENABLE ROW LEVEL SECURITY;

