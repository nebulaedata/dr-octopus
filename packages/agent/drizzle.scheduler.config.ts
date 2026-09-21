/**
 * @author Codex
 * @description Generate independent Scheduler migrations; never reference the Server schema or database.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/extensions/scheduler/infrastructure/schema.ts',
  out: './drizzle/scheduler',
});
