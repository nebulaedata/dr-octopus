/**
 * @author Codex
 * @description Installs the process-local control-plane database once and owns its Fastify shutdown lifecycle.
 */

import fp from 'fastify-plugin';
import { createDatabase } from '../db/client.js';
import type { FastifyPluginCallback } from 'fastify';
import type { OctopusDatabase } from '../db/client.js';

export interface DatabasePluginOptions {
  path: string;
  database?: OctopusDatabase;
}

declare module 'fastify' {
  interface FastifyInstance {
    database: OctopusDatabase;
  }
}

/**
 * Creates or accepts the sole control-plane database owned by one Fastify instance.
 */
const registerDatabase: FastifyPluginCallback<DatabasePluginOptions> = (app, options, done) => {
  if (app.hasDecorator('database')) {
    done(new Error('Database plugin must be registered exactly once per Fastify instance.'));
    return;
  }

  app.log.info({ event: 'server.database.initializing', phase: 'database' }, 'Initializing database');
  let database: OctopusDatabase;
  try {
    database = options.database ?? createDatabase(options.path);
  } catch (error) {
    app.log.error(
      { err: error, event: 'server.database.failed', phase: 'database' },
      'Database initialization failed'
    );
    done(error instanceof Error ? error : new Error('Database initialization failed.'));
    return;
  }

  app.log.info(
    { event: 'server.database.ready', phase: 'database' },
    'Control-plane database ready after migrations'
  );
  app.decorate('database', database);
  app.addHook('onClose', () => {
    if (database.sqlite.open) {
      database.sqlite.close();
      app.log.info({ event: 'server.database.closed', phase: 'database' }, 'Control-plane database closed');
    }
  });
  done();
};

/**
 * Exposes the Database decorator to sibling plugins and declares its Fastify compatibility contract.
 */
export const databasePlugin = fp(registerDatabase, {
  name: 'database',
  fastify: '5.x',
});
