/**
 * @author Codex
 * @description Loads the dev extension into an owned installed-browser Profile using a private debugging pipe, and closes only that browser.
 */
import { join } from 'node:path';
import { access } from 'node:fs/promises';

/**
 * Implements WXT's finite runner contract without changing ordinary browser profiles or adding a persistent broker.
 */
export function developmentBrowserRunner(wxt, profile) {
  let context;
  return {
    /**
     * Reports only supported development targets.
     */
    canOpen() {
      return ['chrome', 'edge'].includes(wxt.config.browser);
    },
    /**
     * Uses the existing pinned Playwright dependency solely to load the unpacked development extension.
     */
    async openBrowser() {
      const flavor = wxt.config.browser;
      if (!['chrome', 'edge'].includes(flavor)) {
        throw new Error('Development supports Chrome and Edge only.');
      }
      const programFiles = flavor === 'chrome' ? process.env.ProgramFiles : process.env['ProgramFiles(x86)'];
      if (!programFiles) {
        throw new Error('Windows browser installation directory is unavailable.');
      }
      const executablePath = join(
        programFiles,
        flavor === 'chrome' ? 'Google/Chrome/Application/chrome.exe' : 'Microsoft/Edge/Application/msedge.exe'
      );
      await access(executablePath);
      const { chromium } = await import('@playwright/test');
      context = await chromium.launchPersistentContext(join(profile, flavor), {
        executablePath,
        headless: false,
        chromiumSandbox: true,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'],
      });
      try {
        const cdp = await context.browser().newBrowserCDPSession();
        const installed = await cdp.send('Extensions.loadUnpacked', { path: wxt.config.outDir });
        await cdp.detach();
        wxt.logger.info(`Development extension ${installed.id}; isolated Profile ${join(profile, flavor)}`);
      } catch (error) {
        await context.close();
        context = undefined;
        throw error;
      }
    },
    /**
     * Closes the owned context and debugging pipe; ordinary browser windows are outside this runner.
     */
    async closeBrowser() {
      await context?.close();
      context = undefined;
    },
  };
}
