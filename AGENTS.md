# Repository Guidelines

## Project Map

Octopus is a pnpm/Turborepo monorepo:

- `apps/server`: Fastify host and Drizzle-backed business modules.
- `apps/web`: React/Vite client.
- `packages/agent`: shared Pi CLI and RPC Agent core.
- `packages/shared`: common types and utilities.
- `packages/ui`: shared shadcn/ui primitives.
- `docs`: architecture notes and ADRs. Package tests and fixtures live under `test/`.

Use the table below as an on-demand index, not a reading checklist. Read only the nested `AGENTS.md` files whose directory scope covers the files involved in the current task; do not read unrelated projects' instructions. If the task expands into another directory, load its applicable instructions then. This root file always applies; for a target file, also follow applicable ancestor and deeper nested instructions along its directory path.

| Project / scope                            | Nested instructions                                     |
| ------------------------------------------ | ------------------------------------------------------- |
| `apps/server/`                             | [apps/server/AGENTS.md](apps/server/AGENTS.md)          |
| `apps/web/`                                | [apps/web/AGENTS.md](apps/web/AGENTS.md)                |
| `packages/agent/`                          | [packages/agent/AGENTS.md](packages/agent/AGENTS.md)    |
| `packages/ui/`                             | [packages/ui/AGENTS.md](packages/ui/AGENTS.md)          |
| `packages/custom-ui/`                      | No nested `AGENTS.md` currently; follow this root file. |
| `packages/shared/`, `docs/`                | No nested `AGENTS.md` currently; follow this root file. |

Keep this index updated when project-level `AGENTS.md` files are added, moved, or removed.

## Code Development Standards

Read and follow [Code Development Standards](docs/code-development-standards.md) for all code changes. It defines the Server module file allowlist and boundaries, frontend component entrypoints and hooks/utils placement, redundant backend interface removal, the ban on nested ternaries, and the pre-release no-compatibility policy. Its layout and abstraction rules take precedence over conflicting older guidance; all other applicable instructions and protected boundaries remain in force.

## Protected Core Boundaries

- `packages/agent` is the shared, general-purpose Agent core. Before creating, editing, moving, or deleting anything under it, obtain explicit user confirmation for the proposed Agent change. Read-only inspection is allowed; requests concerning other areas do not imply authorization.
- Keep `packages/agent` lightweight: add only Host-agnostic Agent capabilities with a clear core responsibility or demonstrated cross-Host reuse.
- If a capability could reasonably either be moved into `packages/agent` or remain in its corresponding Host, prefer keeping it in the Host.
- Do not edit `packages/ui/src/components/` directly because changes affect every consumer. Customize through props, `className`, or feature/app wrappers. These are shadcn/ui source components and should normally be installed with `pnpm dlx shadcn@latest add <component-name>`; in this monorepo, pass `-c packages/ui`.
- `packages/custom-ui` hosts hand-written business-agnostic shared components (e.g. `components/elapsed-time`) that are not shadcn/ui primitives; add new custom shared components there instead of `packages/ui`.

## Tooling and Verification

Use Node 22.19+ and pnpm 11+. Common commands are `pnpm dev`, `pnpm dev:web`, `pnpm dev:agent`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm format`; prefer focused filters while iterating, such as `pnpm --filter @octopus/server test`.

Tests use `node:test`, are named `*.test.mjs`, and keep fixtures deterministic. Add regressions near the affected package. Before handoff, run focused checks followed by the relevant scope of `pnpm test`, `pnpm lint`, and `pnpm typecheck`.

## Code Conventions

- Write TypeScript/TSX with two-space indentation and let Prettier control formatting. Use PascalCase for React components and their files, camelCase for functions and variables, and kebab-case for other TypeScript modules.
- Preserve existing line endings. Avoid EOL-only whole-file rewrites, follow `.editorconfig` and `.gitattributes` for new files, and inspect the final diff for accidental conversions.
- Begin every source file with a multiline JSDoc header containing the actual developer in `@author` and a responsibility-focused `@description`; route headers also list every endpoint on its own line.
- Give functions, methods, constructors, and interface methods multiline JSDoc. Keep `/**`, each description/tag, and `*/` on separate lines; use separate `@param`, `@returns`, and `@throws` tags when the contract is not obvious. Explain intent and contracts rather than restating implementation.

## Module Design

- Keep modules cohesive and dependency flow unidirectional. Separate entrypoints/controllers, service/domain logic, and repositories/infrastructure.
- Treat 300 lines only as a prompt to review cohesion, readability, and dependencies, never as a file-size limit or a reason to split. Cohesive files may remain intact without exception approval. Split only when it clarifies an independent responsibility or reduces coupling; file length alone must not fail lint, CI, review, or acceptance.
- Hide internal state and expose complete contracts covering inputs, outputs, invariants, ordering, and defaults. Translate infrastructure failures into domain errors at the owning boundary.
- Minimize sibling coupling; use a clear orchestration/glue layer or events when they materially reduce coupling.
- When moving files, remove only directories made empty by the current change and preserve unrelated empty directories.

## Git and Delivery

Use Conventional Commit prefixes (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`) with one logical change per commit. Pull requests describe intent and architecture impact, link relevant issues or ADRs, list verification, and include screenshots for visible UI changes. Never commit secrets; derive local configuration from `.env.example`.
