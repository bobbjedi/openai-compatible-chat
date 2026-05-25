import { register } from 'register-service-worker';

// In SPA dev mode, process.env.SERVICE_WORKER_FILE is not set.
// Only register the service worker when it's available (PWA build mode).
const serviceWorkerFile = typeof process !== 'undefined'
  && process.env
  && process.env.SERVICE_WORKER_FILE;

if (serviceWorkerFile) {
  register(serviceWorkerFile, {
    ready() {
      // console.log('Service worker is active.')
    },

    registered() {
      // console.log('Service worker has been registered.')
    },

    cached() {
      // console.log('Content has been cached for offline use.')
    },

    updatefound() {
      // console.log('New content is downloading.')
    },

    updated() {
      // New content available — activate immediately and reload
      window.location.reload();
    },

    offline() {
      // console.log('No internet connection found. App is running in offline mode.')
    },

    error(/* err */) {
      // console.error('Error during service worker registration:', err)
    },
  });
}
