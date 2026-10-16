/**
 * @author Codex
 * @description Verifies explicit system-Shell platform selection without claiming non-Windows runtime support or invoking PATH-selected interpreters.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { win32 } from 'node:path';
import { selectShellPlatform } from '../src/runtime/basic/shell-platform.ts';

test('Windows Shell selection fixes the system PowerShell path and unsupported platforms remain explicit', () => {
  assert.equal(
    selectShellPlatform('win32'),
    win32.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  );
  assert.throws(() => selectShellPlatform('linux'), /Linux.*not implemented/);
  assert.throws(() => selectShellPlatform('darwin'), /macOS.*not implemented/);
  assert.throws(() => selectShellPlatform('freebsd'), /Unsupported/);
});
