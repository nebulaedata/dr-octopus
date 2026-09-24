/**
 * @author Codex
 * @description Verifies realtime reconnection remains bounded across rejected and policy-closed WebSocket connections.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

test('refresh keeps desired subscription and rejects old ACKs until the new generation is confirmed', async () => {
  const fixture = await createBrowserFixture();
  try {
    const client = new fixture.RealtimeClient();
    client.connect();
    const socket = fixture.sockets[0];
    socket.open();
    client.subscribeSession('session');
    const first = socket.sent.at(-1);
    const old = {
      runtimeId: 'old',
      epoch: 1,
      sessionId: 'session',
      workspaceId: 'workspace',
      state: 'idle',
      lastActiveAt: 0,
    };
    socket.message({
      type: 'session.subscribed',
      requestId: first.requestId,
      sessionId: 'session',
      runtime: old,
    });
    client.refreshSessionSubscription('session');
    const unsubscribe = socket.sent.findLast((command) => command.type === 'session.unsubscribe');
    client.refreshSessionSubscription('session');
    assert.equal(client.getConfirmedSubscription('session'), undefined);
    assert.equal(client.hasSessionSubscription('session'), true);
    socket.message({
      type: 'session.subscribed',
      requestId: first.requestId,
      sessionId: 'session',
      runtime: old,
    });
    assert.equal(client.getConfirmedSubscription('session'), undefined);
    socket.message({ type: 'session.unsubscribed', requestId: unsubscribe.requestId, sessionId: 'session' });
    const subscribe = socket.sent.at(-1);
    assert.equal(subscribe.type, 'session.subscribe');
    socket.message({
      type: 'session.subscribed',
      requestId: subscribe.requestId,
      sessionId: 'session',
      runtime: { ...old, runtimeId: 'new', epoch: 2 },
    });
    assert.equal(client.getConfirmedSubscription('session').runtimeId, 'new');
    assert.equal(client.needsSubscriptionRefresh('session', old), false);
    client.refreshSessionSubscription('session');
    const interrupted = socket.sent.findLast((command) => command.type === 'session.unsubscribe');
    socket.message({ type: 'error', requestId: interrupted.requestId, code: 'TEMPORARY', message: 'Retry' });
    assert.equal(client.needsSubscriptionRefresh('session', { ...old, runtimeId: 'new', epoch: 2 }), true);
    client.disconnect();
  } finally {
    fixture.restore();
  }
});

test('RealtimeClient bounds connections that open and close before a server message', async () => {
  const fixture = await createBrowserFixture();
  try {
    const client = new fixture.RealtimeClient();
    client.connect();

    while (client.getState() !== 'failed') {
      const socket = fixture.sockets.at(-1);
      socket.open();
      socket.close(1006, 'Connection lost');
      fixture.runNextTimer();
    }

    assert.equal(fixture.sockets.length, fixture.maxAttempts + 1);
    assert.equal(fixture.pendingTimerCount(), 0);
  } finally {
    fixture.restore();
  }
});

test('RealtimeClient does not retry a policy-closed connection', async () => {
  const fixture = await createBrowserFixture();
  try {
    const client = new fixture.RealtimeClient();
    client.connect();
    fixture.sockets[0].open();
    fixture.sockets[0].close(1008, 'Origin is not allowed');

    assert.equal(client.getState(), 'failed');
    assert.equal(fixture.pendingTimerCount(), 0);
    assert.equal(fixture.sockets.length, 1);
  } finally {
    fixture.restore();
  }
});

/**
 * Installs deterministic browser and WebSocket doubles before loading the client Module.
 *
 * @returns {Promise<object>} Controllable realtime test fixture.
 */
async function createBrowserFixture() {
  const previousWindow = global.window;
  const previousWebSocket = global.WebSocket;
  const sockets = [];
  const timers = new Map();
  let nextTimerId = 1;

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    readyState = FakeWebSocket.CONNECTING;
    sent = [];
    #listeners = new Map();

    /**
     * Records a transport created by the client.
     */
    constructor() {
      sockets.push(this);
    }

    /**
     * Registers one transport event listener.
     *
     * @param {string} type Event name.
     * @param {Function} listener Event listener.
     */
    addEventListener(type, listener) {
      const listeners = this.#listeners.get(type) ?? [];
      listeners.push(listener);
      this.#listeners.set(type, listeners);
    }

    /**
     * Simulates a successful WebSocket handshake.
     */
    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.#emit('open', {});
    }

    /**
     * Simulates a WebSocket close frame or abnormal transport loss.
     *
     * @param {number} code Close status code.
     * @param {string} reason Close reason.
     */
    close(code = 1000, reason = '') {
      if (this.readyState === FakeWebSocket.CLOSED) {
        return;
      }
      this.readyState = FakeWebSocket.CLOSED;
      this.#emit('close', { code, reason });
    }

    /**
     * Accepts client messages without coupling reconnection tests to protocol assertions.
     */
    send(data) {
      this.sent.push(JSON.parse(data));
    }

    /**
     * Delivers a server acknowledgement on the test transport.
     */
    message(data) {
      this.#emit('message', { data: JSON.stringify(data) });
    }

    /**
     * Publishes one fake transport event.
     *
     * @param {string} type Event name.
     * @param {object} event Event payload.
     */
    #emit(type, event) {
      for (const listener of this.#listeners.get(type) ?? []) {
        listener(event);
      }
    }
  }

  global.window = {
    location: { protocol: 'http:', host: 'localhost:5173' },
    setTimeout(callback) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  global.WebSocket = FakeWebSocket;

  const module = await import("../src/lib/runtime/realtime-client.ts");
  return {
    RealtimeClient: module.RealtimeClient,
    maxAttempts: module.MAX_REALTIME_RECONNECT_ATTEMPTS,
    sockets,
    pendingTimerCount: () => timers.size,
    runNextTimer() {
      const entry = timers.entries().next().value;
      if (entry === undefined) {
        return;
      }
      const [id, callback] = entry;
      timers.delete(id);
      callback();
    },
    restore() {
      global.window = previousWindow;
      global.WebSocket = previousWebSocket;
    },
  };
}

test('focus follows confirmed route subscriptions, blur and reconnect without restoring stale focus', async () => {
  const fixture = await createBrowserFixture();
  try {
    const client = new fixture.RealtimeClient();
    client.setFocusedSession('a');
    client.subscribeSession('a');
    client.subscribeSession('b');
    client.connect();
    const socket = fixture.sockets.at(-1);
    socket.open();
    assert.equal(
      socket.sent.some((message) => message.type === 'session.focus'),
      false
    );
    socket.message({ type: 'session.subscribed', sessionId: 'a', runtime: { sessionId: 'a' } });
    assert.equal(socket.sent.at(-1).sessionId, 'a');
    assert.equal(socket.sent.at(-1).type, 'session.focus');
    client.setFocusedSession('b');
    assert.equal(socket.sent.at(-1).sessionId, null);
    socket.message({ type: 'session.subscribed', sessionId: 'b', runtime: { sessionId: 'b' } });
    assert.equal(socket.sent.at(-1).sessionId, 'b');
    client.setFocusedSession(null);
    assert.equal(socket.sent.at(-1).sessionId, null);
    client.setFocusedSession('b');
    socket.close(1006);
    client.setFocusedSession('a');
    fixture.runNextTimer();
    const reconnected = fixture.sockets.at(-1);
    reconnected.open();
    reconnected.message({ type: 'session.subscribed', sessionId: 'b', runtime: { sessionId: 'b' } });
    assert.equal(reconnected.sent.at(-1).sessionId, null);
    reconnected.message({ type: 'session.subscribed', sessionId: 'a', runtime: { sessionId: 'a' } });
    assert.equal(reconnected.sent.at(-1).sessionId, 'a');
    client.unsubscribeSession('a');
    assert.equal(reconnected.sent.at(-2).type, 'session.focus');
    assert.equal(reconnected.sent.at(-2).sessionId, null);
    client.disconnect();
  } finally {
    fixture.restore();
  }
});
