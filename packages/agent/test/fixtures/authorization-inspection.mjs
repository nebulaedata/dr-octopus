/**
 * @author Codex
 * @description Runs the real SDK inspection lifecycle with a deterministic lazy provider and no model requests.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runTaskToolInspection } from '../../dist/extensions/scheduler/sdk/tool-inspection.js';
import { createPermissionSystemExtension } from '../../dist/extensions/permission-system/index.js';

await runTaskToolInspection(process.cwd(), [
  {
    name: 'lazy-fixture',
    factory(pi) {
      pi.on('before_agent_start', async () => {
        appendFileSync(process.env.TEST_INSPECTION_MARKER, 'initialized\n');
        if (process.env.TEST_INSPECTION_MODE === 'hang')
          await new Promise(() => {
            setInterval(() => {}, 1000);
          });
        if (process.env.TEST_INSPECTION_MODE === 'fail') throw new Error('Fixture initialization failure');
        await Promise.resolve();
        for (const name of ['ctx_fixture', 'ctx_upgrade'])
          pi.registerTool({
            name,
            label: name,
            description:
              process.env.TEST_INSPECTION_MODE === 'directory'
                ? readFileSync(join(process.env.PI_CODING_AGENT_DIR, 'tool-description.txt'), 'utf8')
                : 'Lazy fixture tool',
            parameters: { type: 'object', properties: {} },
            async execute() {
              throw new Error('Inspection must never execute a tool');
            },
          });
      });
    },
  },
  { name: 'permissions', factory: createPermissionSystemExtension() },
]);
