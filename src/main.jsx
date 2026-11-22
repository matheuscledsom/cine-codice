import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource-variable/source-sans-3/wght.css';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { domainConfig } from './config/domainConfig';
import { ToastProvider } from './context/ToastContext';
import './index.css';

document.title = domainConfig.appFullTitle || domainConfig.appName;

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let hadController = Boolean(navigator.serviceWorker.controller);
  let isReloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (!isReloading) {
      isReloading = true;
      window.location.reload();
    }
  });

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.__codiceApplySwUpdate = () => updateSW(true);
      window.dispatchEvent(new CustomEvent('codice:pwa-update-available'));
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const checkForUpdate = () => {
        registration.update().catch(() => {});
      };

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForUpdate();
        }
      });

      window.setInterval(checkForUpdate, 60 * 60 * 1000);
    },
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>
);
