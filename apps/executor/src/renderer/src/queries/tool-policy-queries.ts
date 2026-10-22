/**
 * @author Codex
 * @description Keeps persisted policy settings and confirmed Runtime application state in one Query snapshot.
 */
import { queryOptions } from '@tanstack/react-query';
import { readToolPolicies } from '@/api/tool-policies';

export const toolPoliciesQuery = queryOptions({
  queryKey: ['executor', 'tool-policies'],
  queryFn: readToolPolicies,
  networkMode: 'always',
  retry: false,
  refetchInterval: 5000,
});
