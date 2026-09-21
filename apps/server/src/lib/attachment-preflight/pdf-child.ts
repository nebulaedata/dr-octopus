/**
 * @author Codex
 * @description Inspects one PDF in a disposable process and emits only bounded structural evidence.
 */
import { inspectPdfObjects } from './pdf-objects.js';

process.once('message', (path: unknown) => {
  if (typeof path !== 'string') {
    process.exit(1);
  }
  void inspectPdfObjects(path).then(
    (result) => process.send?.(result, () => process.exit(0)),
    () => process.exit(1)
  );
});
