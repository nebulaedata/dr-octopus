/**
 * @author Codex
 * @description Generate independent memory migrations from the Agent-owned Drizzle Schema.
 */
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/extensions/memory/lib/schema.ts',
  out: './drizzle/memory',
});
