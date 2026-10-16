/**
 * @author Codex
 * @description Checks actual Chrome/Edge build identities and finite page-control permissions and pinned license.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
test('Chrome and Edge MV3 outputs contain only finite Browser permissions and isolated page assets', async () => {
  for (const browser of ['chrome', 'edge']) {
    const directory = new URL(`../.output/${browser}-mv3/`, import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
    const build = JSON.parse(await readFile(new URL('browser-identity.json', directory), 'utf8'));
    const { identity } = build;
    assert.equal(build.extensionVersion, manifest.version);
    assert.equal(build.protocolVersion, 3);
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions.sort(), ['alarms', 'nativeMessaging', 'scripting', 'storage']);
    assert.equal(manifest.externally_connectable, undefined);
    assert.equal(manifest.action.default_popup, 'popup.html');
    assert.equal(manifest.action.default_title, 'Dr.Octopus 浏览器连接');
    await access(new URL(manifest.action.default_popup, directory));
    assert.deepEqual(manifest.action.default_icon, manifest.icons);
    for (const size of [16, 32, 48, 128]) {
      const icon = await readFile(new URL(manifest.icons[size], directory));
      assert.deepEqual(icon.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      assert.equal(icon.readUInt32BE(16), size);
      assert.equal(icon.readUInt32BE(20), size);
    }
    assert.deepEqual(manifest.host_permissions, ['<all_urls>']);
    assert.equal(manifest.content_scripts.length, 1);
    assert.equal(manifest.content_scripts[0].world, 'ISOLATED');
    assert.equal(manifest.content_scripts[0].all_frames, false);
    assert.ok(!JSON.stringify(manifest.content_security_policy ?? {}).includes('unsafe-eval'));
    for (const script of manifest.content_scripts[0].js) {
      await access(new URL(script, directory));
    }
    for (const file of await readdir(directory, { recursive: true })) {
      if (/\.(js|map)$/.test(file)) {
        const source = await readFile(new URL(file.replaceAll('\\', '/'), directory), 'utf8');
        assert.ok(
          !/\beval\s*\(|\bexecuteJavascript\b/.test(source),
          file + ' must not retain arbitrary script execution'
        );
      }
    }
    await access(new URL('licenses/page-controller-1.12.4.txt', directory));
    const notices = JSON.parse(
      await readFile(new URL('licenses/dependencies/inventory.json', directory), 'utf8')
    );
    for (const name of [
      'react',
      'react-dom',
      'lucide-react',
      '@base-ui/react',
      '@fontsource-variable/geist',
    ]) {
      assert.ok(
        notices.some((notice) => notice.name === name),
        `${name} notice must accompany the popup`
      );
    }
    if (build.profile === 'sideload') {
      const id = [
        ...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16),
      ]
        .map((byte) =>
          byte
            .toString(16)
            .padStart(2, '0')
            .replace(/[0-9a-f]/g, (value) => String.fromCharCode(97 + parseInt(value, 16)))
        )
        .join('');
      assert.equal(id, identity.sideloadExtensionId);
    } else {
      assert.equal(build.profile, 'store');
      assert.equal(manifest.key, undefined);
    }
    await access(new URL(manifest.background.service_worker, directory));
  }
});
