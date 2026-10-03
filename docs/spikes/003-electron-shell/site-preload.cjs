// Isolated world in the site's page (every frame): reports whether focus is in an editable field so
// the shell knows when a key is a hotkey. Adds nothing to the page's DOM and is invisible to its scripts.
const { ipcRenderer } = require('electron');
const editable = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
addEventListener('focusin', (e) => ipcRenderer.send('site-editable', editable(e.target)), true);
addEventListener('focusout', () => ipcRenderer.send('site-editable', false), true);
// Plain keys (not in a field, no modifiers) are hotkeys for the console as well; the page still gets them.
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || editable(e.target)) return;
  if (e.key.length !== 1 && !['Escape', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  ipcRenderer.send('site-hotkey', e.key);
}, true);
addEventListener('DOMContentLoaded', () => ipcRenderer.send('site-editable', editable(document.activeElement)));
