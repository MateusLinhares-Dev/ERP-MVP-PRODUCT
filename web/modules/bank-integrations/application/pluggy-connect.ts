const SDK_URL = 'https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js';
const LOAD_ERROR = 'Não foi possível carregar a conexão bancária.';

export interface PluggyConnectOptions {
  connectToken: string;
  includeSandbox: boolean;
  onSuccess(event: { item?: { id?: string }; id?: string }): void;
  onError(): void;
}

type PluggyConnectConstructor = new (options: PluggyConnectOptions) => { init(): void };

function pluggyConstructor(): PluggyConnectConstructor | undefined {
  return (window as unknown as { PluggyConnect?: PluggyConnectConstructor }).PluggyConnect;
}

function loadSdk(): Promise<void> {
  if (typeof pluggyConstructor() === 'function') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-pluggy-sdk]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(LOAD_ERROR)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.dataset.pluggySdk = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(LOAD_ERROR));
    document.head.appendChild(script);
  });
}

export async function openPluggyConnect(options: PluggyConnectOptions): Promise<void> {
  await loadSdk();
  const Connect = pluggyConstructor();
  if (!Connect) throw new Error(LOAD_ERROR);
  new Connect(options).init();
}
