/**
 * @author Codex
 * @description Competes for a test-only Gateway lock without creating an HTTP application or Agent runtime.
 */
import { acquireGateway } from '../../src/gateway/owner.ts';

try {
  await acquireGateway('/fixture/index.js', 'test', () => process.exit(0), JSON.parse(process.argv[2]));
  process.send({ acquired: true });
} catch (error) {
  process.send({ acquired: false, code: error.code }, () => process.exit(1));
}
