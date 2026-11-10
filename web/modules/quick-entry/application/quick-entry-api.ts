import { ApiError, createApiClient } from '../../../shared/http/api-client.js';
import type { SessionAuth } from '../../../shared/auth/firebase-session.js';
import { goToLogin } from '../../../shared/auth/firebase-session.js';
import { interpretSpeech } from '../domain/speech-parser.js';
import { buildSaveBody, isTransientSaveError, retryDelaySeconds } from '../domain/entry-draft.js';
import type { EntryDraft } from '../domain/entry-draft.js';
import type {
  AttachmentRef,
  AttachmentUpload,
  EntryKind,
  EntryResult,
  HistoryResult,
  Interpretation,
  QuickOptions,
} from '../domain/contracts.js';

export const API_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  DATABASE_UNAVAILABLE: 'A internet ou o banco oscilou. Toque em salvar de novo — não duplica.',
  SESSION_EXPIRED: 'Sua sessão expirou. Entre de novo.',
  PURCHASE_IN_PROGRESS:
    'Outra operação deste fornecedor está em andamento. Aguarde alguns segundos e toque em salvar de novo.',
  QUICK_ENTRY_IN_PROGRESS: 'Este lançamento já está sendo gravado. Aguarde e confira em "Meus lançamentos".',
  NETWORK_ERROR: 'Sem conexão com a internet. Confira o sinal e tente de novo.',
});

const MAX_SAVE_ATTEMPTS = 3;

export interface QuickEntryApi {
  options(): Promise<QuickOptions>;
  interpret(text: string, kind: EntryKind): Promise<Interpretation>;
  uploadAttachment(file: AttachmentUpload): Promise<{ anexo: AttachmentRef }>;
  save(draft: EntryDraft, onRetry: () => void): Promise<EntryResult>;
  history(): Promise<HistoryResult>;
  downloadAttachment(attachment: AttachmentRef): Promise<Blob>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function createQuickEntryApi(auth: SessionAuth): QuickEntryApi {
  const client = createApiClient({
    currentUser: () => auth.currentUser,
    onSignedOut: goToLogin,
    messages: API_MESSAGES,
  });

  async function save(draft: EntryDraft, onRetry: () => void): Promise<EntryResult> {
    const path = draft.kind === 'compra' ? '/api/quick/purchase' : '/api/quick/sale';
    const body = buildSaveBody(draft);
    for (let attempt = 1; ; attempt++) {
      try {
        return await client.request<EntryResult>(path, { method: 'POST', body });
      } catch (error) {
        const transient = error instanceof ApiError && isTransientSaveError(error.code, error.status);
        if (!transient || attempt >= MAX_SAVE_ATTEMPTS) throw error;
        onRetry();
        await sleep(retryDelaySeconds(error.retryAfterSeconds, attempt) * 1000);
      }
    }
  }

  return {
    options: () => client.request<QuickOptions>('/api/quick/options'),
    interpret: (text, kind) =>
      client.request<Interpretation>('/api/quick/interpret', {
        method: 'POST',
        body: { texto: text, tipo: kind },
      }),
    uploadAttachment: (file) => client.request('/api/quick/attachment', { method: 'POST', body: file }),
    save,
    history: () => client.request<HistoryResult>('/api/quick/history'),
    downloadAttachment: (attachment) =>
      client.download(
        `/api/quick/attachment?dono=${encodeURIComponent(attachment.dono)}&id=${encodeURIComponent(attachment.id)}`,
        'Não consegui abrir o anexo.',
      ),
  };
}

export async function interpretEntry(
  api: QuickEntryApi,
  options: QuickOptions,
  text: string,
  kind: EntryKind,
): Promise<Interpretation> {
  if (options.aiEnabled) {
    try {
      return await api.interpret(text, kind);
    } catch (error) {
      console.warn('[rapido] IA indisponível, usando interpretador do aparelho', error);
    }
  }
  return interpretSpeech(text, {
    materials: options.materials,
    suppliers: options.suppliers,
    customers: options.customers,
    kind,
    today: options.today,
  });
}
