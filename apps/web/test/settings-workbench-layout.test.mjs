/**
 * @author Codex
 * @description Guards canonical and route-masked Settings presentations inside the Workbench shell.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Settings keeps canonical routes while Workbench entry opens one route-masked dialog', () => {
  const router = readFileSync(new URL('../src/router/index.ts', import.meta.url), 'utf8');
  const layout = readFileSync(
    new URL('../src/features/settings/layout/SettingsLayout.tsx', import.meta.url),
    'utf8'
  );
  const dialog = readFileSync(
    new URL('../src/features/settings/layout/SettingsDialogHost.tsx', import.meta.url),
    'utf8'
  );
  const workbench = readFileSync(new URL('../src/features/layout/index.tsx', import.meta.url), 'utf8');
  const header = readFileSync(new URL('../src/features/layout/Header.tsx', import.meta.url), 'utf8');

  assert.match(
    router,
    /const settingsLayoutRoute = createRoute\(\{[\s\S]*?getParentRoute: \(\) => workbenchLayoutRoute/u
  );
  assert.match(router, /workbenchLayoutRoute\.addChildren\(\[[\s\S]*?settingsLayoutRoute\.addChildren/u);
  assert.match(router, /settings: settingsModalSearchSchema\.optional\(\)/u);
  assert.match(layout, /<SettingsFrame pathname=\{pathname\}>/u);
  assert.doesNotMatch(layout, /h-dvh|SidebarProvider/u);
  assert.match(workbench, /mask: \{[\s\S]*?to: '\/settings\/model-providers'/u);
  assert.match(workbench, /unmaskOnReload: true/u);
  assert.match(workbench, /<LazySettingsDialogHost location=\{search\.settings\}/u);
  assert.match(dialog, /router\.history\.back\(\)/u);
  assert.match(dialog, /replace: true/u);
  assert.match(dialog, /<DialogTitle>\{t\('settings\.frame\.titleFallback', 'Settings'\)\}<\/DialogTitle>/u);
  assert.match(header, /pathname\.startsWith\('\/settings'\)/u);
});

test('scheduled-task management is a Workbench page while Settings only owns service configuration', () => {
  const router = readFileSync(new URL('../src/router/index.ts', import.meta.url), 'utf8');
  const header = readFileSync(new URL('../src/features/layout/Header.tsx', import.meta.url), 'utf8');
  const management = readFileSync(
    new URL('../src/features/schedules/SchedulesPage.tsx', import.meta.url),
    'utf8'
  );
  const settings = readFileSync(
    new URL('../src/features/settings/schedules/SchedulerSettingsPage.tsx', import.meta.url),
    'utf8'
  );

  assert.match(
    router,
    /const schedulesRoute = createRoute\(\{[\s\S]*?getParentRoute: \(\) => workbenchLayoutRoute/u
  );
  assert.match(
    router,
    /const schedulerSettingsRoute = createRoute\(\{[\s\S]*?getParentRoute: \(\) => settingsLayoutRoute/u
  );
  assert.match(header, /id: 'cron',[\s\S]*?to: '\/schedules'/u);
  assert.match(management, /ScheduleTaskList/u);
  assert.doesNotMatch(management, /ScheduleWorkspaceGroup|新建任务/u);
  assert.doesNotMatch(management, /SchedulerServicePanel/u);
  assert.match(settings, /<SchedulerServicePanel \/>/u);
  assert.doesNotMatch(settings, /ScheduleTaskList|新建任务/u);
});

test('complete Settings navigation entries all resolve to a concrete dialog page', () => {
  const navigation = readFileSync(
    new URL('../src/features/settings/settings-navigation.ts', import.meta.url),
    'utf8'
  );
  const dialog = readFileSync(
    new URL('../src/features/settings/layout/SettingsDialogHost.tsx', import.meta.url),
    'utf8'
  );

  const entries = [
    ...navigation.matchAll(/path: '(?<path>[^']+)'[\s\S]*?pageType: '(?<pageType>complete|placeholder)'/gu),
  ].map((match) => match.groups);
  assert.ok(entries.length > 0, 'expected to parse navigation entries');

  for (const entry of entries) {
    const hasDedicatedCase = dialog.includes(`case '${entry.path}':`);
    if (entry.pageType === 'complete') {
      assert.ok(
        hasDedicatedCase,
        `SettingsDialogHost must render a real page for complete nav entry ${entry.path}`
      );
    } else {
      assert.ok(
        !hasDedicatedCase,
        `SettingsDialogHost must keep placeholder nav entry ${entry.path} on the placeholder page`
      );
    }
  }
});
