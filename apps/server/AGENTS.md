# Server Guidelines

## Module Structure

Business capabilities live in `src/modules/<name>/` with one `index.ts` plugin entrypoint and one file per controller, service, repository, DTO, and utils role as needed. Follow the root code-development standards. Autoload discovers only immediate module entrypoints; shared named capabilities are published by module entrypoints while routes and request hooks remain encapsulated. The Drizzle connection and schema live under `src/db/`, resource implementations under `src/infrastructure/`, Fastify integration under `src/plugins/`, and pure business-independent utilities under `src/utils/`. Do not create a parallel `src/lib/` directory. Classify by responsibility: business policy belongs to modules even when it performs I/O. File length alone never requires splitting or fails acceptance.

Use native Fastify hooks and plugins for request processing; do not add a generic `middleware/` or hooks directory. Keep module and route hooks scoped to their owner, and enforce business permissions and state rules in services.

## Internationalization

- Public error messages are localized per request through `Accept-Language`: English is the default and `zh-CN` the only overlay (any `zh*` range maps to it; quality ties stay English). Negotiation lives in `src/infrastructure/i18n/negotiate-locale.ts` and is wired into HTTP error handlers and WebSocket connection bootstrap, so domain code never reads the header itself.
- Each domain keeps its transport error catalog in its controller and registers it from its module entrypoint via `registerErrorMessages('<name>', catalog)` from `src/infrastructure/i18n/error-catalog.ts`. Registration is idempotent per domain (multi-instance boots) but throws when another domain claims the same generic code. Preserve existing catalog domain identifiers and bilingual messages when moving definitions.
- Catalogs are keyed by stable error code and hold message **variants**: exactly one generic variant per code with both `en` and `zh-CN` text, plus optional site variants whose `match` pins an exact thrown message. Site variants keep their `zh-CN` text identical to `match` so Chinese output never regresses. Rendering selects site variant, then generic, then the original thrown message — so an uncatalogued code behaves exactly as before. Codes may be **shared across domains** (for example `INVALID_INPUT`): the domain that introduced the code declares its single generic, and other domains contribute only site variants for their own thrown messages.
- Throw sites keep their original message as the diagnostic fallback and may carry interpolation variables in `ApplicationError` `params` for catalog templates (`{{name}}` placeholders stay literal when a param is absent).
- Only Server-projected user-facing text belongs in controller catalogs: log messages stay English, protocol constants live in `packages/shared`, and MCP tool contracts stay in `packages/agent`.
- Domain catalog tests must assert the bilingual-generic invariant and that every site-variant `match` still exists in source (drift fails the test); see `test/knowledge-error-messages.test.mjs`.

## Database Schema and Migrations

`src/db/schema.ts` is the single source of truth for every standard SQLite table, column, index, foreign key, default, and check constraint. Use Drizzle APIs whenever they support the required capability; do not add handwritten table or index DDL to application startup code.

- After changing `schema.ts`, run `pnpm --filter @octopus/server db:generate --name=<change-name>`, review the output, and run `pnpm --filter @octopus/server db:check`.
- Commit `schema.ts` with all generated `drizzle/` artifacts, including migration SQL, `meta/_journal.json`, and `meta/*_snapshot.json`.
- Do not hand-edit ordinary generated migration SQL or `drizzle/meta/`. For unsupported database-native capabilities, use `drizzle-kit generate --custom --name=<change-name>` and document why custom SQL is necessary.
- Custom SQL is limited to capabilities Drizzle cannot express, currently SQLite FTS5 virtual tables and synchronization triggers. Do not use it for ordinary tables, indexes, or constraints.
- Never rewrite a migration after it has been committed for team use or applied in a shared environment; generate a subsequent migration instead.
- Startup applies committed migrations through Drizzle's official migrator. Do not add bespoke schema-version checks, `CREATE TABLE` startup blocks, or historical repair routines to `src/db/client.ts`.
