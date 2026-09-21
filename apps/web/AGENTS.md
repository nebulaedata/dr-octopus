# Web Application Guidelines

## Frontend Design

Before creating or changing UI, read and follow [Frontend Design Guidelines](./DESIGN.md). It defines the shared visual language, page patterns, responsive behavior, interaction states, and design verification requirements. Keep that guide aligned when shared design conventions change; record task-specific QA evidence in the PR rather than a root-level report.

## Stack Conventions

- Prefer shadcn/ui components; create custom UI only when no suitable primitive exists. Install official components into `packages/ui` with commands such as `pnpm dlx shadcn@latest add badge -c packages/ui`; never copy them manually.
- Use TanStack Form for forms, TanStack Query for server state, TanStack Router for routing, and ahooks for common hooks before creating custom alternatives.
- React Compiler owns performance memoization. Do not add `useMemo`, `useCallback`, or `React.memo` solely for performance.
- Import only `*Icon`-suffixed exports from `lucide-react`, such as `ArrowUpIcon`, so icons remain distinct at call sites.

## Internationalization

- Default English copy lives at the call site as `t('key', 'Default English')` via `useI18n()`; maintain only the `zh-CN.json` overlay by hand and regenerate `en.json` exclusively with `pnpm i18n:extract`.
- Do not translate `aria-label` attributes (including SVG `<title>` accessible names): screen-reader-only names are plain English literals and must not occupy catalog keys. Visible text (JSX children, `title` tooltips, `placeholder`, button labels) is still translated.

## Tool Renderers

Before changing `src/features/session/tool-renderers/` or the `ToolProjection` pipeline, read and follow its `README.md`. Update that guide when renderer contracts, registration, projection shape, fallback behavior, or validation requirements change. Keep `.agents/skills/develop-tool-renderers/SKILL.md` aligned only when its trigger scope, routing, or non-obvious invariants change.

## Component and Feature Boundaries

- `src/components/` contains domain-agnostic UI driven exclusively by props. It may own transient presentation state but must not depend on business concepts, queries, stores, route parameters, workspace/session types, or anything importing from `src/features/`.
- `src/features/<feature>/` owns product capabilities and business data. It may use queries, Zustand stores, route state, navigation, generic components, and `packages/ui`.
- Feature layout chrome belongs under `src/features/<feature>/layout/`. When a generic component starts requiring business data, move it into the relevant feature instead of expanding prop drilling.

## State Store Boundaries

- Define every Zustand store under `src/stores/<domain>/` (or a single cohesive `src/stores/<domain>.ts` module). Feature and view modules may consume stores through selectors, but must not define `create`, `createStore`, `combine`, `persist`, store factories, persistence keys, or storage adapters.
- Multi-file store domains expose a stable public entrypoint from `src/stores/<domain>/index.ts`. Import that entrypoint from features instead of reaching into store implementation files.
- Keep component-local, short-lived presentation state in the owning component. Move state into `src/stores` when it is shared across component boundaries, survives remounts or reloads, or represents client-side domain/runtime state. Keep server state in TanStack Query.
- Encapsulate Zustand persistence and browser-storage schema inside the owning store module. Views may invoke semantic store actions but must not read or write that store's localStorage or sessionStorage records directly.

- Ordinary page heroes must use `PageHero` from `@/components/PageHero` instead of duplicating heading/description/action markup. Pass the page title through `title`, optional supporting text through `description`, and search controls or page actions through `extra`. Keep business state and event handlers in the owning feature; the hero owns shared typography, spacing, and responsive action layout. This applies to new and updated ordinary pages, including `/skills` and `/schedules`; application-shell headers and specialized session layouts remain separate.

- Ordinary pages must use `Page` from `@/components/Page` for their outer container and content layout. It provides the shared full-height scroll container, centered `max-w-5xl` content, spacing, and padding. Use optional `classNames.container` and `classNames.content` overrides for page-specific scrolling or layout needs instead of duplicating the wrappers; classes are merged with `cn` so overrides take precedence. Compose `PageHero` inside `Page`. Keep specialized application-shell and session layouts in their owning features.
