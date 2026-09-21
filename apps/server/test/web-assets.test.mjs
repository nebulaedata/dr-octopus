/**
 * @author Codex
 * @description Verifies scoped SPA navigation, static delivery, and preserved missing-route errors.
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerWebAssets } from '../dist/plugins/web-assets.plugin.js';

test('Web assets serve files without masking missing routes', async (t) => {
  const releaseRoot = await mkdtemp(join(tmpdir(), 'octopus-web-assets-'));
  const root = join(releaseRoot, 'apps/web/dist/client');
  const server = Fastify();
  t.after(async () => {
    await server.close();
    await rm(releaseRoot, { recursive: true, force: true });
  });
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(releaseRoot, 'apps/web/package.json'), '{"private":true}');
  await writeFile(
    join(root, '../vite.config.json'),
    JSON.stringify({
      root: '',
      base: '/',
      build: { assetsDir: 'assets', outDir: 'dist/client' },
      fastify: { outDirs: { client: 'dist/client' }, entryPaths: {} },
    })
  );
  await writeFile(join(root, 'index.html'), '<html>Octopus</html>');
  await writeFile(join(root, 'assets/app-abcdefgh.js'), 'console.log("ok")');
  server.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'original 404' }));
  server.register(async (scope) => {
    scope.get('/api/health', () => ({ status: 'ok' }));
    scope.get('/api/items/:id', (_request, reply) => reply.callNotFound());
    scope.get('/ws/existing', (_request, reply) => reply.code(426).send({ error: 'upgrade required' }));
  });
  server.register(async (scope) => registerWebAssets(scope, root));
  for (const method of ['GET', 'HEAD']) {
    for (const path of [
      '/',
      '/index.html',
      '/workspaces/example/sessions/42',
      '/settings/model-providers?provider=example.com',
      '/schedules/',
      '/unknown-page',
      '/apiary',
    ]) {
      const response = await server.inject({ method, url: path, headers: { accept: 'text/html' } });
      assert.equal(response.statusCode, 200, path);
      assert.match(response.headers['content-type'], /text\/html/);
      assert.equal(response.headers.location, undefined);
      assert.equal(response.body, method === 'GET' ? '<html>Octopus</html>' : '');
    }
  }
  for (const path of [
    '/api',
    '/api/missing',
    '/ws',
    '/ws/missing',
    '/assets/missing',
    '/missing.js',
    '/.env',
    '/server/dist/index.js',
    '/vite.config.json',
    '/assets',
    '/missing.css',
    '/favicon.ico',
    '/.git/config',
    '/%61pi/missing',
    '/ws%2Fmissing',
    '/%61ssets/missing',
    '/missing%2Ejs',
    '/%2Eenv',
  ]) {
    const response = await server.inject({ url: path, headers: { accept: 'text/html' } });
    assert.equal(response.statusCode, 404, path);
    assert.deepEqual(response.json(), { error: 'original 404' });
    const head = await server.inject({ method: 'HEAD', url: path, headers: { accept: 'text/html' } });
    assert.equal(head.statusCode, 404, path);
    assert.doesNotMatch(head.body, /<html>/);
  }
  for (const headers of [
    {},
    { accept: '*/*' },
    { accept: 'application/json' },
    { accept: 'text/html;q=0, */*;q=1' },
    { accept: 'text/html;q=invalid' },
    { accept: 'text/html', 'sec-fetch-dest': 'script' },
    { accept: 'text/html', 'sec-fetch-dest': 'empty' },
    { accept: 'text/html', upgrade: 'websocket' },
  ]) {
    const response = await server.inject({ url: '/schedules', headers });
    assert.equal(response.statusCode, 404, JSON.stringify(headers));
    assert.deepEqual(response.json(), { error: 'original 404' });
  }
  const navigation = await server.inject({
    url: '/schedules',
    headers: { accept: 'application/xhtml+xml, text/html;q=0.8, */*;q=0.5', 'sec-fetch-dest': 'document' },
  });
  assert.equal(navigation.statusCode, 200);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await server.inject({ method, url: '/schedules', headers: { accept: 'text/html' } });
    assert.equal(response.statusCode, 404, method);
    assert.deepEqual(response.json(), { error: 'original 404' });
  }
  assert.equal((await server.inject('/api/health')).json().status, 'ok');
  const missingItem = await server.inject({ url: '/api/items/42', headers: { accept: 'text/html' } });
  assert.equal(missingItem.statusCode, 404);
  assert.deepEqual(missingItem.json(), { error: 'original 404' });
  assert.equal(
    (await server.inject({ url: '/ws/existing', headers: { accept: 'text/html' } })).statusCode,
    426
  );
  const asset = await server.inject('/assets/app-abcdefgh.js');
  assert.equal(asset.statusCode, 200);
  assert.equal(asset.body, 'console.log("ok")');
});

test('Package-relative Vite configuration survives copying without a release rewrite', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'octopus moved web '));
  const target = join(temp, 'apps/web');
  const server = Fastify();
  t.after(async () => {
    await server.close();
    await rm(temp, { recursive: true, force: true });
  });
  await mkdir(target, { recursive: true });
  const source = join(temp, 'build-machine/apps/web');
  await mkdir(join(source, 'dist/client/assets'), { recursive: true });
  await writeFile(join(source, 'package.json'), '{"private":true}');
  await writeFile(join(source, 'dist/client/index.html'), '<html>Copied workspace</html>');
  const config = JSON.stringify({
    root: '',
    base: '/',
    build: { assetsDir: 'assets', outDir: 'dist\\client' },
    fastify: { outDirs: { client: 'dist\\client' }, entryPaths: {} },
  });
  await writeFile(join(source, 'dist/vite.config.json'), config);
  await cp(source, target, { recursive: true });
  await rm(join(temp, 'build-machine'), { recursive: true });
  await registerWebAssets(server, join(target, 'dist/client'));
  const response = await server.inject({ url: '/settings', headers: { accept: 'text/html' } });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<html/);
  assert.equal(await readFile(join(target, 'dist/vite.config.json'), 'utf8'), config);
});
