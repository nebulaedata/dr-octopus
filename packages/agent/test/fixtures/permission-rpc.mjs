/**
 * @author Codex
 * @description Runs the real public Pi RPC protocol with isolated permission and deterministic test tools.
 */
import { appendFileSync } from 'node:fs';
import { main } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  createPermissionModeService,
  createPermissionSystemExtension,
} from '../../dist/extensions/permission-system/index.js';

const args = process.argv.slice(2);
const workspace = args.indexOf('--workspace');
if (workspace >= 0) args.splice(workspace, 2);
await main(args, {
  extensionFactories: [
    { name: 'permissions', factory: createPermissionSystemExtension(createPermissionModeService()) },
    {
      name: 'test-tools',
      factory(pi) {
        for (const name of [
          'test_ping',
          'ctx_execute',
          'ctx_execute_file',
          'ctx_batch_execute',
          'ctx_upgrade',
          'scheduler_create',
        ]) {
          pi.registerTool({
            name,
            label: 'Ping',
            description: 'Deterministic test effect.',
            parameters: Type.Object({}),
            async execute() {
              appendFileSync(process.env.TEST_EFFECT_FILE, 'ping\n');
              return { content: [{ type: 'text', text: 'pong' }] };
            },
          });
        }
        pi.on('session_start', () => {
          pi.appendEntry('fixture-active-tools', { names: pi.getActiveTools() });
        });
      },
    },
  ],
});
