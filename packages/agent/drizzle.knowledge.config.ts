/**
 * @author Codex
 * @description Generate knowledge migrations independently of Server and Scheduler data.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/extensions/knowledge/db/schema.ts',
  out: './drizzle/knowledge',
});
