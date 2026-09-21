/**
 * @author Codex
 * @description Authenticated loopback task-control route with bounded JSON and domain-error projection.
 */
import { timingSafeEqual } from 'node:crypto';
import { PermissionGrantError } from '../../permission-system/sdk/index.js';
import { SchedulerTaskError } from '../definitions/task-error.js';
import type { SchedulerTranscriptReader } from '../infrastructure/transcript-reader.js';
import type { SchedulerAuthorizationCoordinator } from '../sdk/authorization-coordinator.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SchedulerEndpoint } from '../definitions/service-lifecycle.js';
import type { SchedulerTaskMutationRequest, SchedulerTaskContext } from '../definitions/tasks.js';
import type { SchedulerRequest } from '../definitions/port.js';
import type { SchedulerTaskService } from '../services/task-service.js';
import type { SchedulerDeliveryService } from '../services/delivery-service.js';

const requestLimit = 512 * 1024;
const responseLimit = 1024 * 1024;

interface SchedulerTaskEnvelope {
  context: SchedulerTaskContext;
  request: SchedulerRequest;
}

/**
 * Narrow the wire union before passing commands into the mutation service.
 */
function isMutationRequest(
  request: SchedulerTaskEnvelope['request']
): request is SchedulerRequest & { operation: SchedulerTaskMutationRequest['operation'] } {
  return ['create', 'update', 'delete', 'restore', 'purge', 'run-now', 'cancel'].includes(request.operation);
}

/**
 * Compare bearer credentials without leaking prefix matches or token length timing.
 */
function authorized(request: IncomingMessage, token: string): boolean {
  const expected = Buffer.from('Bearer ' + token);
  const supplied = Buffer.from(request.headers.authorization ?? '');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/**
 * Read one bounded JSON object and reject incomplete or oversized request bodies.
 */
async function readEnvelope(request: IncomingMessage): Promise<SchedulerTaskEnvelope> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    length += chunk.length;
    if (length > requestLimit) {
      throw new SchedulerTaskError('SCHEDULE_REQUEST_TOO_LARGE', 'Scheduler request is too large');
    }
    chunks.push(chunk);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SchedulerTaskError('SCHEDULE_INVALID', 'Invalid scheduled-task request');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SchedulerTaskError('SCHEDULE_INVALID', 'Invalid scheduled-task request');
  }
  const envelope = value as Partial<SchedulerTaskEnvelope>;
  if (
    envelope.context === null ||
    typeof envelope.context !== 'object' ||
    envelope.request === null ||
    typeof envelope.request !== 'object'
  ) {
    throw new SchedulerTaskError('SCHEDULE_INVALID', 'Invalid scheduled-task request');
  }
  if (
    ![
      'authorization-preview',
      'authorize',
      'revoke-authorization',
      'create',
      'update',
      'delete',
      'restore',
      'purge',
      'run-now',
      'cancel',
      'list',
      'get',
      'history',
      'transcript',
      'run-result',
      'delivery-list',
      'delivery-ack',
      'delivery-defer',
    ].includes((envelope.request as { operation?: string }).operation ?? '')
  ) {
    throw new SchedulerTaskError('SCHEDULE_INVALID', 'Invalid scheduled-task request');
  }
  return envelope as SchedulerTaskEnvelope;
}

/**
 * Send a bounded response; task prompts and histories must never create an unbounded loopback payload.
 */
function sendJson(response: ServerResponse, status: number, value: unknown): void {
  let body = JSON.stringify(value);
  if (Buffer.byteLength(body) > responseLimit) {
    status = 413;
    body = JSON.stringify({
      code: 'SCHEDULE_RESPONSE_TOO_LARGE',
      message: 'Scheduler response is too large',
    });
  }
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(body);
}

/**
 * Map stable domain failures to transport status without exposing SQL, paths or nested causes.
 */
function sendError(response: ServerResponse, error: unknown): void {
  if (!(error instanceof SchedulerTaskError) && !(error instanceof PermissionGrantError)) {
    sendJson(response, 503, {
      code: 'SCHEDULE_STORAGE_UNAVAILABLE',
      message: 'Scheduler request could not be completed',
    });
    return;
  }
  const status = error.code.endsWith('_NOT_FOUND')
    ? 404
    : error.code.includes('CONFLICT') || error.code.includes('REVISION') || error.code.includes('CANCELLABLE')
      ? 409
      : error.code.includes('UNAVAILABLE') || error.code.includes('STOPPING')
        ? 503
        : error.code.includes('TOO_LARGE')
          ? 413
          : 400;
  sendJson(response, status, { code: error.code, message: error.message });
}

/**
 * Handle only the task-control path; lifecycle credentials are checked by the outer server.
 */
export async function handleSchedulerTaskRequest(
  request: IncomingMessage,
  response: ServerResponse,
  endpoint: SchedulerEndpoint,
  taskToken: string,
  service: SchedulerTaskService,
  deliveryService: SchedulerDeliveryService,
  authorization?: SchedulerAuthorizationCoordinator,
  controlToken?: string,
  transcripts?: SchedulerTranscriptReader
): Promise<boolean> {
  if (request.url !== '/scheduler/v1/tasks/request') {
    return false;
  }
  if (
    request.method !== 'POST' ||
    request.headers.origin !== undefined ||
    request.headers['x-scheduler-daemon'] !== endpoint.daemonId ||
    request.headers['x-scheduler-profile'] !== endpoint.profileId ||
    (!authorized(request, taskToken) && !(controlToken && authorized(request, controlToken)))
  ) {
    response.writeHead(403).end();
    return true;
  }
  try {
    const { context, request: command } = await readEnvelope(request);
    if (
      ['restore', 'purge', 'run-result'].includes(command.operation) &&
      (!controlToken || !authorized(request, controlToken))
    ) {
      response.writeHead(403).end();
      return true;
    }
    if (['authorization-preview', 'authorize', 'revoke-authorization'].includes(command.operation)) {
      if (!authorization || !controlToken || !authorized(request, controlToken)) {
        response.writeHead(403).end();
        return true;
      }
      // Resolve the scope through the existing service before entering the user-only control boundary.
      service.get(context, command.taskId ?? '');
      if (command.operation === 'authorization-preview') {
        sendJson(response, 200, await authorization.preview(context, command.taskId!));
      } else {
        if (!Number.isSafeInteger(command.revision) || command.revision! < 1) {
          throw new SchedulerTaskError('SCHEDULE_REVISION_REQUIRED', 'Expected task revision is required');
        }
        if (command.operation === 'authorize') {
          await authorization.approve(
            context,
            command.taskId!,
            command.revision!,
            command.key ?? '',
            command.input
          );
        } else {
          authorization.revoke(context, command.taskId!, command.revision!);
        }
        sendJson(response, 200, {
          task: service.get(context, command.taskId!),
          effect: 'saved',
          warnings: [],
        });
      }
      return true;
    }
    if (command.operation === 'transcript' || command.operation === 'run-result') {
      if (!transcripts) {
        throw new SchedulerTaskError('SCHEDULE_ARTIFACT_UNAVAILABLE', 'Result reader is unavailable');
      }
      const runId = (command.input as { runId?: unknown })?.runId;
      if (typeof runId !== 'string') {
        throw new SchedulerTaskError('SCHEDULE_INVALID', 'Run identity is required');
      }
      sendJson(
        response,
        200,
        command.operation === 'run-result'
          ? await transcripts.result(context, command.taskId ?? '', runId)
          : await transcripts.read(context, command.taskId ?? '', runId)
      );
      return true;
    }
    const origin = context.originSessionRef;
    const result =
      command.operation === 'delivery-list'
        ? deliveryService.listPending(typeof origin === 'string' ? origin : '')
        : command.operation === 'delivery-ack'
          ? deliveryService.ack(
              typeof origin === 'string' ? origin : '',
              command.deliveryId ?? '',
              command.originEntryId ?? ''
            )
          : command.operation === 'delivery-defer'
            ? deliveryService.defer(
                typeof origin === 'string' ? origin : '',
                command.deliveryId ?? '',
                command.availableAt ?? '',
                command.errorCode ?? ''
              )
            : isMutationRequest(command)
              ? service.mutate(context, {
                  operation: command.operation,
                  key: command.key ?? '',
                  taskId: command.taskId,
                  revision: command.revision,
                  input: command.input,
                })
              : command.operation === 'list'
                ? service.list(context, command.input)
                : command.operation === 'get'
                  ? service.get(context, command.taskId ?? '')
                  : service.history(context, command.taskId ?? '', command.input);
    sendJson(response, 200, result);
  } catch (error) {
    sendError(response, error);
  }
  return true;
}
