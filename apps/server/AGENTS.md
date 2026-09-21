# Server Guidelines

## Module Structure

Business capabilities live in `src/modules/<name>/` with explicit `*.controller.ts`, `*.service.ts`, and `*.repository.ts` roles. Domains that project user-facing text own it in a `<name>.i18n.ts` role file (see Internationalization). The Drizzle connection and schema live under `src/db/`; cohesive business-independent utilities belong under `src/lib/`.

## Internationalization

- Public error messages are localized per request through `Accept-Language`: English is the default and `zh-CN` the only overlay (any `zh*` range maps to it; quality ties stay English). Negotiation lives in `src/lib/i18n/negotiate-locale.ts` and is already wired into the HTTP error handlers and the WebSocket connection bootstrap, so domain code never reads the header itself.
- Each domain registers its catalog from `<name>.i18n.ts` at the composition root (`src/modules/index.ts`) via `registerErrorMessages('<name>', catalog)` from `src/lib/i18n/error-catalog.ts`. Registration is idempotent per domain (multi-instance boots) but throws when another domain claims the same code.
- Catalogs are keyed by stable error code and hold message **variants**: exactly one generic variant per code with both `en` and `zh-CN` text, plus optional site variants whose `match` pins an exact thrown message. Site variants keep their `zh-CN` text identical to `match` so Chinese output never regresses. Rendering selects site variant, then generic, then the original thrown message — so an uncatalogued code behaves exactly as before. Codes may be **shared across domains** (for example `INVALID_INPUT`): the domain that introduced the code declares its single generic, and other domains contribute only site variants for their own thrown messages.
- Throw sites keep their original message as the diagnostic fallback and may carry interpolation variables in `ApplicationError` `params` for catalog templates (`{{name}}` placeholders stay literal when a param is absent).
- Only Server-projected user-facing text belongs in `<name>.i18n.ts`: log messages stay English, protocol constants live in `packages/shared`, and MCP tool contracts stay in `packages/agent`.
- Domain catalog tests must assert the bilingual-generic invariant and that every site-variant `match` still exists in source (drift fails the test); see `test/knowledge-error-messages.test.mjs`.

## Database Schema and Migrations

`src/db/schema.ts` is the single source of truth for every standard SQLite table, column, index, foreign key, default, and check constraint. Use Drizzle APIs whenever they support the required capability; do not add handwritten table or index DDL to application startup code.

- After changing `schema.ts`, run `pnpm --filter @octopus/server db:generate --name=<change-name>`, review the output, and run `pnpm --filter @octopus/server db:check`.
- Commit `schema.ts` with all generated `drizzle/` artifacts, including migration SQL, `meta/_journal.json`, and `meta/*_snapshot.json`.
- Do not hand-edit ordinary generated migration SQL or `drizzle/meta/`. For unsupported database-native capabilities, use `drizzle-kit generate --custom --name=<change-name>` and document why custom SQL is necessary.
- Custom SQL is limited to capabilities Drizzle cannot express, currently SQLite FTS5 virtual tables and synchronization triggers. Do not use it for ordinary tables, indexes, or constraints.
- Never rewrite a migration after it has been committed for team use or applied in a shared environment; generate a subsequent migration instead.
- Startup applies committed migrations through Drizzle's official migrator. Do not add bespoke schema-version checks, `CREATE TABLE` startup blocks, or historical repair routines to `src/db/client.ts`.
