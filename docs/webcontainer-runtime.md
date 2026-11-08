# Foundry WebContainers Runtime, Starter Template & Persistent Logging

> **Production Architecture & Operations Guide: Phase 1**  
> Covers Next.js 16 Starter Template, In-Browser WebContainer Runtime, and Database Persistent Diagnostics.

---

## 1. Verified Starter Stack & Package Versions

New Foundry projects initialize from a deterministic, production-ready starter template located at [`lib/templates/starter-nextjs.ts`](file:///l:/Mohammad%20%20Arfat/course/web%20delepment/files/foundry/lib/templates/starter-nextjs.ts).

### Verified Versions

| Component / Layer | Version / Spec                             | Notes                                                                                                                 |
| :---------------- | :----------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| **Framework**     | Next.js `16.4.5` (App Router)              | Latest verified stable Next.js 16 release (verified against npm registry). Dev command: `next dev -p 3000 --webpack`. |
| **UI Runtime**    | React `19.3.0` & React DOM `19.3.0`        | React 19 functional components, Rules of React, Zero hydration mismatch.                                              |
| **Language**      | TypeScript `^5.x`                          | Strict checking (`"strict": true`, `"moduleResolution": "bundler"`, `@/*` alias).                                     |
| **Styling**       | Tailwind CSS `^4` + `@tailwindcss/postcss` | Tailwind v4 with `@theme inline` OKLCH tokens and `tw-animate-css`.                                                   |
| **UI Primitives** | `@base-ui/react ^1.9.0`                    | shadcn `base-nova` style. Uses Base UI `render` prop convention (never Radix `asChild`).                              |
| **Icons**         | `lucide-react ^1.62.0`                     | Minimal, intentional icon set (`Sparkles`, `ArrowRight`, etc.).                                                       |
| **Class Merger**  | `cn ^0.5.0` (`lib/utils.ts`)               | Re-exported `cn` helper for merging classes.                                                                          |
| **Container API** | `@webcontainer/api ^1.6.4`                 | Official StackBlitz WebContainer browser runtime API.                                                                 |

All configuration files (`package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `components.json`) reside at the project root—never nested inside `config/`.

---

## 2. Project Initialization & File Persistence

1. **Deterministic File Generation:**  
   When a user creates a project, `getStarterTemplateFiles(projectName)` produces the full file tree.
2. **Atomic Database Transaction:**  
   In [`app/actions/project.ts`](file:///l:/Mohammad%20%20Arfat/course/web%20delepment/files/foundry/app/actions/project.ts), `createProjectAction` inserts:
   - `project` row (owned exclusively by `user.id`).
   - `project_file` rows for all persistent starter files.
   - `project_version` record for version `v1` (snapshot).
   - Scoped `conversation` and initial welcome `message`.
3. **Restoration from Database:**  
   On workspace reload or new session, `getProjectFilesAction(projectId)` fetches and normalizes the saved files from Supabase PostgreSQL, restoring the virtual filesystem without data loss.

---

## 3. WebContainer Runtime Lifecycle

The runtime manager ([`lib/webcontainer/runtime-manager.ts`](file:///l:/Mohammad%20%20Arfat/course/web%20delepment/files/foundry/lib/webcontainer/runtime-manager.ts)) operates as a browser singleton attached to `globalThis` to prevent destruction during React Fast Refresh / HMR.

### State Model

The runtime follows an explicit, uncontradictory state machine:

```
[idle] ──> [booting] ──> [mounting] ──> [installing] ──> [starting] ──> [ready]
  │           │              │              │               │              │
  │           ▼              ▼              ▼               ▼              ▼
  └───────> [failed] <─────────────────────────────────────────────────────┘
               │
               ▼ (User retries or recovers)
         [recovering] ──> [installing] / [starting] ──> [ready]
               │
               ▼ (Teardown on exit)
           [stopped]
```

- `idle`: Runtime initialized; ready to accept workspace files.
- `booting`: Booting the virtual WebContainer Node.js WebAssembly environment.
- `mounting`: Writing virtual files to the WebContainer root.
- `installing`: Running `npm install --prefer-offline` (with bounded timeout of 180s).
- `starting`: Spawning `npm run dev` (Next.js development server).
- `ready`: Server emitted `server-ready` event; live preview iframe loaded.
- `recovering`: Cleaning stale processes and retrying mount/install.
- `failed`: An error occurred during boot, install, compile, or server startup.
- `stopped`: Explicit teardown when user exits workspace.
- `unsupported`: Browser lacks Cross-Origin Isolation (COOP/COEP headers).

---

## 4. Persistent Logging Architecture

Foundry captures process output and runtime diagnostics, streaming them to a dedicated database table (`runtime_log`) so post-mortem investigations can be conducted even after the user closes the browser.

### Flow Diagram

```
[WebContainer Process (stdout/stderr)]
              │
              ▼
[WebContainerRuntimeManager] ──> Appends to live in-memory UI buffer
              │
              ▼
    [Client-side Redaction] (lib/logging/redaction.ts)
              │
              ▼
   [WebContainerLogger Queue] (lib/webcontainer/logger.ts)
              │
      ┌───────┴────────────────────────────┐
      ▼ (Debounced Batch: 25 items / 2s)   ▼ (Immediate: errors/warnings/unload)
[POST /api/projects/:id/logs]
      │
      ▼
 [Authentication & Ownership Verification] (Better Auth + Drizzle)
      │
      ▼
 [Server-side Redaction & Zod Validation]
      │
      ▼
 [Drizzle Insert -> Supabase PostgreSQL (runtime_log)]
```

### Captured Lifecycle Events

1. **WebContainer Boot:** `webcontainer_boot_start`, `webcontainer_boot_success`, `webcontainer_boot_failure`, `webcontainer_recovered`, `api_key_configured`.
2. **Mounting:** `mount_start`, `mount_success`, `mount_error`.
3. **Installation:** `install_start`, `install_output` (stdout/stderr chunks), `install_success`, `install_failure`, `install_timeout`.
4. **Dev Server:** `dev_server_spawn`, `dev_server_output`, `server_ready` (with port and URL), `port_open`, `port_close`, `dev_server_exit`, `dev_server_timeout`.
5. **Hot Reload / Sync:** `file_synced`, `file_write_error`, `package_json_changed`.
6. **Recovery:** `recovery_attempt`, `recovery_failed`.

---

## 5. Security, Authorization & Privacy Redaction

### Authorization & Tenant Isolation

- **Endpoint Security:** `/api/projects/[id]/logs` and `persistRuntimeLogsAction` / `getProjectRuntimeLogsAction` authenticate sessions via Better Auth.
- **Tenant Verification:** The backend confirms `project.ownerId === session.user.id`. Requests attempting to read or write logs for another user's project are rejected with HTTP 403 / `FORBIDDEN`.
- **Rate Limiting:** A sliding window restricts writes to 60 batch requests per minute per project.

### Secret Redaction (Client & Server)

All logs pass through [`lib/logging/redaction.ts`](file:///l:/Mohammad%20%20Arfat/course/web%20delepment/files/foundry/lib/logging/redaction.ts) before transport and again before database insertion:

- **NVIDIA NIM API Keys:** `nvapi-[a-zA-Z0-9_-]{16,}` -> `[REDACTED_NVIDIA_KEY]`
- **OpenAI / General Keys:** `sk-[a-zA-Z0-9_-]{16,}` -> `[REDACTED_API_KEY]`
- **GitHub Tokens:** `gh[pousr]_[a-zA-Z0-9]{36,}` -> `[REDACTED_GITHUB_TOKEN]`
- **PostgreSQL Credentials:** `postgres://user:password@host...` -> `postgres://user:[REDACTED_DB_PASSWORD]@host...`
- **Auth Headers & Cookies:** `Bearer ...`, `cookie: ...` -> `[REDACTED_AUTH]`, `[REDACTED_COOKIE]`
- **Google / AWS / WebContainer Keys:** Automatically detected and masked.
- **Size Bounds:** Messages are capped at 4 KB; structured details at 16 KB. Circular references are safely broken with `[Circular]`.

---

## 6. Inspecting Project Logs & Diagnostics UI

Project owners can inspect runtime logs directly in the workspace canvas via the Diagnostics drawer ([`components/workspace/workspace-diagnostics-panel.tsx`](file:///l:/Mohammad%20%20Arfat/course/web%20delepment/files/foundry/components/workspace/workspace-diagnostics-panel.tsx)):

1. **Live Terminal Tab:** Real-time raw terminal stdout/stderr stream with one-click copy.
2. **Persisted Logs (DB) Tab:** Historical logs queried from PostgreSQL:
   - Filter by **Level** (All, Error, Warn, Info, Debug).
   - Filter by **Source** (All, WebContainer, Installer, Dev Server, Client).
   - Displays timestamp, event type, session ID, exit codes, and expandable JSON details.
   - Cursor-based pagination ("Load More Logs").
   - Live DB sync status indicator.

---

## 7. Troubleshooting & Recovery

| Issue                               | Root Cause                                              | Solution                                                                                                               |
| :---------------------------------- | :------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------- |
| **"Isolation Required"**            | Missing COOP / COEP headers or browser unsupported.     | Ensure headers in `next.config.ts` are active. Use Chrome, Edge, Brave, or Firefox.                                    |
| **npm install timeout**             | Network latency or npm registry freeze in WebContainer. | Click **"Reinstall npm"** in the error banner. The runtime will kill the hanging process and retry.                    |
| **"Port closed" / Dev Server Exit** | Syntax error in `app/page.tsx` or missing dependency.   | Open the **Logs** drawer, switch to **Persisted Logs**, filter by **Errors** to inspect the compile stack trace.       |
| **Referrer Mismatch**               | Using production WebContainer API key on localhost.     | Set `NEXT_PUBLIC_WEBCONTAINER_API_KEY` only in production, or register localhost in your StackBlitz Developer Console. |

---

## 8. Delivery Limitations & Known Constraints

- **Page Unload / Crash:** Logs are flushed on `beforeunload` / `pagehide` using `navigator.sendBeacon` and `fetch(..., { keepalive: true })`. However, if the browser process is killed abruptly (SIGKILL, OS crash, device power loss), in-flight logs buffered within the last 2 seconds before the crash may not reach the database.
- **WebContainer Commercial Licensing:** Commercial production use of StackBlitz WebContainers requires a commercial agreement with StackBlitz. Verify licensing terms prior to public commercial launch.

---

## 9. Official Documentation & References

- [Next.js App Router Documentation](https://nextjs.org/docs/app)
- [Next.js GitHub Repository](https://github.com/vercel/next.js)
- [React 19 Rules & Reference](https://react.dev/reference/rules)
- [shadcn/ui Installation for Next.js](https://ui.shadcn.com/docs/installation/next)
- [Tailwind CSS v4 Documentation](https://tailwindcss.com/docs)
- [WebContainers Official Documentation](https://webcontainers.io/)
- [WebContainers API Reference](https://webcontainers.io/api)
- [WebContainers API GitHub](https://github.com/stackblitz/webcontainer-api)
