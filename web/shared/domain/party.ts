import { parseDecimal, toFieldText } from './decimal.js';
import { searchKey, validCnpj, validCpf } from './documents.js';

export type PersonType = 'PF' | 'PJ';

export interface PartyRow {
  key: string;
  cod: string;
  nome: string;
  fantasia: string;
  cpf: string;
  cnpj: string;
  tel: string;
  wpp: string;
  email: string;
  cidade: string;
  pix: string;
  banco: string;
  agencia: string;
  conta: string;
  obs: string;
  limite: number;
  update: number | null;
}

export interface PartyForm {
  personType: PersonType;
  nome: string;
  fantasia: string;
  desde: string;
  cpf: string;
  cnpj: string;
  ie: string;
  rg: string;
  orgaoEmissor: string;
  contribuinte: string;
  tel: string;
  wpp: string;
  email: string;
  cep: string;
  uf: string;
  cidadeNome: string;
  rua: string;
  num: string;
  compl: string;
  bairro: string;
  pix: string;
  banco: string;
  agencia: string;
  conta: string;
  limite: string;
  obs: string;
  nota: string;
}

export const CONTRIBUINTE_OPTIONS = [
  'Não informado',
  'Contribuinte ICMS',
  'Isento',
  'Não contribuinte',
] as const;

type Row = Record<string, unknown>;
const text = (value: unknown): string => String(value ?? '').trim();

export function partyRows(raw: unknown, keyOf: (item: Row) => string): PartyRow[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((item): item is Row => Boolean(item) && typeof item === 'object' && Boolean(keyOf(item as Row)))
    .map((item) => ({
      key: keyOf(item),
      cod: text(item.cod),
      nome: text(item.nome),
      fantasia: text(item.fantasia || item.nomeFantasia),
      cpf: text(item.cpf),
      cnpj: text(item.cnpj),
      tel: text(item.tel),
      wpp: text(item.wpp),
      email: text(item.email),
      cidade: text(item.cidade),
      pix: text(item.pix),
      banco: text(item.banco),
      agencia: text(item.agencia),
      conta: text(item.conta),
      obs: text(item.obs),
      limite: Number(item.limite) > 0 ? Number(item.limite) : 0,
      update: item._upd == null ? null : Number(item._upd),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
}

const plain = (value: unknown): string => searchKey(value).replace(/[^a-z0-9 ]/g, '');

export function searchParties<T extends PartyRow>(rows: readonly T[], query: string): T[] {
  const wanted = plain(query);
  if (!wanted) return [...rows];
  const digits = wanted.replace(/\D/g, '');
  return rows.filter((row) => {
    const haystack = plain(
      [row.cod, row.nome, row.fantasia, row.cidade, row.tel, row.wpp, row.email].join(' '),
    );
    if (haystack.includes(wanted)) return true;
    return digits.length >= 3 && (row.cpf + row.cnpj).replace(/\D/g, '').includes(digits);
  });
}

export const documentOf = (row: PartyRow): string => row.cnpj || row.cpf;

export function bankSummary(row: PartyRow): string {
  return [
    row.pix ? 'PIX: ' + row.pix : '',
    row.banco,
    row.agencia ? 'Ag ' + row.agencia : '',
    row.conta ? 'C/C ' + row.conta : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function partyFormOf(entity: Row | null, today: string): PartyForm {
  const source = entity ?? {};
  const combined = text(source.cidade).split('/');
  const value = (key: string): string => text(source[key]);
  return {
    personType:
      source.personType === 'PF' || source.personType === 'PJ'
        ? source.personType
        : value('cnpj')
          ? 'PJ'
          : 'PF',
    nome: value('nome'),
    fantasia: value('fantasia') || value('nomeFantasia'),
    desde: value('desde') || value('dataCadastro') || (entity ? '' : today),
    cpf: value('cpf'),
    cnpj: value('cnpj'),
    ie: value('ie'),
    rg: value('rg'),
    orgaoEmissor: value('orgaoEmissor'),
    contribuinte: value('contribuinte') || 'Não informado',
    tel: value('tel'),
    wpp: value('wpp'),
    email: value('email'),
    cep: value('cep'),
    uf: (value('uf') || text(combined[1])).toUpperCase(),
    cidadeNome: value('cidadeNome') || text(combined[0]),
    rua: value('rua'),
    num: value('num'),
    compl: value('compl'),
    bairro: value('bairro'),
    pix: value('pix'),
    banco: value('banco'),
    agencia: value('agencia'),
    conta: value('conta'),
    limite: Number(source.limite) > 0 ? toFieldText(Number(source.limite)) : '',
    obs: value('obs'),
    nota: value('nota'),
  };
}

export type FormCheck =
  | { ok: true }
  | { ok: false; field: keyof PartyForm; message: string }
  | { ok: 'confirm'; message: string };

export function checkPartyForm(form: PartyForm, noun: string): FormCheck {
  if (!form.nome.trim()) return { ok: false, field: 'nome', message: `Informe o nome do ${noun}.` };
  if (form.personType === 'PF' && form.cpf.trim() && !validCpf(form.cpf))
    return { ok: false, field: 'cpf', message: 'CPF inválido. Confira os dígitos antes de salvar.' };
  if (form.personType === 'PJ' && form.cnpj.trim() && !validCnpj(form.cnpj))
    return { ok: false, field: 'cnpj', message: 'CNPJ inválido. Confira os dígitos antes de salvar.' };
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
    return { ok: false, field: 'email', message: 'E-mail inválido.' };
  const limit = form.limite.trim() ? parseDecimal(form.limite) : 0;
  if (limit == null || limit < 0)
    return { ok: false, field: 'limite', message: 'Limite de crédito inválido.' };
  const outdated = form.personType === 'PF' ? form.cnpj : form.cpf;
  if (outdated.trim()) {
    const label = form.personType === 'PF' ? 'CNPJ' : 'CPF';
    return {
      ok: 'confirm',
      message: `Este cadastro tem ${label} preenchido, mas está marcado como ${form.personType === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica'}. Ao salvar, o ${label} será removido. Deseja continuar?`,
    };
  }
  return { ok: true };
}

export function partyPayload(form: PartyForm, withLimit: boolean): Record<string, string | number> {
  const uf = form.uf.trim().toUpperCase();
  const city = form.cidadeNome.trim();
  const { limite, ...fields } = form;
  const payload: Record<string, string | number> = {
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value).trim()])),
    nome: form.nome.trim().replace(/\s+/g, ' ').toUpperCase(),
    nomeFantasia: form.fantasia.trim(),
    dataCadastro: form.desde,
    cpf: form.personType === 'PF' ? form.cpf.trim() : '',
    cnpj: form.personType === 'PJ' ? form.cnpj.trim().toUpperCase() : '',
    uf,
    cidade: [city, uf].filter(Boolean).join('/'),
  };
  if (withLimit) payload.limite = limite.trim() ? (parseDecimal(limite) ?? 0) : 0;
  return payload;
}
