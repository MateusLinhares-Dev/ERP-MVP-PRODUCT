import { toBRDate, toISODate } from '../../../shared/domain/dates.js';
import {
  parseAmount,
  pickDestination,
  type ChequeBank,
  type ControlCheque,
  type Destination,
  type Situation,
} from './control.js';

export interface ChequeForm {
  id: string;
  bank: string;
  number: string;
  holder: string;
  value: string;
  situation: Situation;
  issued: string;
  due: string;
  cleared: string;
  destinationCode: string;
  destinationType: string;
}

export function formFor(
  cheque: ControlCheque | null,
  banks: readonly ChequeBank[],
  prefill?: Partial<ChequeForm>,
) {
  const base: ChequeForm = cheque
    ? {
        id: cheque.id,
        bank: cheque.bank,
        number: cheque.number,
        holder: cheque.holder,
        value: cheque.value ? String(cheque.value).replace('.', ',') : '',
        situation: cheque.situation === 'N' ? 'X' : cheque.situation,
        issued: toISODate(cheque.issued),
        due: toISODate(cheque.due),
        cleared: toISODate(cheque.cleared),
        destinationCode: cheque.destinationCode,
        destinationType: cheque.destinationType,
      }
    : {
        id: '',
        bank: banks[0]?.name ?? '',
        number: '',
        holder: '',
        value: '',
        situation: 'A',
        issued: '',
        due: '',
        cleared: '',
        destinationCode: '',
        destinationType: '',
      };
  return { ...base, ...prefill };
}

export function savePayload(
  form: ChequeForm,
  banks: readonly ChequeBank[],
  destinations: readonly Destination[],
) {
  const chosen = pickDestination(
    destinations,
    { code: form.destinationCode, type: form.destinationType },
    form.holder,
  );
  return {
    action: 'save-cheque',
    id: form.id,
    slug: banks.find((bank) => bank.name === form.bank)?.slug ?? '',
    cheque: {
      b: form.bank,
      n: form.number.trim(),
      c: form.holder.trim(),
      v: parseAmount(form.value),
      d: toBRDate(form.issued),
      venc: toBRDate(form.due),
      cd: toBRDate(form.cleared),
      s: form.situation,
    },
    destino: chosen ? { tipo: chosen.type, cod: chosen.code, nome: chosen.name } : null,
  };
}

export interface BatchForm {
  bank: string;
  holder: string;
  start: string;
  count: string;
  value: string;
  issued: string;
  due: string;
  situation: 'A' | 'C';
  discountsPurchase: boolean;
}

export function batchPayload(form: BatchForm, banks: readonly ChequeBank[]) {
  return {
    action: 'batch-cheques',
    slug: banks.find((bank) => bank.name === form.bank)?.slug ?? '',
    start: Number.parseInt(form.start, 10) || 0,
    count: Number.parseInt(form.count, 10) || 0,
    s: form.situation,
    dc: form.discountsPurchase,
    cheque: {
      b: form.bank,
      c: form.holder.trim(),
      v: parseAmount(form.value),
      d: toBRDate(form.issued),
      venc: toBRDate(form.due),
    },
  };
}

export function deleteBlock(cheque: ControlCheque, canBank: boolean): string {
  if (cheque.advanceCode)
    return (
      'Este cheque pertence ao adiantamento ' +
      cheque.advanceCode +
      '.\n\nPara removê-lo, exclua o adiantamento no módulo Adiantamentos: os cheques dele saem junto, sem deixar saldo sem origem.'
    );
  if (cheque.bankMovementId && !canBank)
    return 'Este cheque já saiu do saldo do banco. Para excluí-lo, peça para quem tem acesso a Bancos.';
  return '';
}

export function reopenBlock(cheque: ControlCheque, canBank: boolean): string {
  if (cheque.bankMovementId && !canBank)
    return 'Este cheque já saiu do saldo do banco. Para reabri-lo é preciso desfazer a saída no extrato: peça para quem tem acesso a Bancos.';
  return '';
}
