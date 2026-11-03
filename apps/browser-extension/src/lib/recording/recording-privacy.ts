/**
 * @author Codex
 * @description Removes values and identifying URL/text fragments before recording facts leave a page.
 */

/**
 * Keeps short semantic labels, replacing common secrets and personal identifiers.
 */
export function safeRecordingText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[邮箱]')
    .replace(/(?:bearer\s+)?[a-z0-9_+/-]{24,}={0,2}/gi, '[已隐藏]')
    .replace(/\+?\d[\d\s()-]{5,}\d/g, '[编号]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * Records only origin and static route segments, never credentials, query, fragment or identifier paths.
 */
export function safeRecordingUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }
    const path = url.pathname
      .split('/')
      .map((part) => (!part || /^[a-z-]{1,32}$/i.test(part) ? part : ':value'))
      .join('/');
    return (url.origin + path).slice(0, 1024);
  } catch {
    return '';
  }
}
