/**
 * @author Codex
 * @description Guards the Header chat entry across active Session and agent-home navigation states.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('chat stays enabled and falls back to the current workspace agent home without a Session', () => {
  const header = readFileSync(new URL('../src/features/layout/Header.tsx', import.meta.url), 'utf8');

  assert.match(
    header,
    /const chatTo =[\s\S]*?session !== undefined[\s\S]*?'\/workspaces\/\$workspaceId\/sessions\/\$sessionId'[\s\S]*?workspaceId !== undefined[\s\S]*?'\/workspaces\/\$workspaceId'[\s\S]*?: '\/'/u
  );
  assert.match(header, /active: isSessionRoute \|\| isAgentHomeRoute/u);
  assert.doesNotMatch(header, /id: 'chat'[\s\S]*?disabled: session === undefined[\s\S]*?\},/u);
});
