# Foundry

Foundry is a high-performance, developer-grade **AI-powered website builder**. It enables developers and product teams to conceptualize, iterate, preview, and deploy production-ready single-page landing applications through conversational AI, multi-provider model routing, and an in-browser WebContainer runtime.

---

## 1. Getting Started

### Prerequisites

- **Node.js**: `>= 20.9.0` (LTS or Node 24 recommended)
- **Package Manager**: [pnpm](https://pnpm.io/) (`v12+`)

### Installation & Local Setup

1. **Clone repository and install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure environment variables:**
   Copy `.env.example` to `.env.local`:

   ```bash
   cp .env.example .env.local
   ```

   Fill in the required provider credentials described in [Environment Variables](#2-environment-variables).

3. **Initialize database schema (Supabase / PostgreSQL):**

   ```bash
   pnpm db:push
   ```

4. **Start the local development server:**
   ```bash
   pnpm dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in a modern Chromium-based browser (Chrome, Edge, Brave) or Firefox with cross-origin isolation support.

---

## 2. Environment Variables

Configure `.env.local` for local execution. **Never commit secrets or actual credentials to version control.**

```bash
# ------------------------------------------------------------------------------
# 1. Better Auth & Application URLs
# ------------------------------------------------------------------------------
BETTER_AUTH_SECRET="your-32-character-better-auth-secret-here"
BETTER_AUTH_URL="http://localhost:3000"

# ------------------------------------------------------------------------------
# 2. Google OAuth V1 Credentials
# ------------------------------------------------------------------------------
GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# ------------------------------------------------------------------------------
# 3. Supabase PostgreSQL Database Connection
# ------------------------------------------------------------------------------
DATABASE_URL="postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres"

# ------------------------------------------------------------------------------
# 4. Multi-Provider AI Inference Layer
# ------------------------------------------------------------------------------
# Active AI provider: "nvidia" | "google" | "openrouter" (default: nvidia)
AI_PROVIDER="nvidia"

# A. NVIDIA Hosted Inference API (https://build.nvidia.com)
NVIDIA_API_KEY="your-nvidia-api-key"
NVIDIA_MODEL="z-ai/glm-5.3-flash"
NVIDIA_BASE_URL="https://integrate.api.nvidia.com/v1"

# B. Google Gemini API (https://ai.google.dev)
GOOGLE_GENERATIVE_AI_API_KEY="your-google-generative-ai-api-key"
GOOGLE_MODEL="gemini-3.5-flash-lite"

# C. OpenRouter API (https://openrouter.ai)
OPENROUTER_API_KEY="your-openrouter-api-key"
OPENROUTER_MODEL="openrouter/free"

# ------------------------------------------------------------------------------
# 5. WebContainers Browser Runtime (StackBlitz)
# ------------------------------------------------------------------------------
# Client API key for commercial / production domains
NEXT_PUBLIC_WEBCONTAINER_API_KEY="your-webcontainer-api-key"
```

---

## 3. Architecture & Features

### 3.1 WebContainers In-Browser Node.js Runtime

Foundry executes generated Next.js applications directly inside the user's browser using `@webcontainer/api` (v1.6.4). The code does not run on a remote VM or container cloud.

- **Singleton Manager (`lib/webcontainer/runtime-manager.ts`):** Guarantees exactly one WebContainer instance is booted concurrently per browser context.
- **Cross-Origin Isolation:** WebContainers require `SharedArrayBuffer`. Foundry configures `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` in `next.config.ts` on `/workspace/:path*` routes. Using `credentialless` avoids CORS/CORP blocking on external assets like Unsplash images and user profile photos.
- **Lifecycle & Dependency Optimization:**
  - Files are mounted from persistent database storage into the virtual filesystem.
  - Dependencies are installed using `npm install --no-audit --no-fund --prefer-offline`.
  - Content hashing on `package.json` ensures `npm install` runs only when dependencies change, never on ordinary UI edits.
  - Development server runs `next dev --webpack` to avoid Turbopack native binary crashes in the WASM Node.js sandbox.
  - Listen for `server-ready` event before mounting the live preview iframe.
  - Real-time file sync via `webcontainer.fs.writeFile` leverages Next.js Hot Module Replacement (HMR).
  - Separate actions for refreshing preview iframe without restarting the container, restarting the server, and reinstalling dependencies.
  - Live collapsible terminal drawer captures and streams `npm` and `next dev` output with secret redaction.

### 3.2 Centralized Multi-Provider AI Layer

Server-only AI integration layer built on the current stable [Vercel AI SDK](https://ai-sdk.dev/):

| Provider          | Integration Package                               | Verified Model ID       | Primary Purpose                                   |
| :---------------- | :------------------------------------------------ | :---------------------- | :------------------------------------------------ |
| **NVIDIA NIM**    | `@ai-sdk/openai-compatible` + custom SSE streamer | `z-ai/glm-5.3-flash`    | Primary landing-page code generation              |
| **Google Gemini** | `@ai-sdk/google`                                  | `gemini-3.5-flash-lite` | Fast clarification assessment & brief structuring |
| **OpenRouter**    | `@openrouter/ai-sdk-provider`                     | `openrouter/free`       | Configurable free/open-source fallback            |

- **Adaptive MCQ Clarification:** Underspecified prompts receive 2–3 domain-targeted multiple choice questions with custom and skip options. Detailed briefs skip clarification to deliver rapid generation.
- **Design References & Safe Inspection:**
  - **Inspiration URLs:** Safe server-side inspection validates URLs against SSRF (rejecting private IPs `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1`, `localhost`, and cloud metadata endpoints `169.254.169.254`). Bounded to 64 KB and 4 seconds.
  - **Screenshots:** PNG, JPEG, and WebP uploads are validated (max 4 MB) and translated into visual styling instructions.
  - **Free Photography:** Curated, verified Unsplash photos with `auto=format&fit=crop&w=1200&q=80` query parameters and `loading="lazy"` attributes prevent broken links.
- **Security by Design:** Untrusted code generated by AI is validated by `validateGeneratedFiles` before persistence. Path traversal (`../`), root config overwrites, and dangerous server-side patterns (`process.env.DATABASE_URL`, `child_process`, `fs`) are strictly rejected.

### 3.3 Persistence & Project Restoration

All project state is persisted in Supabase / PostgreSQL via Drizzle ORM:

- Projects, source files, chat messages, and version snapshots (`v1`, `v2`, ...) are stored in the database.
- A full browser page reload reconstructs the WebContainer virtual filesystem directly from the database.
- Failed generations preserve the last working version snapshot.

---

## 4. Available Scripts

| Script         | Command              | Description                                    |
| :------------- | :------------------- | :--------------------------------------------- |
| `dev`          | `next dev`           | Start development server with Turbopack        |
| `build`        | `next build`         | Build production Next.js application           |
| `start`        | `next start`         | Run production Next.js server                  |
| `lint`         | `eslint`             | Run ESLint across codebase                     |
| `typecheck`    | `tsc --noEmit`       | Check TypeScript types without emitting output |
| `test`         | `vitest run`         | Run automated Vitest test suite                |
| `format`       | `prettier --write .` | Format all supported files with Prettier       |
| `format:check` | `prettier --check .` | Verify code formatting without modifying files |
| `db:push`      | `drizzle-kit push`   | Push Drizzle schema updates to PostgreSQL      |
| `prepare`      | `husky`              | Initialize Husky Git hooks                     |

---

## 5. Quality Gates & Continuous Integration

To replicate GitHub Actions CI locally:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
```

---

## 6. Troubleshooting

- **"Cross-Origin Isolation Required" in Preview:**
  WebContainers require COOP and COEP headers. Ensure `next.config.ts` includes `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` on `/workspace/:path*`.
- **Next.js Dev Server Exited with Code in WebContainer:**
  Click the "Logs" button in the canvas toolbar to inspect terminal output. Turbopack native Rust binaries cannot run in WebAssembly; ensure generated `package.json` scripts use `next dev --webpack`.
- **AI Rate Limit (HTTP 429):**
  Switch provider in the chat header dropdown (e.g. from NVIDIA to Google Gemini or OpenRouter), or wait a moment for the quota window to reset.
- **URL Inspection Blocked:**
  Foundry blocks private IP addresses, loopback hosts, and internal metadata endpoints to prevent SSRF vulnerabilities. Provide a public HTTPS URL or upload a screenshot.

---

## 7. Commercial & Licensing Considerations

- **StackBlitz WebContainer API:** Free for non-commercial open-source use. Commercial production deployments require an API key from StackBlitz (`NEXT_PUBLIC_WEBCONTAINER_API_KEY`).
- **Google Gemini API:** Free tier usage may log prompts according to Google terms. Paid tiers offer enterprise privacy and zero prompt retention.
- **Unsplash Photography:** Ensure generated designs adhere to the Unsplash License (free for commercial and non-commercial use without permission, but attribution is appreciated).

---

## 8. Official Documentation & References

- [WebContainers API Documentation](https://webcontainers.io/)
- [WebContainers API GitHub](https://github.com/stackblitz/webcontainer-api)
- [Vercel AI SDK Documentation](https://ai-sdk.dev/)
- [Vercel AI SDK GitHub](https://github.com/vercel/ai)
- [Google Gemini API Models](https://ai.google.dev/gemini-api/docs/models)
- [OpenRouter API Documentation](https://openrouter.ai/docs)
- [NVIDIA NIM Model Catalog](https://build.nvidia.com/models)
- [Next.js App Router Documentation](https://nextjs.org/docs/app)
- [Tailwind CSS v4 Documentation](https://tailwindcss.com/)
- [shadcn/ui Documentation](https://ui.shadcn.com/)
- [Motion for React](https://motion.dev/)
