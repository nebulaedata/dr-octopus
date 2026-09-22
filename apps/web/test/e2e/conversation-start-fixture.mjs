/**
 * @author Codex
 * @description Shares controlled startup receipts, catalog publication and event notifications for browser regressions.
 */
import { expect } from '@playwright/test';
import { installSessionFixture } from './session-fixture.mjs';

/**
 * Holds catalog publication independently of the receipt to exercise cold-start route boundaries.
 */
export async function installStartFixture(page, initialMessages = []) {
  await installSessionFixture(page, { initialMessages });
  await page.addInitScript(() => {
    globalThis.EventSource = class extends EventTarget {
      constructor() {
        super();
        globalThis.fixtureEvents = this;
      }
      close() {}
    };
  });
  const state = {
    result: undefined,
    reads: 0,
    posts: [],
    published: false,
    bootstraps: 0,
    cancelStatus: 'cancelled',
  };
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/bootstrap')) state.bootstraps++;
  });
  await page.route('**/api/conversation-models', (route) =>
    route.fulfill({
      json: {
        models: [{ provider: 'p', id: 'm', name: 'Model', reasoning: false, input: ['text'] }],
        defaults: {
          configured: true,
          available: true,
          providerId: 'p',
          modelId: 'm',
          effect: 'new_sessions',
        },
      },
    })
  );
  await page.route('**/api/workspaces/*/sessions', (route) =>
    state.published ? route.fallback() : route.fulfill({ json: [] })
  );
  await page.route('**/api/workspaces/*/conversation-starts**', (route) => {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      state.posts.push(input);
      state.result = {
        submissionId: input.submissionId,
        sessionId: 'session-e2e',
        message: input.message,
        draft: input,
        status: 'preparing',
      };
    } else if (route.request().method() === 'DELETE') {
      state.result.status = state.cancelStatus;
    }
    return state.result
      ? route.fulfill({ json: state.result })
      : route.fulfill({ status: 404, json: { message: 'Not found' } });
  });
  await page.route('**/api/workspaces/*/sessions/*/start-receipt', (route) => {
    state.reads++;
    return route.fulfill({ json: state.result ?? null });
  });
  return state;
}

/**
 * Pushes the same invalidation hints as the shared server event stream.
 */
export async function notifyStart(page, name = 'change', resource = 'conversation-starts') {
  await page.evaluate(
    ({ name, resource }) =>
      globalThis.fixtureEvents.dispatchEvent(
        new MessageEvent(name, {
          data: JSON.stringify({ resource, workspaceId: 'workspace-e2e' }),
        })
      ),
    { name, resource }
  );
}

/**
 * Submits using the real editor and waits only for HTTP admission, not Agent preparation.
 */
export async function submitStart(page, message, baseURL) {
  await page.goto(new URL('/workspaces/workspace-e2e', baseURL).href);
  await expect(page.getByRole('button', { name: 'Model and thinking settings' })).toHaveAttribute(
    'title',
    'Model'
  );
  const editor = page.getByRole('textbox', { name: 'Message Dr.Octopus' });
  await editor.fill(message);
  await editor.press('Enter');
  await expect(page).toHaveURL(/sessions\/session-e2e/);
  await expect(page.getByText('Preparing your conversation…', { exact: true })).toBeVisible();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Dr.Octopus' })).toBeEditable();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
}
