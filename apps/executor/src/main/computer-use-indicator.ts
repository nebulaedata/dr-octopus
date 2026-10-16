/**
 * @author Codex
 * @description Owns mouse-transparent, non-focusable display-edge feedback for actual local Computer activity.
 */
import { BrowserWindow, screen } from 'electron';
import type { ComputerUseSnapshot } from '../contracts/computer-use';

export class ComputerUseIndicator {
  private windows = new Map<number, BrowserWindow>();
  private state: ComputerUseSnapshot['state'] = 'idle';
  private disposed = false;
  private revision = 0;
  private readonly loading = new Map<number, Promise<void>>();

  /**
   * Binds a fixed trusted overlay document; no preload or Renderer input can activate the indicator.
   */
  constructor(private readonly documentUrl: string) {
    screen.on('display-added', this.reconcile);
    screen.on('display-removed', this.reconcile);
    screen.on('display-metrics-changed', this.reconcile);
  }

  /**
   * Displays actual activity on this machine regardless of where the calling agent runs.
   */
  update(activity: ComputerUseSnapshot): void {
    if (this.disposed) {
      return;
    }
    const next = activity.state;
    this.revision = activity.revision;
    const changed = next !== this.state;
    this.state = next;
    this.reconcile();
    if (changed && next !== 'idle') {
      for (const [id, window] of this.windows) {
        const pending = this.loading.get(id) ?? Promise.resolve();
        this.loading.set(
          id,
          pending.then(() => this.updateDocument(window))
        );
      }
    }
  }

  /**
   * Updates only the fixed read-only state fragment, keeping native windows and animation alive across state changes.
   */
  private async updateDocument(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed() || this.disposed || this.state === 'idle') {
      return;
    }
    try {
      await window.webContents.executeJavaScript(`location.hash = ${JSON.stringify('#' + this.state)}`);
    } catch {
      console.error('[executor] Computer use indicator state could not update.');
    }
  }

  /**
   * Confirms visible native windows and painted edge pixels for the exact Runtime revision on every current display.
   * Captures only owned overlay contents, never the user's desktop; timeout or a changed display/revision rejects dispatch.
   */
  async confirmVisible(revision: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stage = 'native-window';
    /**
     * Records only the finite validation stage and revision, never desktop contents or window identities.
     */
    const reject = (reason: string): false => {
      console.warn('[executor] Computer indicator confirmation rejected.', { revision, stage: reason });
      return false;
    };
    try {
      const verify = async (): Promise<boolean> => {
        const displays = screen.getAllDisplays();
        await Promise.all(displays.map((display) => this.loading.get(display.id)));
        const windows = displays.map((display) => this.windows.get(display.id));
        if (windows.some((window) => !window || window.isDestroyed() || !window.isVisible())) {
          return reject('native-window-unavailable');
        }
        stage = 'animation-frame';
        const painted = await Promise.all(
          windows.map((window) =>
            window!.webContents.executeJavaScript(
              `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
                state: document.querySelector('.computer-overlay')?.dataset.state,
                width: innerWidth, height: innerHeight
              }))))`
            )
          )
        );
        if (
          painted.some(
            (frame, index) =>
              frame.state !== 'running' ||
              frame.width !== displays[index].bounds.width ||
              frame.height !== displays[index].bounds.height
          )
        ) {
          return reject('document-not-painted');
        }
        stage = 'owned-window-capture';
        const images = await Promise.all(
          windows.map((window) =>
            window!.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
          )
        );
        const current = screen.getAllDisplays();
        if (
          this.disposed ||
          this.revision !== revision ||
          this.state !== 'running' ||
          current.length !== displays.length
        ) {
          return reject('activity-or-display-changed');
        }
        if (!(
          current.every(
            (display, index) =>
              display.id === displays[index].id &&
              display.scaleFactor === displays[index].scaleFactor &&
              JSON.stringify(display.bounds) === JSON.stringify(displays[index].bounds)
          ) &&
          windows.every(
            (window, index) =>
              window === this.windows.get(displays[index].id) &&
              !window!.isDestroyed() &&
              window!.isVisible() &&
              JSON.stringify(window!.getBounds()) === JSON.stringify(displays[index].bounds) &&
              JSON.stringify(window!.getContentBounds()) === JSON.stringify(displays[index].bounds)
          )
        )) {
          return reject('window-layout-changed');
        }
        const paintedEdges = images.every((image, index) => {
          if (image.isEmpty()) {
            return false;
          }
          const pixels = image.toBitmap();
          const { width, height } = image.getSize();
          const inset = Math.max(1, Math.round(2 * displays[index].scaleFactor));
          if (width <= inset * 2 || height <= inset * 2 || pixels.length !== width * height * 4) {
            return false;
          }
          // Rounded/compositor-clipped corners are not representative of the visible ribbon.
          // Require actual painted pixels on every side, away from corners and the label.
          const points = [
            [Math.floor(width / 4), inset],
            [Math.floor(width / 4), height - inset - 1],
            [inset, Math.floor(height / 2)],
            [width - inset - 1, Math.floor(height / 2)],
          ];
          return points.every(([x, y]) => pixels[(y * width + x) * 4 + 3] > 0);
        });
        return paintedEdges || reject('ribbon-not-painted');
      };
      return await Promise.race([
        verify(),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(reject('confirmation-deadline')), 2000);
        }),
      ]);
    } catch {
      return reject(stage + '-failed');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Removes only owned overlay windows and screen listeners; repeated disposal is harmless.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    screen.removeListener('display-added', this.reconcile);
    screen.removeListener('display-removed', this.reconcile);
    screen.removeListener('display-metrics-changed', this.reconcile);
    this.destroyWindows();
  }

  /**
   * Reconciles full display bounds, including taskbars and changed DPI, without focusing or capturing input.
   */
  private reconcile = (): void => {
    if (this.disposed || this.state === 'idle') {
      this.destroyWindows();
      return;
    }
    const displays = screen.getAllDisplays();
    const ids = new Set(displays.map((display) => display.id));
    for (const [id, window] of this.windows) {
      if (!ids.has(id)) {
        this.windows.delete(id);
        this.loading.delete(id);
        window.destroy();
      }
    }
    for (const display of displays) {
      let window = this.windows.get(display.id);
      const url = this.documentUrl + '#' + this.state;
      if (!window || window.isDestroyed()) {
        window = new BrowserWindow({
          ...display.bounds,
          show: false,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          focusable: false,
          skipTaskbar: true,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          hasShadow: false,
          title: 'Octopus Computer Use Indicator',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            webviewTag: false,
            allowRunningInsecureContent: false,
            devTools: false,
            backgroundThrottling: false,
          },
        });
        const owned = window;
        this.windows.set(display.id, owned);
        owned.setIgnoreMouseEvents(true);
        owned.setAlwaysOnTop(true, 'screen-saver');
        owned.setMenuBarVisibility(false);
        owned.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        owned.webContents.on('will-navigate', (event) => event.preventDefault());
        owned.webContents.on('will-redirect', (event) => event.preventDefault());
        owned.webContents.on('render-process-gone', () => {
          if (this.windows.get(display.id) === owned) {
            this.windows.delete(display.id);
          }
          if (!owned.isDestroyed()) {
            owned.destroy();
          }
          console.error('[executor] Computer use indicator unavailable.');
        });
        owned.once('closed', () => {
          if (this.windows.get(display.id) === owned) {
            this.windows.delete(display.id);
          }
        });
        const ready = owned
          .loadURL(url)
          .then(() => {
            if (!this.disposed && this.state !== 'idle' && !owned.isDestroyed()) {
              owned.showInactive();
              owned.setBounds(display.bounds);
            }
          })
          .catch(() => {
            if (!owned.isDestroyed()) {
              owned.destroy();
            }
            console.error('[executor] Computer use indicator could not load.');
          });
        this.loading.set(display.id, ready);
      } else if (JSON.stringify(window.getBounds()) !== JSON.stringify(display.bounds)) {
        window.setBounds(display.bounds);
      }
    }
  };

  /**
   * Tears down app-owned overlays without altering management windows or other applications.
   */
  private destroyWindows(): void {
    const windows = [...this.windows.values()];
    this.windows.clear();
    this.loading.clear();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    }
  }
}
