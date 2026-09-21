/**
 * @author Codex
 * @description Isolates the compiled Gateway discovery directory and replaces only its public Server dependency.
 */
import { mock } from 'node:test';
import os, { userInfo } from 'node:os';
import { appendFile, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:http';

const directory = process.env.OCTOPUS_TEST_HOME;
process.env.SERVER_DATA_DIR = directory;
const info = userInfo();
const piRoot = new URL('../../../server/node_modules/@earendil-works/pi-coding-agent/', import.meta.url);
const piManifest = JSON.parse(await readFile(new URL('package.json', piRoot), 'utf8'));
mock.module(new URL(piManifest.exports['.'].import, piRoot), {
  namedExports: { CONFIG_DIR_NAME: '.dr-octopus' },
});
mock.module('node:os', {
  namedExports: { ...os, userInfo: () => ({ ...info, homedir: directory }), homedir: () => directory },
});
mock.module('@octopus/server', {
  namedExports: {
    createServerRuntime(options) {
      let stopping = false;
      let http;
      return {
        async start() {
          await appendFile(`${directory}/events`, 'start\n');
          if (process.env.OCTOPUS_TEST_START === 'fail') throw new Error('fixture startup failed');
          while (process.env.OCTOPUS_TEST_START === 'pending' && !stopping) await delay(10);
          if (stopping) throw new Error('cancelled');
          if (process.env.OCTOPUS_TEST_START === 'restart') {
            http = createServer(async (_request, response) => {
              const accepted = await options.control.restart(
                {
                  revision: options.control.currentEnvironment.revision,
                  expectedServiceInstanceId: options.control.instanceId,
                },
                'gateway-restart'
              );
              response.once('finish', accepted.handoff);
              response.writeHead(202, { 'content-type': 'application/json' });
              response.end(JSON.stringify(accepted.operation));
            });
            await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
          }
        },
        async close() {
          if (stopping) return;
          stopping = true;
          if (http) await new Promise((resolve) => http.close(resolve));
          await appendFile(`${directory}/events`, 'close\n');
        },
        getStatus() {
          return {
            phase: 'extensions',
            address: http?.listening ? `http://127.0.0.1:${http.address().port}` : 'http://127.0.0.1:12345',
            dataDir: directory,
            fileLogging: { enabled: false, state: 'disabled', directory },
            warnings: ['fixture warning'],
          };
        },
      };
    },
  },
});
