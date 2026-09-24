/**
 * @author Codex
 * @description Owns Settings server state through hierarchical TanStack Query operations.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDefaultModel,
  getDefaultModelCandidates,
  getModelProvider,
  getModelProviders,
  updateDefaultModel,
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  getMcpServers,
  probeMcpServerConnectivity,
  updateMcpServer,
  updateMcpServerActivation,
} from '../api/settings';
import { queryKeys } from '@/queries/core/query-keys';
import type { McpServerCatalogDto, McpServerConnectivityDto } from '@octopus/shared/protocol';

export const modelProvidersQueryOptions = queryOptions({
  queryKey: queryKeys.modelProviders,
  queryFn: ({ signal }) => getModelProviders(signal),
});

/**
 * Builds the detail query for one opaque Provider key.
 *
 * @param providerKey Opaque Provider key.
 * @returns Type-safe Provider detail query options.
 */
export function modelProviderQueryOptions(providerKey: string) {
  return queryOptions({
    queryKey: queryKeys.modelProvider(providerKey),
    queryFn: ({ signal }) => getModelProvider(providerKey, signal),
    enabled: providerKey.length > 0,
  });
}

export const defaultModelQueryOptions = queryOptions({
  queryKey: queryKeys.defaultModel,
  queryFn: ({ signal }) => getDefaultModel(signal),
});

export const defaultModelCandidatesQueryOptions = queryOptions({
  queryKey: queryKeys.defaultModelCandidates,
  queryFn: ({ signal }) => getDefaultModelCandidates(signal),
});

/**
 * Reads the Provider catalog.
 *
 * @returns Reactive Provider query.
 */
export function useModelProviders() {
  return useQuery(modelProvidersQueryOptions);
}

/**
 * Reads one Provider only when an opaque key is selected.
 *
 * @param providerKey Opaque Provider key or undefined while the catalog owns the screen.
 * @returns Reactive Provider detail query.
 */
export function useModelProvider(providerKey: string | undefined) {
  return useQuery(modelProviderQueryOptions(providerKey ?? ''));
}

/**
 * Reads the configured default model and current candidates in parallel.
 *
 * @returns Independent Query results for status and candidates.
 */
export function useDefaultModelSettings() {
  const current = useQuery(defaultModelQueryOptions);
  const candidates = useQuery(defaultModelCandidatesQueryOptions);
  return { current, candidates };
}

/**
 * Persists the default pair, then synchronizes all affected model caches.
 *
 * @returns Default-model mutation.
 */
export function useUpdateDefaultModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateDefaultModel,
    async onSuccess(value) {
      queryClient.setQueryData(queryKeys.defaultModel, value);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.modelProviders }),
        queryClient.invalidateQueries({ queryKey: queryKeys.modelProvidersRoot }),
      ]);
    },
  });
}

export const mcpServersQueryOptions = queryOptions({
  queryKey: queryKeys.mcpServers,
  queryFn: ({ signal }) => getMcpServers(signal),
});

/** Reads the effective MCP Server catalog. */
export function useMcpServers() {
  return useQuery(mcpServersQueryOptions);
}

type ConnectivityResult = McpServerConnectivityDto['servers'][number];

/** Owns initial full probing and later per-Server refreshes without blanking sibling rows. */
export function useMcpServerConnectivityProbe(catalog: McpServerCatalogDto | undefined) {
  const initialized = useRef(false);
  const latestRevision = useRef<string | undefined>(undefined);
  const pendingCounts = useRef(new Map<string, number>());
  const probeRevisions = useRef(new Map<string, string>());
  const [results, setResults] = useState<ReadonlyMap<string, ConnectivityResult>>(() => new Map());
  const [pendingServerKeys, setPendingServerKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [failedServerKeys, setFailedServerKeys] = useState<ReadonlySet<string>>(() => new Set());
  const { mutateAsync } = useMutation({ mutationFn: probeMcpServerConnectivity });

  /** Adds or removes one pending ownership count for every affected Server. */
  const changePending = useCallback((serverKeys: readonly string[], delta: 1 | -1) => {
    for (const serverKey of serverKeys) {
      const next = (pendingCounts.current.get(serverKey) ?? 0) + delta;
      if (next > 0) {
        pendingCounts.current.set(serverKey, next);
      } else {
        pendingCounts.current.delete(serverKey);
      }
    }
    setPendingServerKeys(new Set(pendingCounts.current.keys()));
  }, []);

  /** Runs one full or targeted probe and merges only its returned rows. */
  const runProbe = useCallback(
    async (serverKey: string | undefined, expectedRevision?: string): Promise<void> => {
      const affectedKeys =
        serverKey === undefined ? (catalog?.servers.map((server) => server.serverKey) ?? []) : [serverKey];
      const requestRevision = expectedRevision ?? latestRevision.current;
      if (requestRevision === undefined) {
        return;
      }
      affectedKeys.forEach((key) => probeRevisions.current.set(key, requestRevision));
      changePending(affectedKeys, 1);
      setFailedServerKeys((current) => {
        const next = new Set(current);
        affectedKeys.forEach((key) => next.delete(key));
        return next;
      });
      try {
        const response = await mutateAsync(serverKey);
        if (response.revision !== requestRevision) {
          return;
        }
        setResults((current) => {
          const next = new Map(current);
          response.servers.forEach((result) => {
            if (probeRevisions.current.get(result.serverKey) === response.revision) {
              next.set(result.serverKey, result);
            }
          });
          return next;
        });
      } catch {
        const currentFailures = affectedKeys.filter(
          (key) => probeRevisions.current.get(key) === requestRevision
        );
        setFailedServerKeys((current) => new Set([...current, ...currentFailures]));
      } finally {
        changePending(affectedKeys, -1);
      }
    },
    [catalog?.servers, changePending, mutateAsync]
  );

  useEffect(() => {
    latestRevision.current = catalog?.revision;
    if (catalog === undefined) {
      return;
    }
    if (!initialized.current) {
      initialized.current = true;
      queueMicrotask(() => void runProbe(undefined));
    }
  }, [catalog, runProbe]);

  const catalogKeys = new Set(catalog?.servers.map((server) => server.serverKey) ?? []);
  const visibleResults = new Map([...results].filter(([serverKey]) => catalogKeys.has(serverKey)));

  return {
    results: visibleResults,
    pendingServerKeys,
    failedServerKeys,
    probeServer: (serverKey: string, revision: string) => runProbe(serverKey, revision),
  };
}

/** Reads one MCP Server only after a catalog row is selected. */
export function useMcpServer(serverKey: string | undefined) {
  return useQuery({
    queryKey: queryKeys.mcpServer(serverKey ?? ''),
    queryFn: ({ signal }) => getMcpServer(serverKey!, signal),
    enabled: serverKey !== undefined,
  });
}

/** Owns MCP mutations and synchronizes the complete Settings subtree after writes. */
export function useMcpServerMutations() {
  const queryClient = useQueryClient();
  const synchronize = async () => queryClient.invalidateQueries({ queryKey: queryKeys.mcpServersRoot });
  return {
    create: useMutation({ mutationFn: createMcpServer, onSuccess: synchronize }),
    update: useMutation({
      mutationFn: ({
        serverKey,
        input,
      }: {
        serverKey: string;
        input: Parameters<typeof updateMcpServer>[1];
      }) => updateMcpServer(serverKey, input),
      onSuccess: synchronize,
    }),
    activation: useMutation({
      mutationFn: ({
        serverKey,
        input,
      }: {
        serverKey: string;
        input: Parameters<typeof updateMcpServerActivation>[1];
      }) => updateMcpServerActivation(serverKey, input),
      onSuccess: synchronize,
    }),
    remove: useMutation({
      mutationFn: ({ serverKey, revision }: { serverKey: string; revision: string }) =>
        deleteMcpServer(serverKey, revision),
      onSuccess: synchronize,
    }),
  };
}
