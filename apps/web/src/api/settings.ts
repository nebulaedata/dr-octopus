/**
 * @author Codex
 * @description Exposes typed HTTP operations for model-provider and default-model Settings.
 */

import { request } from '../utils/request';
import { v4 as uuidv4 } from 'uuid';
import type {
  AnswerProviderAuthPromptBody,
  CreateProviderAuthSessionBody,
  DefaultModelCandidatesDto,
  DefaultModelDto,
  ModelProviderCatalogDto,
  ModelProviderDetailDto,
  CreateMcpServerBody,
  McpServerCatalogDto,
  McpServerConnectivityDto,
  McpServerDetailDto,
  McpServerMutationDto,
  ProviderAuthResetResultDto,
  ProviderAuthSessionDto,
  UpdateDefaultModelBody,
  UpdateMcpServerActivationBody,
  UpdateMcpServerBody,
} from '@octopus/shared/protocol';

const mutationHeaders = (): Record<string, string> => ({ 'Idempotency-Key': uuidv4() });

/**
 * Retrieves the side-effect-free Pi Provider catalog.
 *
 * @param signal Query cancellation signal.
 * @returns Provider summaries.
 */
export function getModelProviders(signal?: AbortSignal): Promise<ModelProviderCatalogDto> {
  return request<ModelProviderCatalogDto>({
    url: '/settings/model-providers',
    method: 'GET',
    signal,
  });
}

/**
 * Retrieves one Provider detail by opaque route key.
 *
 * @param providerKey Server-issued opaque Provider key.
 * @param signal Query cancellation signal.
 * @returns Provider detail and model rows.
 */
export function getModelProvider(providerKey: string, signal?: AbortSignal): Promise<ModelProviderDetailDto> {
  return request<ModelProviderDetailDto>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}`,
    method: 'GET',
    signal,
  });
}

/**
 * Retrieves the configured global default model.
 *
 * @param signal Query cancellation signal.
 * @returns Current default-model state.
 */
export function getDefaultModel(signal?: AbortSignal): Promise<DefaultModelDto> {
  return request<DefaultModelDto>({ url: '/settings/default-model', method: 'GET', signal });
}

/**
 * Retrieves currently available candidates for the global default model.
 *
 * @param signal Query cancellation signal.
 * @returns Candidate catalog.
 */
export function getDefaultModelCandidates(signal?: AbortSignal): Promise<DefaultModelCandidatesDto> {
  return request<DefaultModelCandidatesDto>({
    url: '/settings/default-model/candidates',
    method: 'GET',
    signal,
  });
}

/**
 * Persists the selected global default pair for new Sessions.
 *
 * @param input Opaque Provider and model keys.
 * @returns Updated default-model state.
 */
export function updateDefaultModel(input: UpdateDefaultModelBody): Promise<DefaultModelDto> {
  return request<DefaultModelDto>({
    url: '/settings/default-model',
    method: 'PUT',
    data: input,
  });
}

/**
 * Starts one API Key or OAuth authentication session.
 *
 * @param providerKey Server-issued opaque Provider key.
 * @param input Selected authentication method.
 * @returns Initial non-secret authentication snapshot.
 */
export function createProviderAuthSession(
  providerKey: string,
  input: CreateProviderAuthSessionBody
): Promise<ProviderAuthSessionDto> {
  return request<ProviderAuthSessionDto>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/auth-sessions`,
    method: 'POST',
    data: input,
    headers: mutationHeaders(),
  });
}

/**
 * Retrieves one non-secret Provider authentication snapshot.
 *
 * @param providerKey Server-issued opaque Provider key.
 * @param authSessionId Opaque authentication session identity.
 * @param signal Query cancellation signal.
 * @returns Current session snapshot.
 */
export function getProviderAuthSession(
  providerKey: string,
  authSessionId: string,
  signal?: AbortSignal
): Promise<ProviderAuthSessionDto> {
  return request<ProviderAuthSessionDto>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/auth-sessions/${encodeURIComponent(authSessionId)}`,
    method: 'GET',
    signal,
  });
}

/**
 * Submits a write-only prompt answer without placing it in Query mutation state.
 *
 * @param providerKey Server-issued opaque Provider key.
 * @param authSessionId Opaque authentication session identity.
 * @param input Current prompt identity and transient answer.
 * @returns Snapshot after the answer is accepted.
 */
export function answerProviderAuthPrompt(
  providerKey: string,
  authSessionId: string,
  input: AnswerProviderAuthPromptBody
): Promise<ProviderAuthSessionDto> {
  return request<ProviderAuthSessionDto>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/auth-sessions/${encodeURIComponent(authSessionId)}/answers`,
    method: 'POST',
    data: input,
  });
}

/**
 * Cancels one active Provider authentication session.
 *
 * @param providerKey Server-issued opaque Provider key.
 * @param authSessionId Opaque authentication session identity.
 */
export function cancelProviderAuthSession(providerKey: string, authSessionId: string): Promise<void> {
  return request<void>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/auth-sessions/${encodeURIComponent(authSessionId)}`,
    method: 'DELETE',
    headers: mutationHeaders(),
  });
}

/**
 * Deletes the credential stored by this application for one Provider.
 *
 * @param providerKey Server-issued opaque Provider key.
 * @returns Credential deletion and Provider snapshot synchronization outcome.
 */
export function resetProviderAuth(providerKey: string): Promise<ProviderAuthResetResultDto> {
  return request<ProviderAuthResetResultDto>({
    url: `/settings/model-providers/${encodeURIComponent(providerKey)}/auth`,
    method: 'DELETE',
    headers: mutationHeaders(),
  });
}

/** Retrieves the effective user-scope MCP Server catalog. */
export function getMcpServers(signal?: AbortSignal): Promise<McpServerCatalogDto> {
  return request<McpServerCatalogDto>({ url: '/settings/mcp-servers', method: 'GET', signal });
}

/** Actively tests all or one effective MCP Server through isolated Server Host connections. */
export function probeMcpServerConnectivity(serverKey?: string): Promise<McpServerConnectivityDto> {
  return request<McpServerConnectivityDto>({
    url:
      serverKey === undefined
        ? '/settings/mcp-servers/connectivity-probe'
        : `/settings/mcp-servers/${encodeURIComponent(serverKey)}/connectivity-probe`,
    method: 'POST',
  });
}

/** Retrieves one secret-free MCP Server detail. */
export function getMcpServer(serverKey: string, signal?: AbortSignal): Promise<McpServerDetailDto> {
  return request<McpServerDetailDto>({
    url: `/settings/mcp-servers/${encodeURIComponent(serverKey)}`,
    method: 'GET',
    signal,
  });
}

/** Creates one Host-owned MCP Server definition. */
export function createMcpServer(input: CreateMcpServerBody): Promise<McpServerMutationDto> {
  return request<McpServerMutationDto>({
    url: '/settings/mcp-servers',
    method: 'POST',
    data: input,
    headers: mutationHeaders(),
  });
}

/** Updates one Host-owned MCP Server definition. */
export function updateMcpServer(
  serverKey: string,
  input: UpdateMcpServerBody
): Promise<McpServerMutationDto> {
  return request<McpServerMutationDto>({
    url: `/settings/mcp-servers/${encodeURIComponent(serverKey)}`,
    method: 'PUT',
    data: input,
    headers: mutationHeaders(),
  });
}

/** Changes the enabled override for one MCP Server. */
export function updateMcpServerActivation(
  serverKey: string,
  input: UpdateMcpServerActivationBody
): Promise<McpServerMutationDto> {
  return request<McpServerMutationDto>({
    url: `/settings/mcp-servers/${encodeURIComponent(serverKey)}/activation`,
    method: 'PATCH',
    data: input,
    headers: mutationHeaders(),
  });
}

/** Removes one owned MCP definition or Host override. */
export function deleteMcpServer(serverKey: string, revision: string): Promise<McpServerMutationDto> {
  return request<McpServerMutationDto>({
    url: `/settings/mcp-servers/${encodeURIComponent(serverKey)}`,
    method: 'DELETE',
    data: { revision },
    headers: mutationHeaders(),
  });
}
