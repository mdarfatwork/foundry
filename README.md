# Foundry

A modern web application built with [Next.js](https://nextjs.org) (App Router), React 19, TypeScript, and Tailwind CSS v4.

## Getting Started

### Prerequisites

- **Node.js**: >= 20.9.0 (LTS recommended)
- **Package Manager**: [pnpm](https://pnpm.io/) (v12+)

### Installation

Install dependencies and set up Git hooks automatically via the `prepare` script:

```bash
pnpm install
```

Start the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to view the application.

## Available Scripts

| Script         | Command              | Description                                    |
| -------------- | -------------------- | ---------------------------------------------- |
| `dev`          | `next dev`           | Start development server                       |
| `build`        | `next build`         | Build production bundle                        |
| `start`        | `next start`         | Run production server                          |
| `lint`         | `eslint`             | Run ESLint across codebase                     |
| `typecheck`    | `tsc --noEmit`       | Check TypeScript types without emitting output |
| `format`       | `prettier --write .` | Format all supported files with Prettier       |
| `format:check` | `prettier --check .` | Verify code formatting without modifying files |
| `prepare`      | `husky`              | Initialize Husky Git hooks                     |

## Git Workflow & Quality Gates

Foundry uses [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/lint-staged/lint-staged) to enforce code standards locally before changes reach remote branches:

### Pre-commit Hook (`.husky/pre-commit`)

- Executes `pnpm lint-staged` on staged files followed by `pnpm typecheck`.
- Runs `eslint --fix --no-warn-ignored` and `prettier --write` on staged JavaScript and TypeScript files (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`).
- Runs `prettier --write` on staged documentation, styling, and configuration files (`.json`, `.md`, `.css`, `.scss`, `.html`, `.yaml`, `.yml`).
- Automatically stages formatting and lint fixes.
- Runs TypeScript type checking (`tsc --noEmit`) to prevent commits with type errors.
- Generated files and build artifacts (such as `.next/`, `pnpm-lock.yaml`, and `next-env.d.ts`) are excluded.

## Continuous Integration (GitHub Actions)

The repository runs an automated CI pipeline (`.github/workflows/ci.yml`) on:

- Pushes to `main` and `develop`
- Pull requests targeting `main`

### CI Quality Gates

1. **Clean dependency installation**: Uses `pnpm install --frozen-lockfile` ensuring reproducible installs from `pnpm-lock.yaml`.
2. **Linting**: Runs `pnpm lint`.
3. **Type checking**: Runs `pnpm typecheck`.
4. **Code formatting check**: Runs `pnpm format:check`.
5. **Production build**: Runs `pnpm build`.

Outdated runs for the same branch/ref are automatically canceled using GitHub Actions concurrency groups. Permissions are strictly configured to `contents: read`.

### Running All CI Checks Locally

To replicate the CI pipeline locally before opening a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
```

## Troubleshooting

- **Pre-commit hook didn't run**: Ensure Git hooks are initialized by running `pnpm prepare`.
- **Pre-commit formatting errors**: Run `pnpm format` to automatically format all files in the project.
- **TypeScript errors**: Run `pnpm typecheck` to view detailed TypeScript errors and resolve missing types or incompatible contracts.
- **ESLint conflicts with Prettier**: `eslint-config-prettier` is integrated in `eslint.config.mjs` to disable all ESLint stylistic rules that might conflict with Prettier.
