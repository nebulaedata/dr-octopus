/**
 * @author Codex
 * @description Verifies Server environment defaults, overrides, and invalid-value diagnostics.
 */

import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadServerConfig } from '../dist/lib/config/config.js';
import { DEFAULT_HTTP_BODY_LIMIT_BYTES } from '../dist/lib/config/utils.js';

test('Server configuration maps the documented environment names', () => {
  const dataDir = join(tmpdir(), 'dr-octopus-server-config', 'server');
  const agentDir = join(tmpdir(), 'dr-octopus-server-config', 'agent');
  const config = loadServerConfig({
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
    SERVER_FILE_LOG_ENABLED: 'true',
    SERVER_FILE_LOG_LEVEL: 'error',
    SERVER_FILE_LOG_MAX_SIZE_MB: '25',
    SERVER_FILE_LOG_RETENTION_DAYS: '7',
    SERVER_FILE_LOG_MAX_FILES: '12',
    SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB: '512',
    SERVER_FILE_LOG_REQUIRED: 'true',
    SERVER_HOST: '0.0.0.0',
    SERVER_PORT: '3001',
    SERVER_CORS_ORIGIN: 'http://localhost:5173, http://127.0.0.1:5173',
    SERVER_HTTP_BODY_LIMIT_BYTES: '146800640',
    SERVER_ATTACHMENT_LIMIT_BYTES: '104857600',
    SERVER_MAX_ACTIVE_RUNTIMES: '16',
    SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE: '12',
    SERVER_DATA_DIR: dataDir,
    DR_OCTOPUS_CODING_AGENT_DIR: agentDir,
  });

  assert.deepEqual(config, {
    environment: 'production',
    logLevel: 'warn',
    fileLogging: {
      enabled: true,
      level: 'error',
      maxSizeMb: 25,
      retentionDays: 7,
      maxFiles: 12,
      maxTotalSizeMb: 512,
      required: true,
    },
    host: '0.0.0.0',
    port: 3001,
    corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    httpBodyLimitBytes: 146800640,
    attachmentLimitBytes: 104857600,
    maxActiveRuntimes: 16,
    maxActiveRuntimesPerWorkspace: 12,
    paths: {
      dataDir,
      databasePath: join(dataDir, 'octopus.db'),
      attachmentsRoot: join(dataDir, 'attachments'),
      backupsRoot: join(dataDir, 'backups'),
      stateRoot: join(dataDir, 'state'),
      logsRoot: join(dataDir, 'logs'),
    },
    agentDir,
  });
});

test('Server configuration rejects invalid numeric values', () => {
  assert.throws(() => loadServerConfig({ NODE_ENV: 'preview' }), /NODE_ENV/);
  assert.throws(() => loadServerConfig({ LOG_LEVEL: 'verbose' }), /LOG_LEVEL/);
  assert.throws(() => loadServerConfig({ SERVER_FILE_LOG_ENABLED: 'sometimes' }), /SERVER_FILE_LOG_ENABLED/);
  assert.throws(() => loadServerConfig({ SERVER_FILE_LOG_LEVEL: 'verbose' }), /LOG_LEVEL/);
  assert.throws(
    () => loadServerConfig({ SERVER_FILE_LOG_MAX_SIZE_MB: '1025' }),
    /SERVER_FILE_LOG_MAX_SIZE_MB/
  );
  assert.throws(
    () => loadServerConfig({ SERVER_FILE_LOG_RETENTION_DAYS: '0' }),
    /SERVER_FILE_LOG_RETENTION_DAYS/
  );
  assert.throws(() => loadServerConfig({ SERVER_FILE_LOG_MAX_FILES: '1001' }), /SERVER_FILE_LOG_MAX_FILES/);
  assert.throws(() => loadServerConfig({ SERVER_FILE_LOG_MAX_FILES: '1' }), /SERVER_FILE_LOG_MAX_FILES/);
  assert.throws(
    () => loadServerConfig({ SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB: '102401' }),
    /SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB/
  );
  assert.throws(() => loadServerConfig({ SERVER_FILE_LOG_REQUIRED: 'true' }), /SERVER_FILE_LOG_REQUIRED/);
  assert.throws(
    () =>
      loadServerConfig({
        SERVER_FILE_LOG_ENABLED: 'true',
        SERVER_FILE_LOG_MAX_SIZE_MB: '100',
        SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB: '50',
      }),
    /SERVER_FILE_LOG_MAX_TOTAL_SIZE_MB/
  );
  assert.throws(() => loadServerConfig({ SERVER_PORT: '0' }), /SERVER_PORT/);
  assert.throws(() => loadServerConfig({ SERVER_PORT: '65536' }), /65535/);
  assert.throws(
    () => loadServerConfig({ SERVER_HTTP_BODY_LIMIT_BYTES: 'invalid' }),
    /SERVER_HTTP_BODY_LIMIT_BYTES/
  );
  assert.throws(() => loadServerConfig({ SERVER_DATA_DIR: 'relative-root' }), /SERVER_DATA_DIR/);
  assert.throws(
    () => loadServerConfig({ DR_OCTOPUS_CODING_AGENT_DIR: 'relative-agent' }),
    /DR_OCTOPUS_CODING_AGENT_DIR/
  );
  assert.throws(
    () => loadServerConfig({ SERVER_ATTACHMENT_LIMIT_BYTES: 'invalid' }),
    /SERVER_ATTACHMENT_LIMIT_BYTES/
  );
  assert.throws(() => loadServerConfig({ SERVER_MAX_ACTIVE_RUNTIMES: '0' }), /SERVER_MAX_ACTIVE_RUNTIMES/);
  assert.throws(
    () => loadServerConfig({ SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE: 'invalid' }),
    /SERVER_MAX_ACTIVE_RUNTIMES_PER_WORKSPACE/
  );
});

test('Server configuration exposes documented defaults', () => {
  const config = loadServerConfig({});
  assert.equal(config.environment, 'development');
  assert.equal(config.logLevel, 'info');
  assert.deepEqual(config.fileLogging, {
    enabled: false,
    level: 'info',
    maxSizeMb: 50,
    retentionDays: 14,
    maxFiles: 30,
    maxTotalSizeMb: 1024,
    required: false,
  });
  assert.equal(config.httpBodyLimitBytes, DEFAULT_HTTP_BODY_LIMIT_BYTES);
  assert.equal(DEFAULT_HTTP_BODY_LIMIT_BYTES, 140 * 1024 * 1024);
  assert.equal(config.maxActiveRuntimes, 9);
  assert.equal(config.maxActiveRuntimesPerWorkspace, 5);
  assert.equal(config.paths.dataDir, join(homedir(), '.dr-octopus', 'server'));
  assert.equal(config.paths.databasePath, join(homedir(), '.dr-octopus', 'server', 'octopus.db'));
  assert.equal(config.paths.logsRoot, join(homedir(), '.dr-octopus', 'server', 'logs'));
  assert.equal(config.agentDir, join(homedir(), '.dr-octopus', 'agent'));
});
