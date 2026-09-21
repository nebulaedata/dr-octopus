/**
 * @author Codex
 * @description Host authorization and error translation over the independent knowledge daemon client.
 */
import {
  createKnowledgeClient,
  KnowledgeError,
  checkKnowledgeServiceHealth,
  getKnowledgeServiceStatus,
  startKnowledgeService,
  stopKnowledgeService,
  restartKnowledgeService,
} from '@octopus/agent';
import { ApplicationError } from '../../lib/errors/application-error.js';
import type { KnowledgeOperations } from '@octopus/agent';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

export class KnowledgeService {
  /**
   * Reuse Workspace authority without importing any RPC session runtime.
   */
  constructor(
    private readonly agentDir: string,
    private readonly workspaces: WorkspacesService
  ) {}

  /**
   * Bind scope from the validated route, never from Browser-supplied principals or model tool arguments.
   */
  async call<K extends keyof KnowledgeOperations>(
    workspaceId: string | undefined,
    operation: K,
    input: KnowledgeOperations[K]['input']
  ) {
    try {
      if (workspaceId) {
        await this.workspaces.resolve({ id: workspaceId });
      }
      return await createKnowledgeClient({
        agentDir: this.agentDir,
        context: {
          principal: 'web:knowledge-management',
          workspaceId,
          globalWrite: true,
          modelAccess: 'manage',
        },
      }).call(operation, input);
    } catch (error) {
      throw translate(error);
    }
  }

  /**
   * Transfer file ownership before requesting asynchronous parsing and indexing.
   */
  async upload(workspaceId: string | undefined, bytes: Uint8Array) {
    try {
      if (workspaceId) {
        await this.workspaces.resolve({ id: workspaceId });
      }
      return await createKnowledgeClient({
        agentDir: this.agentDir,
        context: {
          principal: 'web:knowledge-management',
          workspaceId,
          globalWrite: true,
          modelAccess: 'manage',
        },
      }).upload(bytes);
    } catch (error) {
      throw translate(error);
    }
  }

  /**
   * Settings lifecycle commands preserve read-only status and durable explicit stop suppression.
   */
  async lifecycle(action: 'start' | 'stop' | 'restart' | 'status' | 'health') {
    const methods = {
      start: startKnowledgeService,
      stop: stopKnowledgeService,
      restart: restartKnowledgeService,
      status: getKnowledgeServiceStatus,
      health: checkKnowledgeServiceHealth,
    };
    try {
      return await methods[action](this.agentDir);
    } catch (error) {
      throw translate(error);
    }
  }
}

/**
 * Keep safe domain diagnostics while fitting the Server's existing transport error contract.
 */
function translate(error: unknown): unknown {
  if (error instanceof KnowledgeError) {
    return new ApplicationError(error.code, error.message, {
      statusCode:
        error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'FORBIDDEN'
            ? 403
            : error.code.includes('CONFLICT')
              ? 409
              : error.retryable
                ? 503
                : 400,
      retryable: error.retryable,
    });
  }
  return error;
}
