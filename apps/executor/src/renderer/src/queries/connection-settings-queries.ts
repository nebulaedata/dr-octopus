/**
 * @author Codex
 * @description Keeps authoritative next-start connection settings in the desktop Query cache.
 */
import { queryOptions } from '@tanstack/react-query';
import { readConnectionSettings, readNetworkAddresses } from '@/api/connection-settings';

export const connectionSettingsQuery = queryOptions({
  queryKey: ['executor', 'connection-settings'],
  queryFn: readConnectionSettings,
  networkMode: 'always',
  retry: false,
});

export const networkAddressesQuery = queryOptions({
  queryKey: ['executor', 'network-addresses'],
  queryFn: readNetworkAddresses,
  networkMode: 'always',
  retry: false,
});
