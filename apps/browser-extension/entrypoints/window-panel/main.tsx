/**
 * @author Codex
 * @description Mounts the window-level agent panel while retaining the independent action popup.
 */
import { createRoot } from 'react-dom/client';
import { WindowPanel } from '../../src/features/window-panel/WindowPanel';
import '../popup/style.css';
import './style.css';
// Navigate once so browser sender/context metadata share the same immutable document URL.
if (!new URL(location.href).searchParams.has('instance')) {
  location.replace('?instance=' + crypto.randomUUID());
} else {
  const root = document.getElementById('root');
  if (!root) {
    throw Error('PANEL_ROOT_MISSING');
  }
  createRoot(root).render(<WindowPanel />);
}
