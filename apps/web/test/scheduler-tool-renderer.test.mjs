/**
 * @author Codex
 * @description Verifies Scheduler tool projection, summaries and custom renderer registration.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SchedulerToolRenderer } from '../src/features/session/ToolRenderers/CustomToolRenderers/SchedulerToolRenderer.tsx';
import { projectSchedulerTool } from '../src/features/session/utils/scheduler-projection.ts';
import { summarizeSchedulerTool } from '../src/features/session/utils/scheduler-projection.ts';
import { resolveToolRenderer } from './helpers/tool-renderer-selection.mjs';

/**
 * Returns the source default with interpolation so assertions pin the English contract.
 */
const t = (key, defaultValue, options) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options?.[name] ?? ''));

const task = {
  id: 'task-1',
  name: 'Morning report',
  prompt: 'Summarize yesterday.',
  schedule: { type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
  enabled: true,
  revision: 2,
  nextRunAt: '2026-09-07T01:00:00.000Z',
  pausedAt: null,
};

test('projects Scheduler mutation details into a themed task and run contract', () => {
  const tool = {
    id: 'tool-1',
    name: 'scheduler_run_now',
    status: 'success',
    startedAt: 0,
    arguments: { taskId: 'task-1' },
    content: [],
    details: {
      effect: 'queued',
      task,
      run: {
        id: 'run-1',
        taskId: 'task-1',
        status: 'queued',
        triggerSource: 'manual',
        scheduledFor: '2026-09-06T01:00:00.000Z',
        startedAt: null,
        settledAt: null,
        summary: null,
        errorCode: null,
      },
      warnings: [],
    },
  };

  assert.deepEqual(projectSchedulerTool(t, tool), {
    effect: 'queued',
    task: {
      id: 'task-1',
      name: 'Morning report',
      prompt: 'Summarize yesterday.',
      enabled: true,
      revision: 2,
      nextRunAt: '2026-09-07T01:00:00.000Z',
      pausedAt: null,
      schedule: { type: 'cron', primary: '0 9 * * *', secondary: 'Asia/Shanghai' },
    },
    tasks: [],
    run: {
      id: 'run-1',
      taskId: 'task-1',
      status: 'queued',
      triggerSource: 'manual',
      scheduledFor: '2026-09-06T01:00:00.000Z',
      startedAt: null,
      settledAt: null,
      summary: null,
      errorCode: null,
    },
    runs: [],
    warnings: [],
    requestedTaskId: 'task-1',
  });
  assert.equal(summarizeSchedulerTool(tool, t), 'Morning report');
});

test('bounds Scheduler collections and registers every scheduler tool', () => {
  const tool = {
    id: 'tool-2',
    name: 'scheduler_list',
    status: 'success',
    startedAt: 0,
    content: [],
    details: { items: [task, { ...task, id: 'task-2', name: 'Evening report' }], limit: 20, offset: 0 },
  };
  assert.equal(projectSchedulerTool(t, tool).tasks.length, 2);
  assert.equal(summarizeSchedulerTool(tool, t), '2 tasks');
  for (const name of [
    'scheduler_create',
    'scheduler_list',
    'scheduler_get',
    'scheduler_update',
    'scheduler_delete',
    'scheduler_run_now',
    'scheduler_cancel',
    'scheduler_history',
  ]) {
    assert.equal(resolveToolRenderer(name).component.name, 'SchedulerToolRenderer');
  }
  assert.equal(resolveToolRenderer('scheduler_unknown').component.name, 'FallbackToolRenderer');
});

test('failed creation keeps its error visible beside the argument preview', () => {
  const html = renderToStaticMarkup(
    createElement(SchedulerToolRenderer, {
      tool: {
        id: 'failed-create',
        name: 'scheduler_create',
        status: 'error',
        startedAt: 0,
        arguments: task,
        content: [{ type: 'text', text: 'Scheduler was explicitly stopped' }],
      },
    })
  );
  assert.match(html, /Morning report/u);
  assert.match(html, /Scheduler was explicitly stopped/u);
});

test('failed structured results retain errors while successful results avoid duplicate raw output', () => {
  for (const status of ['error', 'success']) {
    const html = renderToStaticMarkup(
      createElement(SchedulerToolRenderer, {
        tool: {
          id: 'structured-result',
          name: 'scheduler_update',
          status,
          startedAt: 0,
          content: [{ type: 'text', text: 'raw transport output' }],
          details: { task },
        },
      })
    );
    assert.equal(html.includes('raw transport output'), status === 'error');
    assert.match(html, /Morning report/u);
  }
});
