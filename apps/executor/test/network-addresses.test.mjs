/**
 * @author Codex
 * @description Covers private IPv4 discovery, duplicate interface labels and bounded credential-free projections.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { listNetworkAddresses } from '../src/main/network-addresses.ts';
import { networkAddressesResponseSchema } from '../src/contracts/connection-settings.ts';

test('discovery excludes public, loopback, link-local and IPv6 addresses and keeps explicit private/VPN ranges', () => {
  const snapshot = {
    Ethernet: [
      { address: '192.168.14.100', family: 'IPv4', internal: false, mac: 'secret-mac' },
      { address: '8.8.8.8', family: 'IPv4', internal: false },
      { address: '::1', family: 'IPv6', internal: false },
      { address: '127.0.0.1', family: 'IPv4', internal: true },
      { address: '169.254.1.2', family: 'IPv4', internal: false },
      { address: '198.18.0.1', family: 'IPv4', internal: false },
      { address: '0.0.0.0', family: 'IPv4', internal: false },
    ],
    VPN: [
      { address: '100.64.1.2', family: 'IPv4', internal: false },
      { address: '10.116.0.11', family: 'IPv4', internal: false },
      { address: '172.16.1.2', family: 'IPv4', internal: false },
      { address: '172.32.1.2', family: 'IPv4', internal: false },
    ],
    Disconnected: undefined,
  };
  const original = structuredClone(snapshot);
  const choices = listNetworkAddresses(snapshot);
  assert.deepEqual(
    choices.map((item) => item.address),
    ['10.116.0.11', '100.64.1.2', '172.16.1.2', '192.168.14.100']
  );
  assert.deepEqual(snapshot, original);
  assert.ok(!JSON.stringify(choices).includes('secret-mac'));
  assert.equal(networkAddressesResponseSchema.safeParse({ ok: true, data: choices }).success, true);
});

test('shared addresses retain sorted interface names and stable numeric address order without duplicate options', () => {
  const choices = listNetworkAddresses({
    WLAN: [{ address: '192.168.1.2', family: 'IPv4', internal: false }],
    Ethernet: [
      { address: '192.168.1.10', family: 'IPv4', internal: false },
      { address: '192.168.1.2', family: 'IPv4', internal: false },
      { address: '192.168.1.2', family: 'IPv4', internal: false },
    ],
  });
  assert.deepEqual(choices, [
    { address: '192.168.1.2', interfaceName: 'Ethernet / WLAN' },
    { address: '192.168.1.10', interfaceName: 'Ethernet' },
  ]);
  assert.deepEqual(listNetworkAddresses({}), []);
});

test('network discovery response rejects expanded fields, public addresses and oversized lists', () => {
  const choice = { address: '192.168.1.2', interfaceName: 'Ethernet' };
  for (const data of [
    [{ ...choice, mac: 'secret' }],
    [{ ...choice, address: '8.8.8.8' }],
    Array(257).fill(choice),
  ]) {
    assert.equal(networkAddressesResponseSchema.safeParse({ ok: true, data }).success, false);
  }
});
