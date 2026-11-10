import type { SessionUser } from '../auth/firebase-session.js';

const MIN_INTERVAL_MS = 1500;

function safeCode(code: unknown): string {
  return String(code || 'UNKNOWN')
    .replace(/[^A-Za-z0-9_:-]/g, '')
    .slice(0, 50);
}

function activeModule(): string {
  return (document.querySelector('.tab-panel.active')?.id || 'frontend').replace(/^tab-/, '').slice(0, 40);
}

export function installErrorTelemetry(currentUser: () => SessionUser | null): void {
  let last = 0;
  const report = (kind: 'js_error' | 'unhandled_rejection', code: unknown) => {
    const now = Date.now();
    const user = currentUser();
    if (now - last < MIN_INTERVAL_MS || !user) return;
    last = now;
    const body = JSON.stringify({
      kind,
      code: safeCode(code),
      module: activeModule(),
      path: location.pathname.slice(0, 100),
    });
    user
      .getIdToken()
      .then((token) =>
        fetch('/api/engineering/telemetry', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body,
        }),
      )
      .catch(() => undefined);
  };
  window.addEventListener('error', (event) =>
    report('js_error', (event.error as Error | undefined)?.name || 'JavaScriptError'),
  );
  window.addEventListener('unhandledrejection', () => report('unhandled_rejection', 'PromiseRejection'));
}
