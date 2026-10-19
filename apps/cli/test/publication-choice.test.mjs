/**
 * @author Codex
 * @description Verifies publication choices and remote-state failures without contacting publishing services.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { CANCEL_SYMBOL } from '@clack/prompts';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  choosePublicationAction,
  chooseReleaseIncrements,
  confirmPublication,
} from '../../../scripts/publication-choice.mjs';
import { getGithubPublicationState } from '../../../scripts/github-publication-state.mjs';
import {
  assertPublicationArguments,
  createPublicationCommand,
  isInteractivePublication,
} from '../../../scripts/publication-options.mjs';
import { getNpmPublicationState } from '../../../scripts/npm-publication-state.mjs';

/**
 * Exercises Commander validation without exiting the test process or printing expected errors.
 */
function parseArgs(argv) {
  return createPublicationCommand()
    .exitOverride()
    .configureOutput({ writeErr: () => {} })
    .parse(argv, { from: 'user' })
    .opts();
}

test('only incomplete publications offer continuation, and npm success selects GitHub only', async () => {
  for (const [npm, github, expected] of [
    ['available', 'absent', 'resume'],
    ['available', 'published', 'resume'],
    ['published', 'absent', 'github-only'],
    ['published', 'draft', 'github-only'],
    ['published', 'published', 'bump'],
  ]) {
    const complete = npm === 'published' && github === 'published';
    const action = await choosePublicationAction(
      '0.0.9',
      { npm, github },
      {},
      {
        interactive: true,
        prompt: async ({ options }) => {
          assert.deepEqual(
            options.map(({ value }) => value),
            complete ? ['bump', 'cancel'] : [expected, 'bump', 'cancel']
          );
          return options[0].value;
        },
      }
    );
    assert.equal(action, expected);
    if (!complete) {
      assert.equal(
        await choosePublicationAction(
          '0.0.9',
          { npm, github },
          {},
          {
            interactive: true,
            prompt: async () => 'bump',
          }
        ),
        'bump'
      );
    }
  }
});

test('explicit resume never bumps a completed version and noninteractive invocation requires an action', async () => {
  const complete = { npm: 'published', github: 'published' };
  await assert.rejects(choosePublicationAction('0.0.9', complete, { resume: true }), /fully published/);
  assert.equal(await choosePublicationAction('0.0.9', complete, { githubOnly: true }), 'done');
  assert.equal(await choosePublicationAction('0.0.9', complete, { bump: true }), 'bump');
  const incomplete = { npm: 'available', github: 'absent' };
  assert.equal(await choosePublicationAction('0.0.9', incomplete, { resume: true }), 'resume');
  assert.equal(
    await choosePublicationAction('0.0.9', { npm: 'published', github: 'absent' }, { resume: true }),
    'github-only'
  );
  await assert.rejects(
    choosePublicationAction('0.0.9', incomplete, { githubOnly: true }),
    /before --github-only/
  );
  await assert.rejects(
    choosePublicationAction('0.0.9', incomplete, { yes: true }, { interactive: false }),
    /Choose --resume/
  );
});

test('Clack cancellation and the cancel option never select publication', async () => {
  for (const answer of [CANCEL_SYMBOL, 'cancel']) {
    assert.equal(
      await choosePublicationAction(
        '0.0.9',
        { npm: 'available', github: 'absent' },
        {},
        {
          interactive: true,
          prompt: async () => answer,
        }
      ),
      'cancel'
    );
  }
});

test('publication confirmation requires approval and handles Clack cancellation', async () => {
  const manifest = { name: 'fixture', version: '0.0.9' };
  for (const answer of [true, false, CANCEL_SYMBOL]) {
    assert.equal(
      await confirmPublication(
        manifest,
        { registry: 'https://registry.npmjs.org/' },
        {
          interactive: true,
          prompt: async ({ message, initialValue }) => {
            assert.match(message, /fixture@0.0.9/);
            assert.equal(initialValue, false);
            return answer;
          },
        }
      ),
      answer === true
    );
  }
  assert.equal(
    await confirmPublication(
      manifest,
      {},
      {
        githubOnly: true,
        interactive: true,
        prompt: async ({ message }) => {
          assert.match(message, /npm already published/);
          return true;
        },
      }
    ),
    true
  );
  await assert.rejects(confirmPublication(manifest, {}, { interactive: false }), /requires --yes/);
  for (const options of [{ yes: true }, { dryRun: true }]) {
    assert.equal(
      await confirmPublication(manifest, options, {
        interactive: false,
        prompt: async () => assert.fail('must not prompt'),
      }),
      true
    );
  }
});

test('publication flags reject conflicting actions, including destructive dry-run combinations', () => {
  assert.equal(parseArgs(['--resume', '--yes']).resume, true);
  for (const other of ['--bump', '--github-only', '--dry-run']) {
    assert.throws(() => parseArgs(['--resume', other]), /cannot be used with/);
  }
  assert.throws(() => parseArgs(['--bump', '--dry-run']), /cannot be used with/);
});

test('GitHub status is independent of local tags and only a release 404 counts as absence', async () => {
  for (const [response, expected] of [
    [{ status: 404 }, 'absent'],
    [{ ok: true, json: async () => ({ draft: false }) }, 'published'],
    [{ ok: true, json: async () => ({ draft: true }) }, 'draft'],
    [{ status: 403 }, /HTTP 403/],
    [{ status: 500 }, /HTTP 500/],
  ]) {
    const result = getGithubPublicationState('.', '0.0.9', {
      token: 'test-token',
      run: async (_command, args) => {
        assert.deepEqual(args, ['remote', 'get-url', 'origin']);
        return 'git@github.com:example/project.git';
      },
      request: async (url) =>
        url.includes('/releases/')
          ? response
          : {
              ok: true,
              json: async () => ({ permissions: { push: true } }),
            },
    });
    if (typeof expected === 'string') assert.equal(await result, expected);
    else await assert.rejects(result, expected);
  }
  await assert.rejects(
    getGithubPublicationState('.', '0.0.9', {
      token: 'test-token',
      run: async () => 'https://github.com/example/project.git',
      request: async () => ({ status: 404 }),
    }),
    /repository access failed/
  );
});

test('npm lookup treats only an explicit missing version as available', async () => {
  const lookup = (run) =>
    getNpmPublicationState(
      '.',
      { command: 'npm', args: [] },
      'https://registry.npmjs.org/',
      'fixture',
      '0.0.9',
      run
    );
  assert.equal(await lookup(async () => '0.0.9'), 'published');
  assert.equal(
    await lookup(async () => {
      throw new Error('npm error code E404');
    }),
    'available'
  );
  for (const message of ['E401', 'ETIMEDOUT', 'ECONNRESET']) {
    await assert.rejects(
      lookup(async () => {
        throw new Error(message);
      }),
      new RegExp(message)
    );
  }
  for (const output of ['', '0.0.8', 'unexpected E404 response']) {
    await assert.rejects(
      lookup(async () => output),
      /Unexpected npm version lookup result/
    );
  }
});

test('Commander validates option values and rejects unknown arguments', () => {
  const options = parseArgs(['--registry=https://example.com/npm/', '--otp', '123456', '--resume', '-y']);
  assert.equal(options.registry, 'https://example.com/npm/');
  assert.equal(options.otp, '123456');
  assert.equal(options.yes, true);
  assert.equal(parseArgs([]).registry, 'https://registry.npmjs.org/');
  for (const args of [
    ['--registry'],
    ['--otp'],
    ['--registry', 'https://'],
    ['--registry', 'file:///tmp'],
    ['--unknown'],
    ['unexpected'],
  ]) {
    assert.throws(
      () => parseArgs(args),
      (error) => error.code.startsWith('commander.')
    );
  }
});

test('CLI help and invalid arguments exit before loading publication credentials', () => {
  const script = fileURLToPath(new URL('../../../scripts/publish-release.mjs', import.meta.url));
  const output = execFileSync(process.execPath, ['--import', 'tsx', script, '--help'], { encoding: 'utf8' });
  assert.match(output, /Usage: publish-release.mjs/);
  assert.match(output, /--resume/);
  assert.match(output, /--executor-increment/);
  assert.throws(
    () =>
      execFileSync(process.execPath, ['--import', 'tsx', script, '--resume', '--bump'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (error) => error.status === 1 && /cannot be used with/.test(error.stderr)
  );
});

test('CI arguments require an explicit action and both increments without opening any prompts', async () => {
  const options = parseArgs(['--bump', '--increment', 'patch', '--executor-increment', 'minor', '--ci']);
  assert.equal(options.yes, true);
  assertPublicationArguments(options, { interactive: false });
  assert.deepEqual(
    await chooseReleaseIncrements(options, {
      interactive: false,
      prompt: async () => assert.fail('must not prompt'),
    }),
    {
      increment: 'patch',
      executorIncrement: 'minor',
    }
  );
  for (const args of [
    ['--bump', '--ci'],
    ['--bump', '--increment', 'patch', '--yes'],
    ['--executor-increment', 'patch', '--ci'],
  ]) {
    assert.throws(() => assertPublicationArguments(parseArgs(args), { interactive: false }), /requires both/);
  }
  assert.throws(
    () => assertPublicationArguments(parseArgs(['--yes']), { interactive: false }),
    /Choose --resume/
  );
  assert.throws(
    () => assertPublicationArguments(parseArgs(['--resume']), { interactive: false }),
    /requires --yes or --ci/
  );
  for (const action of ['--resume', '--github-only']) {
    assertPublicationArguments(parseArgs([action, '--ci']), { interactive: false });
    for (const increment of ['--increment', '--executor-increment']) {
      assert.throws(() => parseArgs([action, increment, 'patch']), /cannot be used with/);
    }
  }
  for (const value of ['keep', '1.2.3', 'prerelease', 'PATCH', 'patch;echo secret']) {
    assert.throws(() => parseArgs(['--executor-increment', value]), /invalid/);
  }
});

test('interactive increments default to patch, and cancellation prevents a version plan', async () => {
  const calls = [];
  assert.deepEqual(
    await chooseReleaseIncrements(
      {},
      {
        interactive: true,
        prompt: async ({ message, initialValue }) => {
          calls.push(message);
          assert.equal(initialValue, 'patch');
          return calls.length === 1 ? 'minor' : 'major';
        },
      }
    ),
    { increment: 'minor', executorIncrement: 'major' }
  );
  assert.equal(calls.length, 2);
  assert.equal(
    await chooseReleaseIncrements(
      { increment: 'patch' },
      { interactive: true, prompt: async () => CANCEL_SYMBOL }
    ),
    null
  );
});

test('CI and yes flags suppress prompts even with an allocated terminal', () => {
  assert.equal(isInteractivePublication({}, { terminal: true, environment: {} }), true);
  for (const options of [{ ci: true }, { yes: true }]) {
    assert.equal(isInteractivePublication(options, { terminal: true, environment: {} }), false);
  }
  for (const environment of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
    assert.equal(isInteractivePublication({}, { terminal: true, environment }), false);
  }
  assert.equal(isInteractivePublication({}, { terminal: true, environment: { CI: 'false' } }), true);
});

test('incomplete noninteractive version selection exits before npm or GitHub authentication', () => {
  const script = fileURLToPath(new URL('../../../scripts/publish-release.mjs', import.meta.url));
  assert.throws(
    () =>
      execFileSync(process.execPath, ['--import', 'tsx', script, '--bump', '--ci'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (error) =>
      error.status === 1 &&
      /requires both --increment and --executor-increment/.test(error.stderr) &&
      !/Authenticated|npm whoami|Not authenticated/.test(error.stderr)
  );
});
