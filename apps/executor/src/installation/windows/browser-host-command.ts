/**
 * @author Codex
 * @description Runs the same Host maintenance used by Main from the fixed private Node bundled with installers.
 */
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { BrowserHostMaintenance } from '../../maintenance/browser-host';
import { probeBrowserHost } from './browser-host-probe';
import { browserRepairSchema } from '../../contracts/browser-maintenance';
import {
  browserHostDirectory,
  windowsBrowserRegistry,
  withBrowserMaintenanceLease,
} from './browser-host-platform';

/**
 * Accepts only installation-owned roots and finite commands, never scripts or remote content.
 */
async function main(): Promise<void> {
  const [mode, resource, project, request] = z
    .tuple([
      z.enum(['install', 'remove', 'inspect']),
      z.string().refine(isAbsolute),
      z.string().refine(isAbsolute),
      z.string().max(300).optional(),
    ])
    .parse(process.argv.slice(2));
  const resourceRoot = await browserHostDirectory(resource);
  const projectRoot = await browserHostDirectory(project);
  await withBrowserMaintenanceLease(resourceRoot, async () => {
    const service = new BrowserHostMaintenance(
      resourceRoot,
      projectRoot,
      windowsBrowserRegistry(resourceRoot),
      probeBrowserHost
    );
    if (mode === 'install') {
      console.log(
        JSON.stringify(
          await service.repair(
            request
              ? browserRepairSchema.parse(JSON.parse(Buffer.from(request, 'base64').toString('utf8')))
              : undefined
          )
        )
      );
    } else if (mode === 'inspect') {
      console.log(JSON.stringify(await service.inspect()));
    } else {
      await service.remove();
    }
  });
}
void main().catch((error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'ENOSPC') {
    console.error('HOST_STORAGE_FULL');
  } else if (code === 'EACCES' || code === 'EPERM') {
    console.error('HOST_STORAGE_ACCESS_DENIED');
  } else {
    console.error(error instanceof Error ? error.message : 'HOST_MAINTENANCE_FAILED');
  }
  process.exitCode = 1;
});
