/**
 * @author Codex
 * @description Shares credential-free maintenance progress across management components while Main owns each operation.
 */
import { queryOptions } from '@tanstack/react-query';
import { readMaintenance } from '@/api/maintenance';

export const maintenanceQuery = queryOptions({
  queryKey: ['executor', 'maintenance'],
  queryFn: readMaintenance,
  networkMode: 'always',
  refetchInterval: 500,
  retry: false,
});
