import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export type WebAppStatus = { offline: 'preparing' | 'ready' | 'unavailable'; updateAvailable: boolean };

export function useWebAppStatus(): WebAppStatus {
  const [status, setStatus] = useState<WebAppStatus>({ offline: 'preparing', updateAvailable: false });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (__DEV__ || !('serviceWorker' in navigator) || !window.isSecureContext) {
      setStatus({ offline: 'unavailable', updateAvailable: false });
      return;
    }
    let active = true;
    const cleanup: (() => void)[] = [];
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
        if (!active) return;
        const refresh = () => {
          if (!active) return;
          setStatus(previous => ({
            offline: registration.active?.state === 'activated' ? 'ready' : previous.offline,
            updateAvailable: !!registration.waiting,
          }));
        };
        const watchInstallation = () => {
          const worker = registration.installing;
          if (!worker) return;
          const onState = () => {
            refresh();
            if (active && worker.state === 'redundant' && !registration.active) {
              setStatus({ offline: 'unavailable', updateAvailable: false });
            }
          };
          worker.addEventListener('statechange', onState);
          cleanup.push(() => worker.removeEventListener('statechange', onState));
        };
        refresh();
        watchInstallation();
        registration.addEventListener('updatefound', watchInstallation);
        navigator.serviceWorker.addEventListener('controllerchange', refresh);
        cleanup.push(() => registration.removeEventListener('updatefound', watchInstallation));
        cleanup.push(() => navigator.serviceWorker.removeEventListener('controllerchange', refresh));
        void navigator.serviceWorker.ready.then(() => {
          if (active) setStatus(previous => ({ ...previous, offline: 'ready' }));
        });
      } catch {
        if (active) setStatus({ offline: 'unavailable', updateAvailable: false });
      }
    };
    if (document.readyState === 'complete') void register();
    else {
      const onLoad = () => { void register(); };
      window.addEventListener('load', onLoad, { once: true });
      cleanup.push(() => window.removeEventListener('load', onLoad));
    }
    return () => { active = false; cleanup.forEach(fn => fn()); };
  }, []);
  return status;
}
