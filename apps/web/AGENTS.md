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

Before changing `src/features/session/ToolRenderers/` or the `ToolProjection` pipeline, read and follow [Tool Renderer Development](../../docs/architecture/web-tool-renderers.md). Registrations and selection are private to `ToolRenderer.tsx`; pure projections live in `features/session/utils/`. Update that guide when renderer contracts, registration, projection shape, fallback behavior, or validation requirements change. Keep `.agents/skills/develop-tool-renderers/SKILL.md` aligned only when its trigger scope, routing, or non-obvious invariants change.

## Component and Feature Boundaries

- `src/components/` contains domain-agnostic UI driven exclusively by props. It may own transient presentation state but must not depend on business concepts, queries, stores, route parameters, workspace/session types, or anything importing from `src/features/`.
- `src/features/<feature>/` owns product capabilities and business data. It may use queries, Zustand stores, route state, navigation, generic components, and `packages/ui`.
- Feature roots and page-domain directories use kebab-case (`settings/default-model`); component grouping directories use PascalCase (`session/MemoryAssistant`, `settings/Layout`). Reserved responsibility directories such as `hooks/` and `utils/` stay lowercase. Classify by ownership, not merely by whether a component is rendered by a route. See the naming table in the [Code Development Standards](../../docs/code-development-standards.md#41-组件入口与目录约束).
- Feature layout chrome belongs under `src/features/<feature>/Layout/`. When a generic component starts requiring business data, move it into the relevant feature instead of expanding prop drilling.

## Shared Infrastructure and Utilities

- Keep `src/lib/` for long-lived connections, listener registries and application runtime ownership. Use `lib/runtime/` for WebSocket transport, command acknowledgement and Session retention; use `lib/shortcuts/` for shortcut infrastructure. Do not introduce a parallel app-wide core directory.
- Put callable helpers with bounded side effects, such as clipboard copying and feedback, in `src/utils/`. Keep framework-neutral helpers cohesive with their owning infrastructure when appropriate; do not move every pure function out of lib.
- React lifecycle adapters belong in `src/hooks/`. Shortcut Hooks live in `hooks/use-shortcut.ts`; `lib/shortcuts/shortcut-runtime.ts` owns the existing singleton wiring and `lib/shortcuts/index.ts` explicitly re-exports public infrastructure. The entry still initializes the existing runtime through its export; it is not side-effect-free on import.
- lib and global utils must not import React Hooks, the hooks layer or features. Store binding catalog imports target the pure shortcut catalog directly, avoiding the runtime/store cycle. Preserve initialization order, instance scope, listener cleanup, storage behavior and supported browser fallbacks when moving code.

## Query Layer Boundaries

- The `src/queries/` root contains only `*-queries.ts`, `core/` and `utils/`. Query modules own query options, query/mutation Hooks and cache synchronization lifecycle wiring; UI-specific Hooks stay in their feature.
- `core/query-client.ts` owns the shared client and its defaults; `core/query-keys.ts` owns shared key factories. Core modules do not depend on query modules or query utilities; import each core file directly without an extra barrel. Preserve existing key values, scopes, mutation keys and client lifetime during structural changes.
- Query helpers live in `utils/` and may own scoped cache updates, queues and message handling. Keep React lifecycle Hooks in query modules; their cleanup must close helper-owned work. Pass client/runtime dependencies explicitly and retain their existing instance scopes.
- Application consumers import the relevant public query module or client/key module. Query utilities are internal; focused tests may import them directly. Do not add aggregate or internal barrels, compatibility forwarding modules, or dependency cycles. Current helpers stay flat; add a business grouping only for a concrete cohesive responsibility.

## State Store Boundaries

- Organize state domains under `src/stores/<domain>/` using kebab-case names. `index.ts` explicitly exports the public contract; `store.ts` owns Zustand initialization, state and actions. Feature and view modules may consume selectors but must not define stores, persistence keys or storage adapters.
- Add `type.ts` only for independently useful state/action contracts; preserve inference and implementation-local types otherwise. Choose `utils.ts` or `utils/` for domain helpers; store utilities may group related implementations under directories such as `utils/attachments/`. Never create empty files to match a template.
- Keep instance management in `registry.ts` when needed and related state transitions in `reducers/`. Store-local utilities may encapsulate persistence or task management, provided their names and contracts state side effects, instance scope and cleanup ownership. Do not merge unrelated ownership into store.ts or introduce Zustand for a storage-only domain.
- Session root entries are `index.ts`, `store.ts`, `type.ts`, `registry.ts`, `reducers/` and `utils/`. Attachment persistence and tasks belong in `utils/attachments/`. These internal groups have no index.ts; the domain entry exposes public operations. Feature hooks/utils remain flat.
- All application consumers, including type imports and other stores, use `src/stores/<domain>/index.ts`. Domain internals import concrete files, never their own entrypoint. Tests may import internals for focused behavior coverage. No aggregate stores/index.ts or compatibility re-exports.
- Keep component-local, short-lived presentation state in the owning component. Move state into `src/stores` when it is shared across component boundaries, survives remounts or reloads, or represents client-side domain/runtime state. Keep server state in TanStack Query.
- Encapsulate Zustand persistence and browser-storage schema inside the owning store module. Views may invoke semantic store actions but must not read or write that store's localStorage or sessionStorage records directly.

- Ordinary page heroes must use `PageHero` from `@/components/PageHero` instead of duplicating heading/description/action markup. Pass the page title through `title`, optional supporting text through `description`, and search controls or page actions through `extra`. Keep business state and event handlers in the owning feature; the hero owns shared typography, spacing, and responsive action layout. This applies to new and updated ordinary pages, including `/skills` and `/schedules`; application-shell headers and specialized session layouts remain separate.

- Ordinary pages must use `Page` from `@/components/Page` for their outer container and content layout. It provides the shared full-height scroll container, centered `max-w-5xl` content, spacing, and padding. Use optional `classNames.container` and `classNames.content` overrides for page-specific scrolling or layout needs instead of duplicating the wrappers; classes are merged with `cn` so overrides take precedence. Compose `PageHero` inside `Page`. Keep specialized application-shell and session layouts in their owning features.
