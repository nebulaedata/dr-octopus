/**
 * @author Codex
 * @description Generates permission-owned grant migrations independently of Scheduler storage.
 */
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/extensions/permission-system/lib/grant-schema.ts',
  out: './drizzle/permission',
});
