/**
 * @author Codex
 * @description Guards visible execution state when scheduling is paused or authorization changes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScheduleTaskStatusBadge } from '../src/features/schedules/ScheduleTaskStatusBadge.tsx';

const task = { enabled: true, authorizationRef: 'grant-1', hasActiveRun: true };

test('keeps active execution visible after pausing future scheduling', () => {
  const html = renderToStaticMarkup(
    createElement(ScheduleTaskStatusBadge, {
      task: { ...task, enabled: false, pausedAt: '2026-09-07T00:00:00Z' },
    })
  );
  assert.match(html, /Schedule paused/);
  assert.match(html, /Running/);
});

test('does not hide an active run behind authorization restrictions', () => {
  const html = renderToStaticMarkup(
    createElement(ScheduleTaskStatusBadge, {
      task: { ...task, authorizationBlock: 'REVOKED' },
    })
  );
  assert.match(html, /Pending authorization/);
  assert.match(html, /Running/);
});

test('shows execution status once and removes it when the run settles', () => {
  const running = renderToStaticMarkup(createElement(ScheduleTaskStatusBadge, { task }));
  assert.equal(running.match(/Running/g)?.length, 1);
  const settled = renderToStaticMarkup(
    createElement(ScheduleTaskStatusBadge, {
      task: { ...task, hasActiveRun: false },
    })
  );
  assert.doesNotMatch(settled, /Running/);
  assert.match(settled, /Enabled/);
});

test('permission denial is an execution restriction rather than a request to authorize again', () => {
  const html = renderToStaticMarkup(
    createElement(ScheduleTaskStatusBadge, {
      task: { ...task, authorizationBlock: 'SCHEDULE_PERMISSION_DENIED' },
    })
  );
  assert.match(html, /Execution restricted/);
  assert.doesNotMatch(html, /Pending authorization/);
  assert.match(html, /Running/);
});
