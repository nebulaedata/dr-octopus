/**
 * @author Codex
 * @description Defines the shared Pino stdout presentation, root bindings, levels, and redaction policy.
 */

import { createRequire } from 'node:module';
import pino from 'pino';
import type { DestinationStream } from 'pino';
import type { PrettyOptions, PrettyStream } from 'pino-pretty';
import type { ServerLogLevel } from '../config/utils.js';

type PrettyFactory = (options?: PrettyOptions) => PrettyStream;

const require = createRequire(import.meta.url);
const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'token',
  'accessToken',
  'refreshToken',
  'password',
  'secret',
  'credential',
  '*.token',
  '*.password',
  '*.secret',
  'prompt',
  'promptText',
  'message.content',
  'attachment.content',
  'attachment.base64',
  'attachments[*].content',
  'attachments[*].base64',
  'toolInput',
  'toolOutput',
];

/**
 * Builds a process output destination without applying pretty formatting to disk logs.
 *
 * @param pretty Whether development formatting and colors are enabled, including redirected output.
 * @returns A Pino-compatible stdout destination.
 */
export function createStdoutDestination(pretty: boolean): DestinationStream {
  if (!pretty && !process.stdout.isTTY) {
    return process.stdout;
  }
  const prettyFactory = require('pino-pretty') as PrettyFactory;
  return prettyFactory({
    colorize: pretty,
    ignore: 'pid,hostname,service,schemaVersion',
    singleLine: false,
    sync: true,
    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
  });
}

/**
 * Defines stable root bindings and one redaction policy shared by every destination.
 *
 * @param level Most verbose level required by any destination.
 * @returns Pino root options shared by stdout and file output.
 */
export function createServerLogOptions(level: ServerLogLevel): pino.LoggerOptions {
  return {
    level,
    base: {
      pid: process.pid,
      service: 'octopus-server',
      schemaVersion: 1,
    },
    redact: {
      paths: REDACTED_LOG_PATHS,
      censor: '[Redacted]',
    },
  };
}

/**
 * Keeps the root logger permissive enough for independently filtered destinations.
 *
 * @param stdoutLevel Configured stdout threshold.
 * @param fileLevel Configured local-file threshold.
 * @returns The threshold that admits events required by either destination.
 */
export function selectMostVerboseLevel(
  stdoutLevel: ServerLogLevel,
  fileLevel: ServerLogLevel
): ServerLogLevel {
  const stdoutValue = pino.levels.values[stdoutLevel] ?? Number.POSITIVE_INFINITY;
  const fileValue = pino.levels.values[fileLevel] ?? Number.POSITIVE_INFINITY;
  return stdoutValue <= fileValue ? stdoutLevel : fileLevel;
}
