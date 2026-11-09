import { randomUUID } from 'node:crypto';
import type { Reference } from 'firebase-admin/database';
import { hasControlChars, hasMarkup } from '../../../shared/domain/text.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { runTransaction } from '../../../shared/firebase/rtdb-transaction.js';

export interface AgendaService {
  id: string;
  name: string;
}

interface CatalogRecord {
  revision?: number;
  items?: AgendaService[];
}

export interface CatalogChange {
  action: 'add' | 'delete';
  name: string | null;
  id: string | null;
  actor: string;
}

const BASE: ReadonlyArray<readonly [string, string]> = [
  ['base_entrega', 'ENTREGA DE MATERIAL'],
  ['base_retirada', 'RETIRADA DE MATERIAL'],
  ['base_coleta', 'COLETA DE MATERIAL'],
  ['base_atendimento', 'ATENDIMENTO'],
];

const SERVICE_ID = /^(?:base_(?:entrega|retirada|coleta|atendimento)|srv_[a-f0-9]{32})$/;

const invalid = (message: string, status = 400): AppError =>
  new AppError(status, 'AGENDA_SERVICE_INVALID', message);

const withoutAccents = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const defaultAgendaServices = (): AgendaService[] => BASE.map(([id, name]) => ({ id, name }));

export const agendaServiceCatalog = (raw: unknown): AgendaService[] => {
  const items = (raw as CatalogRecord | null | undefined)?.items;
  return Array.isArray(items) ? items : defaultAgendaServices();
};

export function normalizeAgendaServiceName(raw: unknown): string {
  if (typeof raw !== 'string') throw invalid('Informe o nome do serviço.');
  const name = raw.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
  if (name.length < 3 || name.length > 80 || hasMarkup(name) || hasControlChars(name)) {
    throw invalid('O serviço deve conter de 3 a 80 caracteres válidos.');
  }
  return name;
}

export function validateAgendaServiceId(raw: unknown): string {
  if (typeof raw !== 'string' || !SERVICE_ID.test(raw)) throw invalid('Identificador de serviço inválido.');
  return raw;
}

export async function mutateAgendaServiceCatalog(
  ref: Reference,
  { action, name, id, actor }: CatalogChange,
): Promise<{ changed: boolean; items: AgendaService[] }> {
  let change: 'none' | 'exists' | 'added' | 'missing' | 'deleted' = 'none';
  const tx = await runTransaction(ref, (current) => {
    const record = (current ?? null) as CatalogRecord | null;
    const items = agendaServiceCatalog(record);
    const revision = (record?.revision || 0) + 1;
    if (action === 'add' && name) {
      if (items.some((item) => withoutAccents(item.name) === withoutAccents(name))) {
        change = 'exists';
        return undefined;
      }
      if (items.length >= 100) throw invalid('Limite de 100 serviços cadastrados atingido.');
      change = 'added';
      return {
        revision,
        items: [...items, { id: 'srv_' + randomUUID().replace(/-/g, ''), name }],
        updatedAt: Date.now(),
        updatedBy: actor,
      };
    }
    if (action === 'delete') {
      if (!items.some((item) => item.id === id)) {
        change = 'missing';
        return undefined;
      }
      change = 'deleted';
      return {
        revision,
        items: items.filter((item) => item.id !== id),
        updatedAt: Date.now(),
        updatedBy: actor,
      };
    }
    throw invalid('Ação inválida.');
  });
  const settled = (change as string) === 'exists' || (change as string) === 'missing';
  if (!tx.committed && !settled) {
    throw new AppError(
      409,
      'AGENDA_SERVICE_CONFLICT',
      'Não foi possível registrar o serviço. Atualize e tente novamente.',
    );
  }
  const value = tx.committed ? tx.snapshot?.val() : (await ref.get()).val();
  return { changed: tx.committed, items: agendaServiceCatalog(value) };
}
