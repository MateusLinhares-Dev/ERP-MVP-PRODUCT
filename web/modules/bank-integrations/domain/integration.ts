export interface IntegrationConfig {
  configured?: boolean;
  connected?: boolean;
  accountId?: string;
  lastSyncAt?: number | string;
}

export interface ExternalAccount {
  id: string;
  name: string;
  type: string;
  numberEnd: string;
}

export type IntegrationAction =
  | 'status'
  | 'save'
  | 'test'
  | 'connect-token'
  | 'link'
  | 'accounts'
  | 'select-account'
  | 'disconnect'
  | 'sync';

export interface IntegrationReply {
  config?: IntegrationConfig;
  accounts?: ExternalAccount[];
  canConfigure?: boolean;
  message?: string;
  accessToken?: string;
}

export function isValidBankCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code);
}

export function usesSandbox(hostname: string): boolean {
  return hostname.includes('hml') || hostname === 'localhost';
}

export function formatLastSync(value: IntegrationConfig['lastSyncAt']): string {
  return value ? new Date(value).toLocaleString('pt-BR') : '—';
}
