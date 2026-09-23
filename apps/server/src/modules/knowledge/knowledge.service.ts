/**
 * @author Codex
 * @description Host authorization and error translation over the independent knowledge daemon client.
 */
import {
  checkKnowledgeServiceHealth,
  createKnowledgeClient,
  getKnowledgeServiceStatus,
  KnowledgeError,
  restartKnowledgeService,
  startKnowledgeService,
  stopKnowledgeService,
} from '@octopus/agent';
import { ApplicationError } from '../../infrastructure/errors/application-error.js';
import type { KnowledgeOperations } from '@octopus/agent';
import type { WorkspacesService } from '../workspaces/index.js';

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
    let statusCode = 400;
    if (error.code === 'NOT_FOUND') {
      statusCode = 404;
    } else if (error.code === 'FORBIDDEN') {
      statusCode = 403;
    } else if (error.code.includes('CONFLICT')) {
      statusCode = 409;
    } else if (error.retryable) {
      statusCode = 503;
    }
    return new ApplicationError(error.code, error.message, {
      statusCode,
      retryable: error.retryable,
    });
  }
  return error;
}
