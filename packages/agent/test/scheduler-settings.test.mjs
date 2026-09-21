/**
 * @author Codex
 * @description Verifies cron.json persistence, validation and optimistic Scheduler configuration updates.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileSchedulerSettingsStore } from '../dist/extensions/scheduler/infrastructure/settings-store.js';
import { SchedulerSettingsService } from '../dist/extensions/scheduler/services/settings-service.js';

test('Scheduler settings persist only in cron.json with validation and revision fencing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'octopus-scheduler-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = new SchedulerSettingsService(
    new FileSchedulerSettingsStore(directory),
    () => '2026-09-06T00:00:00.000Z'
  );

  const initial = await service.get();
  assert.equal(initial.maxConcurrentRuns, 3);
  assert.equal(initial.revision, 1);
  const updated = await service.update({
    timezone: 'Asia/Shanghai',
    maxConcurrentRuns: 5,
    revision: initial.revision,
  });
  assert.deepEqual(updated, {
    timezone: 'Asia/Shanghai',
    maxConcurrentRuns: 5,
    revision: 2,
    updatedAt: '2026-09-06T00:00:00.000Z',
  });
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'cron.json'), 'utf8')), updated);
  await assert.rejects(service.update({ timezone: 'Invalid/Timezone', maxConcurrentRuns: 5, revision: 2 }), {
    code: 'SCHEDULE_SETTINGS_INVALID',
  });
  await assert.rejects(service.update({ timezone: 'UTC', maxConcurrentRuns: 5, revision: 1 }), {
    code: 'SCHEDULE_SETTINGS_CONFLICT',
  });
});
