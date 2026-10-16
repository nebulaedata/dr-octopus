/**
 * @author Codex
 * @description Builds finite page-control Chrome and Edge MV3 bundles with a stable explicit extension identity.
 */
import { defineConfig } from 'wxt';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadBrowserExtensionBuild } from './scripts/lib/browser-identity.mjs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const extensionIcons = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};
const browserBuild = loadBrowserExtensionBuild();
export default defineConfig({
  manifestVersion: 3,
  hooks: {
    /**
     * Records validated public identity alongside each independently distributable target.
     */
    'build:done': async (wxt) => {
      await writeFile(
        join(wxt.config.outDir, 'browser-identity.json'),
        JSON.stringify(browserBuild, null, 2)
      );
    },
  },
  /**
   * Configures UI compilation; dependency changes are applied by pnpm before the build.
   */
  vite: () => ({
    plugins: [react(), tailwindcss()],
  }),
  manifest: {
    name: 'Octopus Browser Bridge',
    description: 'Connects the browser to the local Octopus Executor.',
    ...(browserBuild.profile === 'sideload' ? { key: browserBuild.identity.sideloadPublicKey } : {}),
    icons: extensionIcons,
    // captureVisibleTab requires <all_urls>; runtime routing still admits only permission-checked HTTP/HTTPS pages.
    host_permissions: ['<all_urls>'],
    // Arbitrary scripts are disabled. pnpm patch removes PageController.executeJavascript from shipped code;
    // see patches/@page-agent__page-controller@1.12.4.patch. No debugger/userScripts or unsafe-eval is enabled.
    permissions: ['nativeMessaging', 'storage', 'alarms', 'scripting'],
    action: { default_title: 'Dr.Octopus 浏览器连接', default_icon: extensionIcons },
  },
});
