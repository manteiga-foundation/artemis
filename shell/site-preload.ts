// Runs in the website's page (every frame), in an isolated world: the page's scripts cannot see it
// and it changes nothing in the page. It tells the shell whether focus is in an editable field and
// forwards plain keys (no modifiers, not while typing) as console hotkeys. The page still receives
// every key.
import { ipcRenderer } from 'electron';

const editable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
};

addEventListener('focusin', (e) => ipcRenderer.send('site-editable', editable(e.target)), true);
addEventListener('focusout', () => ipcRenderer.send('site-editable', false), true);
addEventListener('DOMContentLoaded', () => ipcRenderer.send('site-editable', editable(document.activeElement)));
addEventListener(
  'keydown',
  (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || editable(e.target)) return;
    if (e.key.length !== 1 && e.key !== 'Escape' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    ipcRenderer.send('site-hotkey', e.key);
  },
  true
);
