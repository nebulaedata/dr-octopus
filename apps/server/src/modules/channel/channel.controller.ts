/**
 * @author Codex
 * @description Adapts the Session channel application service to Fastify WebSocket transport.
 * - GET /ws
 */
import { randomUUID } from 'node:crypto';
import { negotiateLocale } from '../../infrastructure/i18n/negotiate-locale.js';
import { extractRequestId, sendChannelError, sendChannelMessage } from './channel.utils.js';
import { decodeClientMessage } from './channel.dto.js';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { PublicLocale } from '../../infrastructure/i18n/negotiate-locale.js';
import type { ChannelService } from './channel.service.js';

/**
 * Registers the Session channel endpoint and owns every WebSocket transport lifecycle concern.
 */
export function registerChannelController(server: FastifyInstance, service: ChannelService): void {
  const sockets = new Map<string, WebSocket>();
  const locales = new Map<string, PublicLocale>();

  server.get('/ws', { websocket: true }, (socket, request) => {
    const connectionId = randomUUID();
    sockets.set(connectionId, socket);
    locales.set(connectionId, negotiateLocale(request.headers['accept-language']));
    service.connect(connectionId, (message) => sendChannelMessage(socket, message));
    socket.on('message', (raw: Buffer) => {
      void routeMessage(service, connectionId, socket, raw.toString('utf8'), locales.get(connectionId));
    });
    socket.once('close', () => {
      sockets.delete(connectionId);
      locales.delete(connectionId);
      service.disconnect(connectionId);
    });
  });

  server.addHook('onClose', () => {
    service.close();
    sockets.clear();
    locales.clear();
  });
}

/**
 * Decodes and dispatches one transport message while retaining its request identity on failure.
 */
async function routeMessage(
  service: ChannelService,
  connectionId: string,
  socket: WebSocket,
  source: string,
  locale: PublicLocale | undefined
): Promise<void> {
  try {
    await service.handleMessage(connectionId, decodeClientMessage(source));
  } catch (error) {
    sendChannelError(socket, extractRequestId(source), error, locale);
  }
}
