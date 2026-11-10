export interface ChequeReportRow {
  origem: string;
  id: string;
  adiantamento: string;
  empresa: string;
  cliente: string;
  numero: string;
  data: string;
  vencimento: string;
  valor: number;
  situacao: string;
}

type Row = Record<string, unknown>;

export const CHEQUE_FORMS: readonly string[] = ['Cheque', 'Cheque de Terceiro'];
const SPLIT_NOTE = /^Quitação parcial de (\S+)/;

const text = (value: unknown, max = 240): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const cents = (value: unknown): number => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

function records(raw: unknown): Row[] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.values(raw as Row).filter(
    (value): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
  );
}

function groups(raw: unknown, deletedKeys: ReadonlySet<string>): [string, Row[]][] {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw as Row)
    .filter(([key]) => !deletedKeys.has(key))
    .map(([key, value]): [string, Row[]] => [key, records(value)]);
}

export function deletedKeys(raw: unknown): Set<string> {
  if (Array.isArray(raw)) return new Set(raw.map((value) => String(value)));
  if (raw && typeof raw === 'object')
    return new Set(
      Object.entries(raw as Row)
        .filter(([, value]) => Boolean(value))
        .map(([key]) => key),
    );
  return new Set();
}

export function supplierNames(raw: unknown): Map<string, string> {
  const names = new Map<string, string>();
  for (const supplier of records(raw)) {
    const code = text(supplier.cod, 100);
    if (code && !names.has(code)) names.set(code, text(supplier.nome));
  }
  return names;
}

const valid = (row: ChequeReportRow): boolean => Boolean(row.cliente) && row.valor > 0;

export function serverChequeRows(raw: unknown, deleted: unknown): ChequeReportRow[] {
  const removed = deletedKeys(deleted);
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw as Row)
    .filter(([id, value]) => !removed.has(id) && value && typeof value === 'object' && !Array.isArray(value))
    .map(([id, value]) => [id, value as Row] as const)
    .filter(([, cheque]) => text(cheque.advanceCode) && text(cheque.fornCod))
    .map(
      ([id, cheque]): ChequeReportRow => ({
        origem: 'Adiantamento a fornecedor',
        id: text(cheque.id || id, 100),
        adiantamento: text(cheque.advanceCode, 100),
        empresa: text(cheque.emitente || cheque.origem, 180),
        cliente: text(cheque.dest),
        numero: text(cheque.n, 40),
        data: text(cheque.d, 10),
        vencimento: text(cheque.venc, 10),
        valor: cents(cheque.v) / 100,
        situacao: cheque.s === 'C' ? 'Compensado' : cheque.s === 'X' ? 'Cancelado' : 'A compensar',
      }),
    )
    .filter((row) => valid(row) && Boolean(row.numero));
}

function supplierChequeSituation(cheque: Row): string {
  const status = text(cheque.status, 40);
  if (status === 'Devolvido' || status === 'Cancelado') return status;
  if (status === 'Compensado' || text(cheque.dataCompensacao, 10)) return 'Compensado';
  return 'A compensar';
}

export function supplierChequeRows(
  raw: unknown,
  names: ReadonlyMap<string, string>,
  deleted: unknown,
): ChequeReportRow[] {
  const rows: ChequeReportRow[] = [];
  for (const [code, cheques] of groups(raw, deletedKeys(deleted))) {
    for (const cheque of cheques) {
      const purpose = text(cheque.finalidade, 40);
      if (purpose && purpose !== 'Adiantamento') continue;
      const row: ChequeReportRow = {
        origem: 'Cheque cadastrado no fornecedor',
        id: text(cheque.id, 100),
        adiantamento: '',
        empresa: text(cheque.empresa || cheque.emitente, 180),
        cliente: names.get(code) || code,
        numero: text(cheque.num ?? cheque.numero, 40),
        data: text(cheque.bomPara || cheque.data, 10),
        vencimento: text(cheque.bomPara, 10),
        valor: cents(cheque.valor) / 100,
        situacao: supplierChequeSituation(cheque),
      };
      if (valid(row) && row.numero) rows.push(row);
    }
  }
  return rows;
}

function parentCode(advance: Row): string {
  const origin = text(advance.adiantamentoOrigem, 100);
  if (origin) return origin;
  return SPLIT_NOTE.exec(text(advance.obs, 1000))?.[1] ?? '';
}

export function advanceChequeRows(
  raw: unknown,
  names: ReadonlyMap<string, string>,
  deleted: unknown,
): ChequeReportRow[] {
  const rows: ChequeReportRow[] = [];
  for (const [code, advances] of groups(raw, deletedKeys(deleted))) {
    const cheques = advances.filter((advance) => CHEQUE_FORMS.includes(text(advance.forma, 40)));
    const byCode = new Map(cheques.map((advance) => [text(advance.cod, 100), advance]));
    const splitTotals = new Map<string, number>();
    const parents: Row[] = [];
    for (const advance of cheques) {
      const parent = parentCode(advance);
      if (parent && byCode.has(parent)) {
        splitTotals.set(parent, (splitTotals.get(parent) ?? 0) + cents(advance.valor));
      } else if (!parent) parents.push(advance);
    }
    for (const advance of parents) {
      const linked = Array.isArray(advance.chequeIds) && advance.chequeIds.length > 0;
      if (linked) continue;
      const advanceCode = text(advance.cod, 100);
      const total = Math.max(
        cents(advance.valorOriginal),
        cents(advance.valor) + (splitTotals.get(advanceCode) ?? 0),
      );
      const row: ChequeReportRow = {
        origem: 'Adiantamento em cheque sem número cadastrado',
        id: advanceCode,
        adiantamento: advanceCode,
        empresa: text(advance.empresa, 180),
        cliente: names.get(code) || code,
        numero: '',
        data: text(advance.data, 10),
        vencimento: '',
        valor: total / 100,
        situacao: 'A compensar',
      };
      if (valid(row)) rows.push(row);
    }
  }
  return rows;
}

export function customerChequeRows(raw: unknown): ChequeReportRow[] {
  const rows: ChequeReportRow[] = [];
  for (const [customer, cheques] of groups(raw, new Set())) {
    for (const cheque of cheques) {
      if (text(cheque.tipo, 40).toLowerCase() !== 'adiantamento') continue;
      const status = text(cheque.status, 40);
      const row: ChequeReportRow = {
        origem: 'Cheque de cliente',
        id: '',
        adiantamento: '',
        empresa: text(cheque.emitente, 180),
        cliente: text(customer),
        numero: text(cheque.num, 40),
        data: text(cheque.data || cheque.bomPara, 10),
        vencimento: text(cheque.bomPara, 10),
        valor: cents(cheque.valor) / 100,
        situacao:
          status === 'Compensado' ? 'Compensado' : status === 'Devolvido' ? 'Devolvido' : 'A compensar',
      };
      if (valid(row) && row.numero) rows.push(row);
    }
  }
  return rows;
}
