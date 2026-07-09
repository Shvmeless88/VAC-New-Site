import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global error handler for Script errors
window.addEventListener('error', (event) => {
  if (event.message === 'Script error.') {
    console.warn('CORS Script Error detected. This is usually harmless but indicates an external script failed to provide detailed error info.', event);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
