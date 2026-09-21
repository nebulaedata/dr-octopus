/**
 * @author Codex
 * @description Explicit memory management command usable in TUI and native RPC without terminal-only UI.
 */
import { createHash, randomUUID } from 'node:crypto';
import { publishMemoryStatus } from './ui.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { MemoryService } from '../services/memory-service.js';
/**
 * Parse complete explicit commands and publish committed receipts without starting a model turn.
 */
export function registerMemoryCommands(pi: ExtensionAPI, service: MemoryService) {
  pi.registerCommand('memory', {
    description:
      '记忆: status | list [cursor] | read <store/id> | remember <text> | forget <store/id> | mode off|manual|auto',
    handler: async (args, ctx) => {
      const [action = 'status', ...rest] = (args.trim() || 'status').split(/\s+/u);
      const value = rest.join(' ');
      let output: unknown;
      try {
        if (action === 'rebuild') {
          output = await service.rebuildFts();
        } else if (action === 'status') {
          output = await service.getStatus();
        } else if (action === 'list') {
          output = await service.recall({ mode: 'page', ...(value ? { cursor: value } : {}) });
        } else if (action === 'mode') {
          output = await service.setPolicy({
            requestId: randomUUID(),
            mode: value,
            expectedRevision: (await service.getStatus()).revision,
          });
        } else if (action === 'remember') {
          output = await service.remember({
            requestId: randomUUID(),
            canonicalKey: 'user.note.' + createHash('sha256').update(value).digest('hex').slice(0, 24),
            topic: '用户记录',
            type: 'other',
            indexText: value.slice(0, 120),
            bodyMd: value,
            sources: [],
          });
        } else if (action === 'read' || action === 'forget') {
          const [storeId, id] = value.split('/');
          const ref = { storeId, indexId: Number(id) };
          const read = await service.read({ refs: [ref] });
          if (action === 'read') {
            output = read;
          } else {
            const doc = read.items[0]?.document;
            if (!doc) {
              throw new Error('记忆不存在。');
            }
            output = await service.forget({ requestId: randomUUID(), ref, expectedRevision: doc.revision });
          }
        } else {
          throw new Error(
            '用法：/memory status | list | read <store/id> | remember <text> | forget <store/id> | mode off|manual|auto'
          );
        }
        pi.sendMessage(
          { customType: 'octopus-memory-command', content: JSON.stringify(output), display: true },
          { triggerTurn: false }
        );
        publishMemoryStatus(ctx, await service.getStatus());
      } catch (error) {
        pi.sendMessage(
          {
            customType: 'octopus-memory-command',
            content: error instanceof Error ? error.message : '记忆操作失败。',
            display: true,
          },
          { triggerTurn: false }
        );
      }
    },
  });
}
