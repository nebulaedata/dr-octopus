/**
 * @author Codex
 * @description Composes client authorization and browser bridge management on the connection page.
 */
import type { AccessSnapshot } from '../../../../contracts/access';
import { DeviceAccess } from './DeviceAccess';
import { BrowserBridgeStatus } from './BrowserBridgeStatus';

/**
 * Shares the shell's readiness and browser snapshot with the existing connection controls.
 */
export function ConnectionPage({ ready, browser }: { ready: boolean; browser?: AccessSnapshot['browser'] }) {
  return (
    <>
      <DeviceAccess ready={ready} />
      <BrowserBridgeStatus data={browser} ready={ready} />
    </>
  );
}
