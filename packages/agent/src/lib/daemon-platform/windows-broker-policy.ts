/**
 * @author Codex
 * @description Accept only non-restrictive ambient Jobs after WMI has separated the caller's process tree.
 */
/**
 * WMI does not inherit the caller's Jobs. Permit the observed ambient breakaway-only Job,
 * but fail closed on unknown flags, lifecycle/resource limits, or an unsuccessful query.
 * This is not a general proof of detachment for children created in the caller's process tree.
 */
export function permitsBrokerJob(limitFlags: number | undefined): boolean {
  return limitFlags === (0x00000800 | 0x00001000);
}
