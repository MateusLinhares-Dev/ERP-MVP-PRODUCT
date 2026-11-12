import {
  CONTRIBUINTE_OPTIONS,
  bankSummary,
  checkPartyForm,
  documentOf,
  partyFormOf,
  partyPayload,
  partyRows,
  searchParties,
} from '../../../shared/domain/party.js';
import type { FormCheck, PartyForm, PartyRow, PersonType } from '../../../shared/domain/party.js';

export type SupplierRow = PartyRow;
export type SupplierForm = PartyForm;
export type { FormCheck, PersonType };
export { CONTRIBUINTE_OPTIONS, bankSummary, documentOf };

export const supplierRows = (raw: unknown): SupplierRow[] =>
  partyRows(raw, (item) => String(item.cod ?? '').trim());
export const searchSuppliers = (rows: readonly SupplierRow[], query: string): SupplierRow[] =>
  searchParties(rows, query);
export const formOf = partyFormOf;
export const checkForm = (form: SupplierForm): FormCheck => checkPartyForm(form, 'fornecedor');
export const payloadOf = (form: SupplierForm): Record<string, string | number> => partyPayload(form, false);
