/**
 * @author Codex
 * @description Displays bundled browser brand artwork consistently across connection and installation controls.
 */
import chromeIcon from '@/assets/browsers/chrome.svg';
import edgeIcon from '@/assets/browsers/edge.svg';

/**
 * Renders decorative artwork beside an existing browser text label without duplicate accessible names.
 */
export function BrowserBrandIcon({ browser }: { browser: 'chrome' | 'edge' }) {
  return (
    <img
      src={browser === 'edge' ? edgeIcon : chromeIcon}
      alt=""
      aria-hidden="true"
      className="size-5 shrink-0 object-contain"
    />
  );
}
