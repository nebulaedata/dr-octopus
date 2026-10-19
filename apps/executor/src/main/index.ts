/**
 * @author Codex
 * @description Owns the executor window, tray, trusted UI protocol and independent Runtime shutdown.
 */
import { app, BrowserWindow, Menu, nativeTheme, net, protocol, session, Tray } from 'electron';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAbsolute, relative, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { executorProjectRoot } from './project-storage';
import { ComputerUseEscape } from './computer-use-escape';
import { ComputerUseIndicator } from './computer-use-indicator';
import { RuntimeManager } from './runtime-manager';
import { executionResourceRoot, resolveUiAsset } from './resource-paths';
import { registerDesktopIpc } from './desktop-ipc';
import { executorProduct } from '../contracts/product';
import { developmentRestartExitCode } from '../contracts/runtime';
import { RuntimeRecovery } from '../maintenance/runtime-recovery';
import { NativeFileCommit } from '../runtime/basic/native-file-commit';

app.setName(executorProduct.name);
nativeTheme.themeSource = 'system';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const testMode = !app.isPackaged && process.argv.includes('--executor-test');
const testData = process.argv
  .find((arg) => arg.startsWith('--executor-test-data='))
  ?.slice('--executor-test-data='.length);
if (testMode) {
  if (
    !testData ||
    !isAbsolute(testData) ||
    relative(tmpdir(), testData).startsWith('..') ||
    isAbsolute(relative(tmpdir(), testData))
  ) {
    throw new Error('Executor tests require an isolated temporary data directory.');
  }
  app.setPath('userData', testData);
}
const devMode = !app.isPackaged && process.argv.includes('--executor-dev');
const uiUrl = devMode ? 'http://127.0.0.1:5178/' : 'app://ui/index.html';
const uiOrigin = devMode ? 'http://127.0.0.1:5178' : 'app://ui';
const windows = new Set<BrowserWindow>();
const executionRoot = executionResourceRoot(app.isPackaged, process.resourcesPath, app.getAppPath());
const iconPath = resolve(executionRoot, 'assets/brand/app.ico');
const selectedData = app.commandLine.getSwitchValue('user-data-dir');
if (!testMode) {
  if (selectedData && !isAbsolute(selectedData)) {
    throw new Error('The explicit user data directory must be absolute.');
  }
  const runtimeData = selectedData || resolve(app.getPath('appData'), 'Octopus Executor');
  mkdirSync(runtimeData, { recursive: true });
  app.setPath('userData', runtimeData);
}
if (app.isPackaged) {
  app.setAppUserModelId('com.octopus.executor');
}
const runtime = new RuntimeManager(
  resolve(executionRoot, 'runtime/index.cjs'),
  app.getPath('userData'),
  resolve(executionRoot, 'native/file-commit.node'),
  testMode ? 0 : 19876,
  executorProjectRoot(homedir(), app.getPath('userData'), testMode || !!selectedData)
);
let tray: Tray | null = null;
let indicator: ComputerUseIndicator | null = null;
let computerEscape: ComputerUseEscape | null = null;
let unsubscribeIndicator: (() => void) | null = null;
let unregisterIpc: (() => void) | null = null;
let exiting = false;
let drained = false;
let restartRequested = false;
let recovery: RuntimeRecovery | null = null;

/**
 * Coalesces explicit restart requests and lets the existing bounded quit flow drain the Runtime first.
 */
function requestRestart(): boolean {
  if (exiting || restartRequested) {
    return false;
  }
  restartRequested = true;
  setImmediate(() => app.quit());
  return true;
}

/**
 * Allows only the owned application origin and document to enter a privileged window.
 */
function isUiNavigation(target: string): boolean {
  const url = new URL(target);
  const expected = new URL(uiUrl);
  return (
    url.protocol === expected.protocol &&
    url.host === expected.host &&
    url.pathname === expected.pathname &&
    !url.username &&
    !url.password &&
    !url.search
  );
}

/**
 * Matches the Renderer background and foreground tokens for native window surfaces.
 */
function windowThemeColors(): { color: string; symbolColor: string } {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#0a0a0a', symbolColor: '#fafafa' }
    : { color: '#ffffff', symbolColor: '#0a0a0a' };
}

/**
 * Activates or recreates the management window without restarting the Runtime.
 */
function openWindow(): BrowserWindow {
  const existing = [...windows].find((window) => !window.isDestroyed());
  if (existing) {
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.show();
    existing.focus();
    return existing;
  }
  const colors = windowThemeColors();
  const window = new BrowserWindow({
    title: `${executorProduct.name} v${executorProduct.version}`,
    icon: iconPath,
    width: 1040,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    show: false,
    backgroundColor: colors.color,
    titleBarStyle: 'hidden',
    // Let Windows size its native caption buttons independently of the padded page navigation.
    titleBarOverlay: colors,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  windows.add(window);
  /**
   * Refreshes the native caption and loading background when the effective theme changes.
   */
  const updateTheme = () => {
    const colors = windowThemeColors();
    window.setBackgroundColor(colors.color);
    window.setTitleBarOverlay(colors);
  };
  nativeTheme.on('updated', updateTheme);
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    if (!isUiNavigation(target)) {
      event.preventDefault();
    }
  });
  window.webContents.on('will-redirect', (event, target) => {
    if (!isUiNavigation(target)) {
      event.preventDefault();
    }
  });
  window.webContents.on('render-process-gone', () => {
    console.error('[executor] Management window exited unexpectedly.');
  });
  window.on('closed', () => {
    nativeTheme.removeListener('updated', updateTheme);
    windows.delete(window);
  });
  let handlingClose = false;
  window.on('close', (event) => {
    if (exiting) {
      return;
    }
    event.preventDefault();
    if (handlingClose) {
      return;
    }
    handlingClose = true;
    void runtime
      .readSettings()
      .then((settings) => {
        if (!exiting && !window.isDestroyed()) {
          const closeBehavior = settings.ok ? settings.data.closeBehavior : 'tray';
          if (closeBehavior === 'exit') {
            app.quit();
          } else if (closeBehavior === 'tray') {
            window.hide();
          } else {
            window.minimize();
          }
        }
      })
      .finally(() => {
        handlingClose = false;
      });
  });
  window.once('ready-to-show', () => {
    if (!testMode) {
      window.show();
    }
  });
  void window.loadURL(uiUrl).catch(() => {
    console.error('[executor] Management window could not load.');
  });
  return window;
}

/**
 * Ends only the observed local Computer activity; a missing Runtime falls back to the existing bounded application exit.
 */
function requestComputerStop(activityId: string, pid: number | null): void {
  const current = runtime.readStatus();
  if (
    exiting ||
    current.pid !== pid ||
    current.computerUse.activityId !== activityId ||
    current.computerUse.state === 'idle'
  ) {
    return;
  }
  if (
    current.capabilities.computer.state === 'failed' ||
    current.capabilities.computer.state === 'closed' ||
    !runtime.stopComputerUse(activityId, pid)
  ) {
    app.quit();
  }
}

/**
 * Creates an app-owned tray with reopen and explicit exit actions.
 */
function createTray(): Tray {
  const instance = new Tray(iconPath);
  instance.setToolTip(`${executorProduct.name} v${executorProduct.version}`);
  instance.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开执行器',
        click: () => {
          openWindow();
        },
      },
      {
        label: '停止桌面控制 (Esc)',
        click: () => {
          const current = runtime.readStatus();
          if (current.computerUse.activityId) {
            requestComputerStop(current.computerUse.activityId, current.pid);
          }
        },
      },
      { type: 'separator' },
      {
        label: '退出执行器',
        click: () => {
          app.quit();
        },
      },
    ])
  );
  instance.on('double-click', () => {
    openWindow();
  });
  return instance;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (app.isReady() && !exiting) {
      openWindow();
    }
  });
  app.on('activate', () => {
    if (app.isReady() && !exiting) {
      openWindow();
    }
  });
  // The tray and Runtime own application lifetime, not the management window.
  app.on('window-all-closed', () => {});
  app.on('before-quit', (event) => {
    if (drained) {
      return;
    }
    event.preventDefault();
    if (exiting) {
      return;
    }
    exiting = true;
    void Promise.resolve(recovery?.close())
      .then(() => runtime.stop())
      .then(() => {
        unsubscribeIndicator?.();
        computerEscape?.dispose();
        indicator?.dispose();
        unregisterIpc?.();
        tray?.destroy();
        drained = true;
        if (restartRequested && devMode) {
          app.exit(developmentRestartExitCode);
        } else {
          if (restartRequested) {
            app.relaunch();
          }
          app.quit();
        }
      })
      .catch(() => {
        console.error('[executor] Runtime exit was not confirmed; terminating the application.');
        computerEscape?.dispose();
        indicator?.dispose();
        app.exit(1);
      });
  });
  void app
    .whenReady()
    .then(async () => {
      const root = resolve(app.getAppPath(), 'dist/renderer');
      protocol.handle('app', async (request) => {
        try {
          if (request.method !== 'GET') {
            return new Response(null, { status: 405 });
          }
          const file = await resolveUiAsset(root, request.url);
          if (!file) {
            return new Response(null, { status: 404 });
          }
          const response = await net.fetch(pathToFileURL(file).href);
          const headers = new Headers(response.headers);
          headers.set(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'"
          );
          headers.set('X-Content-Type-Options', 'nosniff');
          return new Response(response.body, { status: response.status, headers });
        } catch {
          return new Response(null, { status: 404 });
        }
      });
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
        callback(false);
      });
      session.defaultSession.setPermissionCheckHandler(() => false);
      const overlayUrl = devMode
        ? 'http://127.0.0.1:5178/computer-use-overlay.html'
        : 'app://ui/computer-use-overlay.html';
      indicator = new ComputerUseIndicator(overlayUrl);
      try {
        computerEscape = ComputerUseEscape.open(
          resolve(executionRoot, 'native/computer-escape.node'),
          requestComputerStop
        );
      } catch {
        console.error('[executor] Escape stop helper unavailable; use the tray desktop-stop action.');
      }
      unsubscribeIndicator = runtime.subscribe((snapshot) => {
        indicator?.update(snapshot.computerUse);
        computerEscape?.update(snapshot);
      });
      recovery = new RuntimeRecovery(
        runtime,
        new NativeFileCommit(resolve(executionRoot, 'native/file-commit.node'))
      );
      unregisterIpc = registerDesktopIpc(runtime, windows, uiOrigin, !testMode, requestRestart, recovery);
      const settings = await runtime.readSettings();
      nativeTheme.themeSource = settings.ok ? settings.data.themeSource : 'system';
      tray = createTray();
      openWindow();
      await runtime.start().catch((error: unknown) => {
        console.error('[executor] Runtime could not become ready.');
        if (devMode && error instanceof Error) {
          console.error('[executor] Development startup:', error.message);
        }
      });
    })
    .catch(() => {
      console.error('[executor] Initialization failed.');
      app.quit();
    });
}
