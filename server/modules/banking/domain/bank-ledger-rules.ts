import { isISODate, toBRDate, toISODate } from '../../../shared/domain/dates.js';
import { hasControlChars } from '../../../shared/domain/text.js';

export type Row = Record<string, unknown>;

export interface Problem {
  code: string;
  message: string;
}

export const ACCOUNT_TYPES = ['Conta Corrente', 'Poupança', 'Caixa', 'Aplicação', 'Conta Terceiro'] as const;
export const ENTRY_KINDS = ['Entrada', 'Saída'] as const;
export const MAX_CENTS = 100_000_000_000;
export const MAX_CHEQUES = 100;

const ACCOUNT_TEXT = {
  banco: 80,
  empresa: 80,
  titular: 120,
  cpfcnpj: 20,
  agencia: 20,
  conta: 30,
  pix: 160,
  endereco: 240,
  obs: 500,
} as const;

type AccountText = keyof typeof ACCOUNT_TEXT;

export interface AccountFields extends Partial<Record<AccountText, string>> {
  tipo?: (typeof ACCOUNT_TYPES)[number];
  saldo?: number;
  criadoEm?: string;
  cod?: string;
}

export interface EntryFields {
  data?: string;
  descricao?: string;
  tipo?: (typeof ENTRY_KINDS)[number];
  valor?: number;
}

export const isRow = (value: unknown): value is Row =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const problem = (code: string, message: string): Problem => ({ code, message });

export function safeKey(value: unknown, max = 160): string {
  const key = String(value ?? '').trim();
  if (!key || key.length > max || /[.#$[\]/]/.test(key) || hasControlChars(key)) return '';
  return key;
}

function cleanText(value: unknown, max: number, label: string): { text: string; problem: Problem | null } {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > max)
    return { text: '', problem: problem('FIELD_TOO_LONG', `${label} passou do tamanho permitido.`) };
  if (hasControlChars(text))
    return { text: '', problem: problem('INVALID_TEXT', `${label} tem caracteres inválidos.`) };
  return { text, problem: null };
}

export function centsOf(value: unknown, { allowNegative = false, allowZero = false } = {}): number | null {
  const amount = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(amount)) return null;
  const scaled = amount * 100;
  const cents = Math.round(scaled);
  if (Math.abs(cents - scaled) > 0.000001 || Math.abs(cents) > MAX_CENTS) return null;
  if (!allowNegative && cents < 0) return null;
  if (!allowZero && cents === 0) return null;
  return cents;
}

const LABELS: Record<AccountText, string> = {
  banco: 'O nome do banco',
  empresa: 'A empresa',
  titular: 'O titular',
  cpfcnpj: 'O CPF/CNPJ',
  agencia: 'A agência',
  conta: 'A conta',
  pix: 'O PIX',
  endereco: 'O endereço',
  obs: 'A observação',
};

export function cleanAccount(
  input: unknown,
  requireAll: boolean,
): { fields: AccountFields; problem: Problem | null } {
  const source = isRow(input) ? input : {};
  const fields: AccountFields = {};
  for (const [field, max] of Object.entries(ACCOUNT_TEXT) as [AccountText, number][]) {
    if (!(field in source)) continue;
    const cleaned = cleanText(source[field], max, LABELS[field]);
    if (cleaned.problem) return { fields, problem: cleaned.problem };
    fields[field] = cleaned.text;
  }
  if ((requireAll || 'banco' in source) && !fields.banco)
    return { fields, problem: problem('BANK_NAME_REQUIRED', 'Informe o nome do banco.') };
  if ('tipo' in source || requireAll) {
    const kind = String(source.tipo ?? 'Conta Corrente').trim();
    if (!(ACCOUNT_TYPES as readonly string[]).includes(kind))
      return { fields, problem: problem('INVALID_ACCOUNT_TYPE', 'Tipo de conta inválido.') };
    fields.tipo = kind as AccountFields['tipo'];
  }
  if ('saldo' in source || requireAll) {
    const cents = centsOf(source.saldo ?? 0, { allowNegative: true, allowZero: true });
    if (cents === null)
      return {
        fields,
        problem: problem('INVALID_AMOUNT', 'Saldo inicial inválido. Use no máximo duas casas decimais.'),
      };
    fields.saldo = cents / 100;
  }
  if ('criadoEm' in source && String(source.criadoEm ?? '').trim()) {
    const iso = toISODate(source.criadoEm);
    if (!iso) return { fields, problem: problem('INVALID_DATE', 'Data do saldo inicial inválida.') };
    fields.criadoEm = iso + 'T12:00:00.000Z';
  }
  if ('cod' in source) {
    const cod = String(source.cod ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(cod))
      return {
        fields,
        problem: problem('INVALID_BANK_CODE', 'Código da conta inválido. Use letras, números, - ou _.'),
      };
    fields.cod = cod;
  }
  return { fields, problem: null };
}

export function cleanEntry(
  input: unknown,
  requireAll: boolean,
): { fields: EntryFields; problem: Problem | null } {
  const source = isRow(input) ? input : {};
  const fields: EntryFields = {};
  if ('data' in source || requireAll) {
    const iso = toISODate(source.data);
    if (!iso || !isISODate(iso))
      return { fields, problem: problem('INVALID_DATE', 'Informe a data do lançamento.') };
    fields.data = iso;
  }
  if ('descricao' in source || requireAll) {
    const cleaned = cleanText(source.descricao, 240, 'A descrição');
    if (cleaned.problem) return { fields, problem: cleaned.problem };
    if (!cleaned.text) return { fields, problem: problem('DESCRIPTION_REQUIRED', 'Informe a descrição.') };
    fields.descricao = cleaned.text;
  }
  if ('tipo' in source || requireAll) {
    const kind = normalizeKind(source.tipo);
    if (!kind) return { fields, problem: problem('INVALID_ENTRY_KIND', 'Selecione Entrada ou Saída.') };
    fields.tipo = kind;
  }
  if ('valor' in source || requireAll) {
    const cents = centsOf(source.valor);
    if (cents === null)
      return {
        fields,
        problem: problem('INVALID_AMOUNT', 'Informe um valor positivo, com no máximo duas casas decimais.'),
      };
    fields.valor = cents / 100;
  }
  return { fields, problem: null };
}

export function normalizeKind(value: unknown): EntryFields['tipo'] | null {
  const raw = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (raw === 'entrada' || raw === 'credito') return 'Entrada';
  if (raw === 'saida' || raw === 'debito') return 'Saída';
  return null;
}

export function nextBankCode(existing: Iterable<string>): string {
  const codes = new Set(existing);
  let max = 0;
  for (const code of codes) {
    const match = /^BC-(\d+)$/.exec(code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  let next = max + 1;
  while (codes.has('BC-' + String(next).padStart(3, '0'))) next++;
  return 'BC-' + String(next).padStart(3, '0');
}

export interface MovementLinks {
  advanceMovementIds: ReadonlySet<string>;
  chequeMovementIds: ReadonlySet<string>;
}

export function lockedMovement(movement: Row, links: MovementLinks): Problem | null {
  const id = String(movement.id ?? '');
  if (/^LB-REP-/.test(id))
    return problem(
      'MOVEMENT_FROM_REPASSE',
      'Este movimento foi lançado pelo PIX de repasse a fornecedor (Ficha do fornecedor → Dinheiro recebido / Valor a repassar). Ele não pode ser alterado pelo extrato.',
    );
  if (/^LB-PG-/.test(id) || movement.payableId)
    return problem(
      'MOVEMENT_FROM_PAYMENT',
      'Este movimento foi lançado pelo pagamento de uma conta a pagar. Para desfazer, exclua o pagamento no Histórico de pagamentos da conta (🕒) — assim a conta e o banco ficam certos.',
    );
  if (/^LB-VD-/.test(id) || movement.saleId)
    return problem(
      'MOVEMENT_FROM_SALE',
      'Este movimento foi lançado por uma venda. Altere ou estorne pela tela de Vendas.',
    );
  if (/^LB-CR-/.test(id) || movement.receivableId)
    return problem(
      'MOVEMENT_FROM_RECEIVABLE',
      'Este movimento foi lançado pelo recebimento de uma conta a receber. Para desfazer, estorne o recebimento em Contas a Receber.',
    );
  if (
    movement.source === 'advance' ||
    movement.advanceCode ||
    /^Adiantamento: /i.test(String(movement.descricao ?? '')) ||
    links.advanceMovementIds.has(id)
  )
    return problem(
      'MOVEMENT_FROM_ADVANCE',
      'Este movimento pertence a um adiantamento. Edite ou exclua o adiantamento em Financeiro → Adiantamentos para manter o banco conciliado.',
    );
  if (movement.source === 'cheque' || movement.chequeId || links.chequeMovementIds.has(id))
    return problem(
      'MOVEMENT_FROM_CHEQUE',
      'Este movimento é a compensação de um cheque. Para desfazer, reabra o cheque em Cheques → A compensar.',
    );
  return null;
}

export function entrySignature(movement: Row): string {
  const cents = centsOf(Number(movement.valor));
  return JSON.stringify([
    toISODate(movement.data),
    String(movement.descricao ?? '').trim(),
    normalizeKind(movement.tipo) ?? '',
    cents ?? String(movement.valor ?? ''),
  ]);
}

export function chequeAutoDebit(cheque: Row, advances: unknown): boolean | null {
  if (!cheque.advanceCode) return null;
  if (String(cheque.tipoCheque ?? '') === 'Cheque de Terceiro') return false;
  const list = Array.isArray(advances) ? advances : isRow(advances) ? Object.values(advances) : [];
  const advance = list.find(
    (item): item is Row => isRow(item) && String(item.cod ?? '') === String(cheque.advanceCode),
  );
  if (advance?.movBancoId) return false;
  return true;
}

export function chequeOpen(cheque: Row): boolean {
  return !cheque.s || cheque.s === 'A';
}

export function chequeDescription(cheque: Row, mode: 'controle' | 'remessa', dateBR: string): string {
  const number = String(cheque.n ?? '').trim() || '—';
  return (
    'Cheque nº ' + number + ' compensado (' + (mode === 'remessa' ? 'remessa ' + dateBR : 'controle') + ')'
  );
}

export const brDate = (value: unknown): string => toBRDate(value);
