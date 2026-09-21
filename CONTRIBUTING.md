# Contributing

Contributions to Dr.Octopus are welcome through issue reports, documentation, tests, and code improvements. For vulnerabilities, follow the [Security Policy](./SECURITY.md). Do not post exploit details or secrets in public issues.

## Before You Start

Read the root [AGENTS.md](./AGENTS.md), then any nested guidelines that apply to the directories you will change. They define the repository's coding conventions, module boundaries, and verification requirements.

Small fixes can be submitted directly as pull requests. For new features, public protocol changes, or architectural changes, first consider opening an issue describing the problem, use case, and proposed approach. See [docs](./docs/README.md) and [ADRs](./docs/adr/README.md) for architectural context.

Before changing `packages/agent`, obtain explicit maintainer confirmation for the specific Agent change. When using an automated coding assistant, also follow the user-confirmation requirement in the root guidelines. The Agent core contains only general, host-independent capabilities; host-specific business logic should remain in the corresponding application.

## Development Environment

Use Node.js 22.19.0 or later and the pnpm version specified by `packageManager` in `package.json`. The current pinned version is pnpm 11.18.0; if it changes, the repository configuration takes precedence.

Fork and clone the repository, work on a new branch, then run:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

The initial full build generates artifacts needed by dependencies across packages. Some dependencies contain native modules. If prebuilt binaries are unavailable for your platform, install the corresponding build toolchain.

`pnpm dev` starts the Web/Server development workflow. For TUI development, use `pnpm dev:agent`. The CLI development entry point is `pnpm dev:cli --help`. Use the actual addresses and ports printed in the terminal. See [apps/cli/README.md](./apps/cli/README.md) for CLI details.

To override development configuration, copy `.env.example` to a local `.env`, fill in only the necessary settings, and keep the loopback listening address. Use your own test accounts for model credentials; do not put them in source code or fixtures. The application may read and write `~/.dr-octopus/` under your home directory. When manually testing new features, consider setting `SERVER_DATA_DIR` and `DR_OCTOPUS_CODING_AGENT_DIR` to separate absolute paths to avoid affecting your everyday data.

## Project Layout

| Directory            | Responsibility                                              |
| -------------------- | ----------------------------------------------------------- |
| `apps/cli`           | CLI entry points, Gateway management, and release packaging |
| `apps/server`        | Fastify host, business modules, and database                |
| `apps/web`           | React/Vite client                                           |
| `packages/agent`     | Shared Agent core; changes require prior confirmation       |
| `packages/shared`    | Common types and utilities                                  |
| `packages/ui`        | shadcn/ui primitives                                        |
| `packages/custom-ui` | Hand-written, business-independent shared components        |
| `docs`               | Architecture documentation and decision records             |

## Change Guidelines

- Use TypeScript/TSX, two-space indentation, and Prettier. Preserve existing line endings. Source file headers identify the actual author and responsibility; functions, methods, and other declarations follow the multiline JSDoc requirements in `AGENTS.md`.
- Keep modules cohesive. Separate entry points, business logic, and infrastructure. Update documentation when public interfaces or behavior change.
- Do not edit `packages/ui/src/components/` directly. Customize through props, `className`, or application wrappers. Add shadcn components with `pnpm dlx shadcn@latest add <component-name> -c packages/ui`.
- Before changing the Web interface, read `apps/web/DESIGN.md` and the application guidelines. Follow the existing internationalization, state management, and component boundaries.
- Follow the owning package's guidelines for database changes. Generate migrations with Drizzle and commit them alongside the schema. Do not rewrite migrations already shared or applied.
- Explain the purpose of new dependencies and commit the corresponding lockfile changes. Verify licensing when introducing third-party source code, binaries, or bundled dependencies, and update [Third-party notices](./THIRD_PARTY_NOTICES.md) as needed.

Format only the files you changed to avoid unrelated repository-wide formatting changes:

```sh
pnpm exec prettier --write path/to/changed-file.ts
```

## Verification

Tests use `node:test` and are named `*.test.mjs`. Add meaningful regression tests in the owning package for behavior fixes. Keep fixtures deterministic and independent of live model services or personal configuration by default.

Run focused checks first, then the affected packages' tests, lint, and type checks. For example, for Server changes:

```sh
pnpm --filter @octopus/server build
pnpm --filter @octopus/server test
pnpm --filter @octopus/server lint
pnpm --filter @octopus/server typecheck
```

Changes across packages should cover all affected consumers. For full verification, run `pnpm build`, `pnpm test`, `pnpm lint`, and `pnpm typecheck`. Some tests read build artifacts, so rebuild after changing source files. Documentation-only changes require checking formatting, links, and examples; application tests are unnecessary.

Tests involving live services or paid models must be explicitly enabled, use isolated environments, and document the required configuration. Do not commit real credentials, sessions, databases, attachments, or screenshots containing sensitive information as test data.

## Submitting a Pull Request

- Keep each PR focused on one problem. Avoid unrelated refactoring, formatting, or generated artifacts.
- Use Conventional Commit prefixes such as `feat:`, `fix:`, `refactor:`, `docs:`, and `test:`, with one logical change per commit.
- Describe the problem, resulting behavior, and architectural impact. Link relevant issues or ADRs.
- List the verification commands actually run and their results. Clearly state untested platforms and failed or skipped checks.
- Include redacted screenshots for visible UI changes. Explain any user actions required by configuration, migration, or compatibility changes.

Before submitting, inspect the diff and untracked files for `.env` files, tokens, user data, personal absolute paths, or unrelated files. `release/` is generated output. Edit release configuration, scripts, and source files such as `README*.md` instead of maintaining generated files directly.

`pnpm release` creates a version commit and tag and pushes them. `pnpm release:publish` publishes the npm package and then creates the matching GitHub Release through release-it. Ordinary contributions do not require these commands. To verify packaging only, run `pnpm release:build`; it does not publish the npm package.

Before contributing, confirm that you have the right to provide your contribution under the project's [MIT License](./LICENSE). Third-party content retains its original license and attribution; adding the project license does not relicense it.
