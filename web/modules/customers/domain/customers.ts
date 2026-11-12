import { partyRows, searchParties } from '../../../shared/domain/party.js';
import type { PartyRow } from '../../../shared/domain/party.js';

export type CustomerRow = PartyRow;

export const customerRows = (raw: unknown): CustomerRow[] =>
  partyRows(raw, (item) => String(item.id ?? item.cod ?? '').trim());

export const searchCustomers = (rows: readonly CustomerRow[], query: string): CustomerRow[] =>
  searchParties(rows, query);

export function renamedMessage(reply: { renamed?: { moved?: unknown } } | null | undefined): string {
  const moved = String(reply?.renamed?.moved ?? '').trim();
  return moved ? `O nome também foi trocado em: ${moved}.` : '';
}
