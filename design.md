# Foundry Design System (`design.md`)

This document is the **single source of truth** for all visual design decisions, component conventions, tokens, and theme behaviors across Foundry. Any AI coding agent or frontend engineer developing, styling, or extending Foundry must adhere strictly to these guidelines.

---

## 1. Product Identity

### What Foundry Is

Foundry is a high-performance, developer-grade **AI-powered website builder**. It empowers developers and product teams to conceptualize, iterate, and generate production-ready React / Next.js web applications through conversational natural language and direct code inspection.

### Intended Visual Personality

- **Developer-Grade & Serious:** Foundry looks and feels like an elite developer tool (akin to Linear, Vercel, Raycast, and GitHub), rather than a playful SaaS marketing dashboard or generic consumer chatbot.
- **Calm & Unobtrusive:** The chrome steps into the background. The generated application and the prompt composer are the heroes of the screen.
- **High-Density, High-Precision:** Compact controls, razor-sharp 1px borders, subtle surface elevations, and monospace metadata badges communicate rigor and precision.

### Core Design Principles

1. **Prompt-First:** The user prompt composer is the focal instrument of creation—always immediately accessible and tactile.
2. **Minimal Chrome:** Toolbars, navigation, and settings remain quiet, compact, and monochromatic.
3. **Content Over Decoration:** Generated applications must never compete with decorative builder gradients, glassmorphism, or neon accents.
4. **Precise Visual Hierarchy:** Typography weights, subdued contrast steps, and controlled spacing establish importance without heavy drop shadows or colored borders.
5. **Theme Parity:** Light and dark modes are treated with equal intentionality—neither is an afterthought.
6. **Functional Simplicity:** Every visible button, switch, and indicator has a concrete purpose; no non-functional placeholder controls.

---

## 2. Reference Inspiration & Boundaries

### Observed Principles from [v0.app](https://v0.app/)

Foundry studies the UX and architectural strengths of v0.app:

- Deep neutral monochrome color foundation.
- High-contrast separation between workspace controls and the preview canvas.
- Multiline prompt composer anchored with quick context chips and keyboard accelerators (`⌘Enter`).
- Split-screen duality between interactive preview and inspectable TypeScript JSX code.
- Clean viewport toggling (Desktop, Tablet, Mobile) directly above the canvas.

### What Foundry Deliberately Does Not Copy

- **No v0 branding or assets:** Foundry has its own brand mark (the Foundry Forge / Flame), typography pairings, and layout structures.
- **No proprietary iconography or styling hacks:** Foundry exclusively uses open standard primitives from [shadcn/ui](https://ui.shadcn.com/) powered by `@base-ui/react` and `lucide-react`.
- **Integrated Design System Inspector:** Foundry includes a native dialog inspector for tokens and primitives directly within the top header.

---

## 3. Color Tokens & Semantic Surfaces

Foundry utilizes **OKLCH** color values mapped to CSS custom variables in `app/globals.css`. Never write raw hex, RGB, or arbitrary utility classes (e.g., `bg-[#18181b]`) in component files. Always use semantic Tailwind color classes (e.g., `bg-background`, `text-foreground`, `border-border`, `bg-card`).

### Semantic Color Table

| Semantic Token             | Light Mode Value            | Dark Mode Value       | Architectural Role                                   |
| :------------------------- | :-------------------------- | :-------------------- | :--------------------------------------------------- |
| `--background`             | `oklch(0.985 0 0)`          | `oklch(0.12 0 0)`     | Base application canvas and outer margins            |
| `--foreground`             | `oklch(0.145 0 0)`          | `oklch(0.985 0 0)`    | Primary readable body text and headings              |
| `--card`                   | `oklch(1 0 0)`              | `oklch(0.165 0 0)`    | Elevated surfaces: panels, cards, preview containers |
| `--card-foreground`        | `oklch(0.145 0 0)`          | `oklch(0.985 0 0)`    | Text placed on top of cards                          |
| `--popover`                | `oklch(1 0 0)`              | `oklch(0.165 0 0)`    | Floating menus, dropdowns, dialogs, and popovers     |
| `--popover-foreground`     | `oklch(0.145 0 0)`          | `oklch(0.985 0 0)`    | Text inside popovers and dropdown items              |
| `--primary`                | `oklch(0.145 0 0)`          | `oklch(0.985 0 0)`    | Primary high-emphasis buttons and submit actions     |
| `--primary-foreground`     | `oklch(0.985 0 0)`          | `oklch(0.12 0 0)`     | Text inside primary buttons                          |
| `--secondary`              | `oklch(0.955 0 0)`          | `oklch(0.22 0 0)`     | Secondary buttons, inactive tabs, chat bubbles       |
| `--secondary-foreground`   | `oklch(0.205 0 0)`          | `oklch(0.985 0 0)`    | Text on secondary surfaces                           |
| `--muted`                  | `oklch(0.955 0 0)`          | `oklch(0.20 0 0)`     | Neutral backgrounds, code block backdrops            |
| `--muted-foreground`       | `oklch(0.55 0 0)`           | `oklch(0.65 0 0)`     | Secondary labels, timestamps, placeholders           |
| `--accent`                 | `oklch(0.95 0 0)`           | `oklch(0.22 0 0)`     | Hover, active, and selected states                   |
| `--accent-foreground`      | `oklch(0.145 0 0)`          | `oklch(0.985 0 0)`    | Foreground on hover/active states                    |
| `--destructive`            | `oklch(0.577 0.245 27.325)` | `oklch(0.65 0.22 25)` | Error alerts, dangerous actions                      |
| `--destructive-foreground` | `oklch(0.985 0 0)`          | `oklch(0.985 0 0)`    | High-contrast text on destructive surfaces           |
| `--border`                 | `oklch(0.91 0 0)`           | `oklch(1 0 0 / 10%)`  | Structural panel dividers, card boundaries           |
| `--input`                  | `oklch(0.91 0 0)`           | `oklch(1 0 0 / 14%)`  | Text field and control outlines                      |
| `--ring`                   | `oklch(0.35 0 0)`           | `oklch(0.75 0 0)`     | Focus-visible ring outlines                          |

### Sidebar Tokens

- `--sidebar`: `oklch(0.975 0 0)` (light) / `oklch(0.145 0 0)` (dark)
- `--sidebar-foreground`: `oklch(0.205 0 0)` (light) / `oklch(0.985 0 0)` (dark)
- `--sidebar-border`: `oklch(0.91 0 0)` (light) / `oklch(1 0 0 / 10%)` (dark)

---

## 4. Typography

Foundry uses the **Geist** font family loaded via `next/font/google` in `app/layout.tsx`.

### Font Variables

- **UI Sans:** `var(--font-geist-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Code & Metadata:** `var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

### Typography Scale & Hierarchy

| Role                    | Class Names                                                 | Usage                                       |
| :---------------------- | :---------------------------------------------------------- | :------------------------------------------ |
| **Display Heading**     | `text-3xl sm:text-5xl font-semibold tracking-tight`         | Landing heroes, large banner statements     |
| **Page Heading**        | `text-xl sm:text-2xl font-semibold tracking-tight`          | Top-level workspace and modal headers       |
| **Section Heading**     | `text-sm sm:text-base font-semibold tracking-tight`         | Card titles, panel titles, section headers  |
| **Body (Default)**      | `text-xs sm:text-sm text-foreground leading-relaxed`        | Chat messages, dialog body, descriptions    |
| **Secondary / Subtext** | `text-xs text-muted-foreground`                             | Helper descriptions, captions               |
| **Metadata / Badges**   | `font-mono text-[10px] sm:text-xs uppercase tracking-wider` | Model names, versions, statuses, timestamps |
| **Code Blocks**         | `font-mono text-xs leading-relaxed`                         | Syntax preview, terminal commands           |

---

## 5. Spacing, Radii, Borders, and Shadows

### Radius Scale

Foundry standardizes on a **compact base radius** of `0.5rem` (8px):

- `--radius-sm`: `0.25rem` (4px) — Chips, badges, small icons, inner nested buttons.
- `--radius-md`: `0.375rem` (6px) — Inputs, dropdown items, secondary action buttons.
- `--radius-lg`: `0.5rem` (8px) — Cards, prompt composer container, dialogs.
- `--radius-xl`: `0.75rem` (12px) — Canvas preview frames, large modal overlays.

> **Rule:** Never use pill buttons (`rounded-full`) for standard application action buttons. Reserve `rounded-full` strictly for user avatars, status dots, and pill tags.

### Borders

- Standard thickness is `1px` (`border`).
- Light mode uses a subtle solid gray (`--border: oklch(0.91 0 0)`).
- Dark mode uses a subtle alpha border (`--border: oklch(1 0 0 / 10%)`), allowing elevated surfaces to sit cleanly over darker backgrounds without harsh contrasting lines.

### Elevation & Shadows

- Shadows are used sparingly (`shadow-xs` or `shadow-sm`).
- Layer separation is achieved primarily through **border contrast** and **surface luminance shifts** (`background` vs `card` vs `popover`).

---

## 6. Component Conventions

### shadcn/ui Base Architecture

Foundry's shadcn/ui installation is built on top of **`@base-ui/react`** (`style: "base-nova"`).

> **Critical Base UI Convention:** Unlike legacy Radix-based shadcn components that used `asChild`, Base UI triggers use the **`render` prop**:
>
> ```tsx
> // Correct in Foundry:
> <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />} />
> <DialogTrigger render={<Button variant="outline" size="sm" />} />
> <TooltipTrigger render={<button className="..." />} />
>
> // Incorrect (will cause TypeScript compiler error TS2322):
> <DropdownMenuTrigger asChild><Button ... /></DropdownMenuTrigger>
> ```

### Component Guidelines

- **Buttons (`components/ui/button.tsx`):**
  - `default`: Primary dark action (light mode) / crisp white (dark mode).
  - `secondary`: Subdued background for supporting interactions.
  - `outline`: Bordered button for secondary options like Code/Preview, Share, Design System.
  - `ghost`: Borderless for header actions, close buttons, and icon triggers.
  - `destructive`: Error actions with subdued red background.
  - Sizes: `xs` (24px), `sm` (28px), `default` (32px), `lg` (36px), `icon-xs` (24x24), `icon-sm` (28x28).
- **Inputs & Textareas:**
  - Styled with `bg-transparent`, subtle border, and high-visibility focus ring (`focus-visible:ring-2 focus-visible:ring-ring/20`).
- **Cards (`components/ui/card.tsx`):**
  - Used for isolated UI modules and preview surfaces with `bg-card` and `border-border`.
- **Badges (`components/ui/badge.tsx`):**
  - Compact height (`h-4.5` to `h-5`), monospace metadata, used for status indicators and version labels.

---

## 7. Light and Dark Modes

### Implementation Details

- Managed by `next-themes` via `components/theme-provider.tsx`.
- Applied at the document root (`<html class="dark" ...>`).
- Hydration safe: uses `suppressHydrationWarning` on `<html>` and `useSyncExternalStore` in `components/theme-toggle.tsx` to eliminate hydration warnings and client flashes.
- **Magic UI Animated Theme Toggler:**
  - Integrated `components/ui/animated-theme-toggler.tsx` using the native **View Transitions API** (`document.startViewTransition`).
  - Expanding circular clip-path transition originates dynamically from the click coordinates `(x, y)` to cover the maximum viewport diagonal.
  - Controlled by `next-themes` (`theme` and `onThemeChange` props).
- Tailwind v4 custom variant and View Transition reset in `globals.css`:
  ```css
  @custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *, .dark, .dark *));

  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation: none;
    mix-blend-mode: normal;
  }

  html[data-magicui-theme-vt="active"]::view-transition-group(root) {
    animation-duration: var(--magicui-theme-toggle-vt-duration);
  }

  html[data-magicui-theme-vt="active"]::view-transition-new(root) {
    clip-path: var(--magicui-theme-vt-clip-from);
  }
  ```
  ```

  ```

### Rules for Themes

1. **Never hardcode light or dark hex colors** (`#ffffff`, `#000000`, `bg-white`, `bg-black`, `bg-zinc-900`) in application components.
2. Always write `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`.
3. Check contrast in both modes before finalizing any UI feature.

---

## 8. Foundry Workspace Principles

1. **Header:** 48px height (`h-12`), compact brand mark, project breadcrumb, centralized view tabs and viewport icons, right-aligned action triggers.
2. **Left Panel (Stream & Composer):**
   - Fixed width on desktop (`w-[420px] lg:w-[460px]`).
   - Chat stream scrolls vertically with user and system message bubbles.
   - Composer stays docked at the bottom with quick suggestions, multiline entry, attachment trigger, and primary submit action.
3. **Right Panel (Canvas Preview):**
   - Clean browser header bar with mock URL and refresh/open actions.
   - Neutral dot/grid canvas backing (`bg-muted/30`).
   - Dynamic width container responsive to Desktop (100%), Tablet (768px), and Mobile (375px).
4. **Distinction Rule:** The generated website inside the preview canvas must be rendered within an isolated card container (`bg-card text-card-foreground border-border`) so users can clearly distinguish the builder chrome from the website they are building.

---

## 9. Accessibility & Responsive Design

- **Keyboard Navigation:** Every interactive button and dropdown supports full keyboard navigation (Tab, Enter, Space, Escape, Arrow keys).
- **Focus Rings:** Visible, consistent focus outlines on all interactive elements via `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`.
- **Screen Reader Support:** All icon-only buttons include `<span className="sr-only">` or `aria-label`.
- **Responsive Layout:**
  - On viewports `< 768px`, the left panel takes full width, and header switches collapse cleanly.
  - On larger displays, split-screen two-column layout is active.
- **Motion:** Micro-transitions are brief (100ms - 200ms) and respect user reduced-motion settings.

---

## 10. Rules for Future AI Coding Agents

When working on the Foundry repository:

1. **Read `design.md` First:** Always reference this document before authoring or modifying any UI component.
2. **Use Installed shadcn/ui Components:** Check `@/components/ui/` first. Do not invent duplicate custom button, dialog, or input components.
3. **Strictly Base UI Syntax:** Remember that triggers use `render={<Button ... />}`, NOT `asChild`.
4. **Never Add Raw Colors:** Use existing semantic design tokens (`bg-card`, `text-muted-foreground`, etc.).
5. **No Package Manager Conflicts:** Use `pnpm` exclusively. Do not run `npm install` or `yarn`.
6. **Preserve React 19 Compliance:**
   - Do not call `setState()` directly inside `useEffect()` without external store synchronization.
   - Use `useSyncExternalStore` for client-only state or media query subscriptions.
   - Keep render functions pure; avoid calling `Date.now()` or `Math.random()` during render.
7. **Verify Quality Gates:** Always verify that `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` pass with zero errors.
