# Repository Guidelines

## Project Map

Octopus is a pnpm/Turborepo monorepo:

- `apps/server`: Fastify host and Drizzle-backed business modules.
- `apps/web`: React/Vite client.
- `apps/executor`: Windows local tool executor with Electron/Utility Runtime; Basic and Browser implemented, Computer enabled with independent desktop and release acceptance pending.
- `apps/browser-extension`: independent WXT/MV3 Native Messaging bridge; connection lifecycle and finite Browser tools implemented; release acceptance pending.
- `apps/desktop`: reserved for future desktop packaging of the Web agent client; not implemented.
- `packages/agent`: shared Pi CLI and RPC Agent core.
- `packages/shared`: common types and utilities.
- `packages/ui`: shared shadcn/ui primitives.
- `docs`: architecture notes and ADRs. Package tests and fixtures live under `test/`.

Use the table below as an on-demand index, not a reading checklist. Read only the nested `AGENTS.md` files whose directory scope covers the files involved in the current task; do not read unrelated projects' instructions. If the task expands into another directory, load its applicable instructions then. This root file always applies; for a target file, also follow applicable ancestor and deeper nested instructions along its directory path.

| Project / scope             | Nested instructions                                                   |
| --------------------------- | --------------------------------------------------------------------- |
| `apps/desktop/`             | Reserved scope; no nested AGENTS.md currently. Follow this root file. |
| `apps/executor/`            | [apps/executor/AGENTS.md](apps/executor/AGENTS.md)                    |
| `apps/browser-extension/`   | [apps/browser-extension/AGENTS.md](apps/browser-extension/AGENTS.md)  |
| `apps/server/`              | [apps/server/AGENTS.md](apps/server/AGENTS.md)                        |
| `apps/web/`                 | [apps/web/AGENTS.md](apps/web/AGENTS.md)                              |
| `packages/agent/`           | [packages/agent/AGENTS.md](packages/agent/AGENTS.md)                  |
| `packages/ui/`              | [packages/ui/AGENTS.md](packages/ui/AGENTS.md)                        |
| `packages/custom-ui/`       | No nested `AGENTS.md` currently; follow this root file.               |
| `packages/shared/`, `docs/` | No nested `AGENTS.md` currently; follow this root file.               |

Keep this index updated when project-level `AGENTS.md` files are added, moved, or removed.

## Code Development Standards

Read and follow [Code Development Standards](docs/guides/code-development-standards.md) for all code changes. It defines repository layout, layering, coding, lifecycle, and verification rules. Its layout and abstraction rules take precedence over conflicting older guidance; all other applicable instructions and protected boundaries remain in force.

## Protected Core Boundaries

- `packages/agent` is the shared, general-purpose Agent core. Before creating, editing, moving, or deleting anything under it, obtain explicit user confirmation for the proposed Agent change. Read-only inspection is allowed; requests concerning other areas do not imply authorization.
- Keep `packages/agent` lightweight: add only Host-agnostic Agent capabilities with a clear core responsibility or demonstrated cross-Host reuse.
- If a capability could reasonably either be moved into `packages/agent` or remain in its corresponding Host, prefer keeping it in the Host.
- Do not edit `packages/ui/src/components/` directly because changes affect every consumer. Customize through props, `className`, or feature/app wrappers. These are shadcn/ui source components and should normally be installed with `pnpm dlx shadcn@latest add <component-name>`; in this monorepo, pass `-c packages/ui`.
- `packages/custom-ui` hosts hand-written business-agnostic shared components (e.g. `components/elapsed-time`) that are not shadcn/ui primitives; add new custom shared components there instead of `packages/ui`.

## Tooling and Verification

Use Node 22.19+ and pnpm 11+. Common commands are `pnpm dev`, `pnpm dev:cli`, `pnpm dev:agent`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm format`; prefer focused filters while iterating, such as `pnpm --filter @octopus/server test`.

Tests use `node:test`, are named `*.test.mjs`, and keep fixtures deterministic. Add regressions near the affected package. Before handoff, run focused checks followed by the relevant scope of `pnpm test`, `pnpm lint`, and `pnpm typecheck`.

## Documentation Boundaries

- Before creating, moving, or reorganizing documentation under `docs/`, read and follow the [Documentation Filing Rules](docs/README.md#归档规则) and directory table. That document owns directory placement and the requirement to obtain user approval before adding any directory, including subdirectories.
- Product READMEs explain installation and usage, with links to development guides. Put source setup, build commands and packaging instructions in `README.dev.md` / `README.dev.zh-CN.md` or the relevant scoped guide.
- This root file owns repository-wide rules and the project instruction index. Application-specific build, verification and delivery rules belong in that application's `AGENTS.md`; keep procedural tutorials in the linked guides.
- Keep user installation instructions and release SOPs in the owning application's `INSTALLATION.md` and `RELEASE.md`. Maintain architecture and ADRs under `docs/`; indexes link to these documents rather than repeat their content.
- Maintain one authoritative detailed procedure per responsibility. Keep current validation status separate from enduring rules, preserve original evidence, and distinguish executable commands from pending integration. Packaged/offline instructions must not require unavailable repository-relative links.
- Store architecture-related feasibility studies, design reviews, test plans, acceptance matrices and validation records in `docs/poc/` (Proof of Concept). Keep design contracts in `docs/architecture/` and decisions in `docs/adr/`; link to PoC records instead of duplicating verification sections. Preserve original dates, failures, evidence locations and the distinction between planned and completed validation. Maintain the `docs/poc/README.md` index.

## Visual Design Artifacts

- Store product visual drafts under `docs/design/<feature>/`, using a descriptive kebab-case feature name; browser extension recorder designs belong in `docs/design/browser-extension-recorder/`.
- Copy selected designs and subsequent review drafts into the repository before handoff; do not leave the only copy in chat, an OS temporary directory, or the image generator's default output directory. Preserve originals and create versioned filenames such as `recording-popup-v1.png`; do not overwrite approved drafts.
- Maintain a `README.md` in each feature's design directory with preview links, source/provenance, generation method and prompt records, revision relationships, review status, and links to the owning architecture document. Distinguish `selected direction`, `pending review`, `approved`, and `superseded`; continued iteration does not imply approval of every detail. Exception: for `docs/design/browser-extension-recorder/`, the design specifications and authoritative status registry live in `apps/browser-extension/DESIGN.md` and the design-directory `README.md` is links only; images and prompt records remain in the design directory.
- Keep the user-selected visual target identifiable. Archive unselected alternatives separately only when useful, and do not label them as approved. Reference screenshots and generated mockups must be distinguished from screenshots of implemented UI and test evidence.
- Visual approval authorizes design refinement only; it does not authorize implementation, architecture changes, or publication unless the user explicitly requests them. Design indexes record unresolved interaction decisions without silently rewriting the architecture baseline.
- Use synthetic or redacted data in committed visual artifacts; never include real credentials, private customer data, or unredacted sensitive screenshots. Product runtime assets remain in their owning application's asset directory rather than being loaded from `docs/design/`.

### Visual Acceptance and Copy Flexibility

- Visual acceptance evaluates the overall palette, layout, hierarchy, component styling and interaction structure; mockup text is illustrative, not a verbatim implementation requirement. Unless the user explicitly fixes particular wording, agents may shorten, clarify or adapt labels, descriptions and sample content to the actual feature without regenerating a visual draft or requesting renewed visual approval.
- Copy-only differences do not invalidate an approved visual target or require a status change. Verify the resulting text still fits the approved layout and remains readable; substantial layout or interaction changes continue to follow visual review rules.
- Copy must accurately describe approved behavior, especially permissions, privacy, data handling, destructive actions and completion states. Wording flexibility does not authorize changing those behaviors or commitments.

### Visual Review Status and Retirement

- The feature design `README.md` is the authoritative status registry; for browser extension recorder designs the registry lives in `apps/browser-extension/DESIGN.md` instead (the design-directory `README.md` only links to it). Use exactly these statuses: `pending review`（待审阅）, `selected direction`（已选方向）, `approved`（已批准）, `revision required`（需修订）, `superseded`（已替代）, and `deprecated`（已弃用）. Prompt logs and historical approval notes are provenance, not the current authority.
- For each artifact, record its filename/version, status, applicable scope, status-change date, reason, and replacement link (or explicitly `none yet`). Keep current targets separate from historical or blocked drafts. Never choose an implementation target by highest version number or filename alone.
- When user feedback invalidates any part of an approved draft, mark it `revision required` in the same work session and name the invalidated region or behavior. Unaffected parts may remain reference material only when explicitly listed; the invalidated portion must not guide new implementation. Do not describe the entire file as an unqualified approved target.
- A new draft remains `pending review` until explicitly approved. Once approved for the same scope, mark the older target `superseded` and link both directions. Use `deprecated` when the design is explicitly abandoned without a replacement; use `superseded` when a replacement exists. An abandoned or replaced draft must not return to approved status implicitly.
- Preserve original images and prompts without destructive overwrites. Mark retirement in the registry and review history, not by painting over the original image. If files are moved into an archive directory, update all links in the same change; moving is optional, accurate status is mandatory.
- Before UI implementation, agents must read the registry and confirm that the target is approved for the affected scope. A selected direction permits exploration, not automatic approval of detailed screens. When the user requires new visuals before substantial frontend changes, generate and archive the revised draft first, obtain its approval, then implement that change. Existing authorization for independent backend work remains in force.
- At handoff, report newly approved, revision-required, superseded or deprecated artifacts and verify their links. Visual approval, implementation authorization and runtime verification remain three distinct facts.

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
