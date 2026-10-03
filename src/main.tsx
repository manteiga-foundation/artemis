import { createRoot } from 'react-dom/client';
import '@fontsource/titillium-web/300.css';
import '@fontsource/titillium-web/400.css';
import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { App } from './App';
import { DebugPage } from './debug/DebugPage';
import { getState } from './store';
import { readResume } from './resume';
import { engageConsole } from './session';
import { inShell } from './shell';

// Development only: expose the live store to browser tests and screenshot scripts. Importing
// `/src/store.ts` from outside would create a second instance once Vite has HMR history.
if (import.meta.env.DEV) (window as unknown as { __artemis: typeof getState }).__artemis = getState;

// /debug is a page of its own for trying things in isolation (sounds first).
const isDebug = location.pathname.replace(/\/+$/, '') === '/debug';
const page = isDebug ? <DebugPage /> : <App />;

if (!isDebug) {
  // In the owned browser (Electron shell) the website is a native page behind the console's
  // transparent window; styles.css opens the console's backdrop over it in the Browser view.
  if (inShell()) document.documentElement.dataset.shell = '';
  // A reload (right-click Reload, Cmd+R) comes back engaged on the website under review.
  const resume = readResume(sessionStorage);
  if (resume) engageConsole(resume.targetUrl, { resume: true });
}

// Arwes does not support React strict mode, so the app is mounted without <StrictMode>.
createRoot(document.getElementById('root')!).render(page);
