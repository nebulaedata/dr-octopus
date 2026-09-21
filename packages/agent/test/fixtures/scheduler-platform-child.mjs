/**
 * @author Codex
 * @description Isolated process fixture for scheduler OS locks and detached process survival.
 */
import { writeFile } from 'node:fs/promises';
import { tryAcquireSingletonLease } from '../../dist/extensions/scheduler/infrastructure/singleton-lease.js';
import { launchDetachedNode } from '../../dist/extensions/scheduler/infrastructure/detached-launcher.js';

const [operation, path] = process.argv.slice(2);
if (operation === 'lock') {
  const lease = await tryAcquireSingletonLease(path);
  process.send({ acquired: lease !== null });
  if (lease) {
    process.on('message', () => {
      lease.release();
      lease.release();
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
} else if (operation === 'launch') {
  try {
    const pid = await launchDetachedNode([import.meta.filename, 'survive', path], process.cwd());
    process.send({ pid });
  } catch (error) {
    process.send({ error: error.code });
  }
  process.on('message', () => process.exit(0));
} else if (operation === 'survive') {
  // Bounded child life prevents leaked processes even if its parent test fails.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await writeFile(path, String(process.pid));
}
