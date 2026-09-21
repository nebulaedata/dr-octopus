/**
 * @author root
 * @description Configures Drizzle Kit to generate versioned SQLite migrations from the control-plane schema.
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
