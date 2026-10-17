/**
 * @author Codex
 * @description Emits versioned validation schema projections for release comparison; Zod refinements and authorization remain enforced by the Runtime, not this JSON artifact.
 */
import { applicationApi } from './application-api.mjs';
const {
  readInputSchema,
  writeInputSchema,
  editInputSchema,
  shellInputSchema,
  lsInputSchema,
  findInputSchema,
  grepInputSchema,
  browserSchemas,
  computerSchemas,
  taskStartSchema,
  taskStatusSchema,
  taskIdSchema,
} = applicationApi;
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';

import {
  bridgeVersion,
  extensionMessageSchema,
  hostMessageSchema,
} from '@octopus/shared/protocol/browser-bridge';
/**
 * Publishes the actual finite validator inputs alongside the build; it does not declare currently granted tools or replace MCP tools/list projections.
 */
export async function emitValidationSchemas(path) {
  const groups = {
    basic: {
      read: readInputSchema,
      write: writeInputSchema,
      edit: editInputSchema,
      powershell: shellInputSchema,
      grep: grepInputSchema,
      find: findInputSchema,
      ls: lsInputSchema,
    },
    browser: browserSchemas,
    computer: computerSchemas,
    control: {
      runtime_status: z.strictObject({}),
      task_start: taskStartSchema,
      task_status: taskStatusSchema,
      task_end: taskIdSchema,
      task_stop: taskIdSchema,
    },
    bridge: { extensionMessage: extensionMessageSchema, hostMessage: hostMessageSchema },
  };
  const schemas = Object.fromEntries(
    Object.entries(groups).map(([name, items]) => [
      name,
      Object.fromEntries(
        Object.entries(items).map(([key, schema]) => [
          key,
          z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }),
        ])
      ),
    ])
  );
  await writeFile(
    path,
    JSON.stringify(
      {
        schemaVersion: 1,
        bridgeVersion,
        scope: 'validation-projections-without-runtime-refinements-or-grants',
        schemas,
      },
      null,
      2
    )
  );
}
