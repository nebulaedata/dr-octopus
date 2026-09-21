/**
 * @author Codex
 * @description Provides common utilities for the Web application.
 */

/**
 * Derives the same-origin WebSocket URL from the current page.
 */
export function createRealtimeUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * Starts a browser download from a URL through a temporary anchor.
 *
 * @param url URL of the resource to download.
 * @param fileName Optional file name exposed to the browser.
 */
export function download(url: string, fileName?: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  if (fileName !== undefined) {
    link.download = fileName;
  }
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Converts a browser File into a data URL before transport encoding.
 *
 * @param file File to read.
 * @returns A complete data URL.
 */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read attachment.')));
    reader.readAsDataURL(file);
  });
}
