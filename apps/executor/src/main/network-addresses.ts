/**
 * @author Codex
 * @description Discovers private IPv4 listener choices from local interfaces without choosing or changing a network.
 */
import { networkInterfaces } from 'node:os';
import {
  networkAddressSchema,
  networkAddressesSchema,
  type NetworkAddress,
} from '../contracts/connection-settings';

/**
 * Projects an OS interface snapshot to unique eligible addresses, retaining all interface names for shared addresses.
 * @param interfaces Local OS addresses; defaults to a fresh snapshot on each call.
 * @returns Addresses sorted numerically; discovery does not establish remote reachability.
 * @throws When OS discovery fails or its projection exceeds the bounded response contract.
 */
export function listNetworkAddresses(interfaces = networkInterfaces()): NetworkAddress[] {
  const addresses = new Map<string, Set<string>>();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (
        entry.internal ||
        entry.family !== 'IPv4' ||
        !networkAddressSchema.safeParse(entry.address).success
      ) {
        continue;
      }
      const names = addresses.get(entry.address) ?? new Set<string>();
      names.add(name);
      addresses.set(entry.address, names);
    }
  }
  return networkAddressesSchema.parse(
    [...addresses]
      .map(([address, names]) => ({ address, interfaceName: [...names].sort().join(' / ') }))
      .sort((left, right) => left.address.localeCompare(right.address, 'en', { numeric: true }))
  );
}
