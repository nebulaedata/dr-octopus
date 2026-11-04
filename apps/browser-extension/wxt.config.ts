/**
 * @author Codex
 * @description Builds finite page-control Chrome and Edge MV3 bundles with a stable explicit extension identity.
 */
import { browserDevelopment } from '../../scripts/browser-development.mjs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { defineConfig } from 'wxt';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadBrowserExtensionBuild } from './scripts/lib/browser-identity.mjs';
import { developmentBrowserRunner } from './scripts/lib/development-browser.mjs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const extensionIcons = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};
const browserBuild = loadBrowserExtensionBuild();
let compiledBuild = browserBuild;
const development = browserDevelopment(fileURLToPath(new URL('../../', import.meta.url)));
export default defineConfig({
  manifestVersion: 3,
  dev: { server: { host: '127.0.0.1', port: development.extensionPort, strictPort: true } },
  webExt: { chromiumProfile: development.profile, keepProfileChanges: true },
  hooks: {
    /**
     * Uses an isolated installed-browser runner only for development; release artifacts contain no debugging switch.
     */
    'config:resolved': (wxt) => {
      if (wxt.config.command === 'serve') {
        wxt.config.runner = developmentBrowserRunner(wxt, development.profile);
      }
    },
    /**
     * Records validated public identity alongside each independently distributable target.
     */
    'build:done': async (wxt) => {
      await writeFile(
        join(wxt.config.outDir, 'browser-identity.json'),
        JSON.stringify(compiledBuild, null, 2)
      );
    },
  },
  /**
   * Configures UI compilation; dependency changes are applied by pnpm before the build.
   */
  vite: (env) => {
    const hostName = env.command === 'serve' ? development.hostName : 'com.octopus.executor.browser';
    const profile = env.command === 'serve' ? 'sideload' : browserBuild.profile;
    compiledBuild = {
      ...browserBuild,
      profile,
      extensionBuildId: createHash('sha256')
        .update(
          JSON.stringify({
            source: browserBuild.extensionBuildId,
            hostName,
            browser: env.browser,
            profile,
            identity: browserBuild.identity.fingerprint,
          })
        )
        .digest('hex'),
    };
    return {
      define: {
        __OCTOPUS_EXTENSION_BUILD_ID__: JSON.stringify(compiledBuild.extensionBuildId),
        __OCTOPUS_BROWSER_HOST__: JSON.stringify(hostName),
      },
      plugins: [react(), tailwindcss()],
    };
  },
  manifest: (env) => ({
    name: 'Octopus Browser Bridge',
    description: 'Connects the browser to the local Octopus Executor.',
    ...(env.command === 'serve' || browserBuild.profile === 'sideload'
      ? { key: browserBuild.identity.sideloadPublicKey }
      : {}),
    icons: extensionIcons,
    // captureVisibleTab requires <all_urls>; runtime routing still admits only permission-checked HTTP/HTTPS pages.
    host_permissions: ['<all_urls>'],
    // Arbitrary scripts are disabled. pnpm patch removes PageController.executeJavascript from shipped code;
    // see patches/@page-agent__page-controller@1.12.4.patch. No debugger/userScripts or unsafe-eval is enabled.
    permissions: ['nativeMessaging', 'storage', 'alarms', 'scripting', 'webNavigation', 'sidePanel'],
    side_panel: { default_path: 'window-panel.html' },
    action: { default_title: 'Dr.Octopus 浏览器连接', default_icon: extensionIcons },
  }),
});
