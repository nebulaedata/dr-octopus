/**
 * @author Codex
 * @description Mounts the independent React popup without sharing page controllers or desktop resources.
 */
import { createRoot } from 'react-dom/client';
import { Popup } from './Popup';
import './style.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('POPUP_ROOT_MISSING');
}
createRoot(root).render(<Popup />);
