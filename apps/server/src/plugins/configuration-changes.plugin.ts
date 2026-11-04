/**
 * @author Codex
 * @description Owns one configuration change resource for each Fastify Server lifecycle.
 */
import fp from 'fastify-plugin';
import { ConfigurationChanges } from '../infrastructure/runtime-config/index.js';
import type { FastifyPluginCallback } from 'fastify';
const owned = new WeakSet<ConfigurationChanges>();
declare module 'fastify' {
  interface FastifyInstance {
    configurationChanges: ConfigurationChanges;
  }
}
/**
 * Publishes the shared resource before consumers and closes it after consumers.
 */
const register: FastifyPluginCallback<{ instance?: ConfigurationChanges }> = (app, options, done) => {
  if (app.hasDecorator('configurationChanges')) {
    done(new Error('Configuration changes must be registered exactly once.'));
    return;
  }
  const changes =
    options.instance ??
    new ConfigurationChanges((code) => app.log.warn({ code }, 'Configuration notification diagnostic'));
  if (owned.has(changes)) {
    done(new Error('Configuration changes already belong to a Server.'));
    return;
  }
  owned.add(changes);
  app.decorate('configurationChanges', changes);
  app.addHook('onClose', (_instance, complete) => {
    changes.close();
    complete();
  });
  done();
};
export const configurationChangesPlugin = fp(register, { name: 'configuration-changes', fastify: '5.x' });
