/**
 * @author Codex
 * @description Verifies file tree retries retain pending feedback and recover from root loading failures.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';

test('root retries prevent duplicate requests and clear stale errors after success', async (t) => {
  let resolveRequest;
  let rejectRequest;
  const request = t.mock.method(
    axios.Axios.prototype,
    'request',
    () =>
      new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      })
  );
  const { useFileExplorerStore } = await import('../src/stores/file-explorer/store.ts');
  useFileExplorerStore.setState({ workspaces: {} });
  t.after(() => useFileExplorerStore.setState({ workspaces: {} }));
  const { loadRoot } = useFileExplorerStore.getState();
  const workspace = () => useFileExplorerStore.getState().workspaces['retry-test'];

  const first = loadRoot('retry-test');
  rejectRequest(new Error('timeout of 20000ms exceeded'));
  await first;
  assert.equal(workspace().rootLoaded, false);
  assert.equal(workspace().rootLoading, false);
  assert.match(workspace().rootError, /timeout/);

  const retry = loadRoot('retry-test');
  assert.equal(workspace().rootLoading, true);
  assert.match(workspace().rootError, /timeout/);
  await loadRoot('retry-test');
  assert.equal(request.mock.callCount(), 2);
  rejectRequest(new Error('Connection unavailable'));
  await retry;
  assert.equal(workspace().rootLoading, false);
  assert.equal(workspace().rootError, 'Connection unavailable');

  const recovery = loadRoot('retry-test');
  resolveRequest({ data: { entries: [] } });
  await recovery;
  assert.equal(workspace().rootLoaded, true);
  assert.equal(workspace().rootLoading, false);
  assert.equal(workspace().rootError, undefined);
  assert.deepEqual(workspace().rootPaths, []);
  await loadRoot('retry-test');
  assert.equal(request.mock.callCount(), 3);

  const { refreshAll, expandDirectory, setExpanded } = useFileExplorerStore.getState();
  const rootEntries = [{ name: 'src', path: 'src', type: 'directory' }];
  const fresh = refreshAll('retry-test');
  resolveRequest({ data: { entries: rootEntries } });
  await fresh;
  assert.deepEqual(request.mock.calls.at(-1).arguments[0].params, { path: '' });
  assert.equal(workspace().nodesByPath.src.loaded, false);
  assert.equal(workspace().nodesByPath.src.childPaths, undefined);

  const childLoad = expandDirectory('retry-test', 'src');
  const callsWhileLoading = request.mock.callCount();
  await expandDirectory('retry-test', 'src');
  assert.equal(request.mock.callCount(), callsWhileLoading);
  assert.deepEqual(request.mock.calls.at(-1).arguments[0].params, { path: 'src' });
  rejectRequest(new Error('Child timeout'));
  await childLoad;
  assert.equal(workspace().rootError, undefined);
  assert.equal(workspace().nodesByPath.src.error, 'Child timeout');
  const childRetry = expandDirectory('retry-test', 'src');
  resolveRequest({ data: { entries: [] } });
  await childRetry;
  assert.equal(workspace().nodesByPath.src.error, undefined);
  assert.deepEqual(workspace().nodesByPath.src.childPaths, []);
  const cachedCalls = request.mock.callCount();
  await expandDirectory('retry-test', 'src');
  assert.equal(request.mock.callCount(), cachedCalls);

  setExpanded('retry-test', 'src', true);
  const reload = refreshAll('retry-test');
  resolveRequest({ data: { entries: rootEntries } });
  await reload;
  assert.equal(request.mock.callCount(), cachedCalls + 1);
  assert.deepEqual(workspace().expandedPaths, {});

  const staleChild = expandDirectory('retry-test', 'src');
  const resolveStaleChild = resolveRequest;
  const nextRoot = refreshAll('retry-test');
  resolveRequest({ data: { entries: rootEntries } });
  await nextRoot;
  resolveStaleChild({ data: { entries: [{ name: 'old.ts', path: 'src/old.ts', type: 'file' }] } });
  await staleChild;
  assert.equal(workspace().nodesByPath['src/old.ts'], undefined);
  assert.equal(workspace().nodesByPath.src.loaded, false);

  const staleRoot = refreshAll('retry-test');
  const rejectStaleRoot = rejectRequest;
  const latestRoot = refreshAll('retry-test');
  resolveRequest({ data: { entries: rootEntries } });
  await latestRoot;
  rejectStaleRoot(new Error('Stale root error'));
  await staleRoot;
  assert.equal(workspace().rootError, undefined);
  assert.deepEqual(workspace().rootPaths, ['src']);
});
