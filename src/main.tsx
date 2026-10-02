import { createRoot } from 'react-dom/client';
import '@fontsource/titillium-web/300.css';
import '@fontsource/titillium-web/400.css';
import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { App } from './App';
import { getState } from './store';

// Development only: expose the live store to browser tests and screenshot scripts. Importing
// `/src/store.ts` from outside would create a second instance once Vite has HMR history.
if (import.meta.env.DEV) (window as unknown as { __artemis: typeof getState }).__artemis = getState;

// Arwes does not support React strict mode, so the app is mounted without <StrictMode>.
createRoot(document.getElementById('root')!).render(<App />);
