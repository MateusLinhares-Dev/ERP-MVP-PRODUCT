import { messageOf } from '../../../shared/domain/errors.js';
import { formatAmount } from '../../../shared/domain/money.js';
import type { ReceivableRow } from '../domain/receivables.js';
import type { ReceivablesPort } from './ports.js';

const money = (value: number): string => 'R$ ' + formatAmount(value);

export async function removeReceivable(
  port: ReceivablesPort,
  row: ReceivableRow | undefined,
): Promise<boolean> {
  if (!row) {
    port.notify('Lançamento não encontrado. Atualize a tela.', 'error');
    return false;
  }
  if (!port.canOperate) {
    port.notify('Seu perfil pode consultar, mas não alterar Contas a Receber.', 'error');
    return false;
  }
  if (row.saleId) {
    port.notify('Esta conta é de uma venda: exclua ou edite pela venda.', 'error');
    return false;
  }
  const question =
    `Excluir lançamento de ${row.client || '?'} — ${money(row.amount)}?\nEsta ação não pode ser desfeita.` +
    (row.bankLinked ? '\nO lançamento no banco desta baixa também será desfeito.' : '');
  if (!port.confirm(question)) return false;
  try {
    await port.request({ action: 'delete', id: row.id });
    port.notify('Lançamento excluído.', 'success');
    return true;
  } catch (failure) {
    port.notify('Não foi possível excluir: ' + messageOf(failure, 'erro desconhecido'), 'error');
    return false;
  }
}

export async function reopenReceivable(
  port: ReceivablesPort,
  row: ReceivableRow | undefined,
): Promise<boolean> {
  if (!row) {
    port.notify('Lançamento não encontrado. Atualize a tela.', 'error');
    return false;
  }
  if (!port.canOperate) {
    port.notify('Seu perfil pode consultar, mas não alterar Contas a Receber.', 'error');
    return false;
  }
  const question =
    `Estornar a baixa de ${row.client || '?'} — ${money(row.amount)}? Ela volta a ficar pendente.` +
    (row.bankLinked ? '\nO lançamento no banco também será desfeito.' : '') +
    (row.cheques.length ? '\nOs cheques desta baixa saem da lista do cliente.' : '');
  if (!port.confirm(question)) return false;
  try {
    await port.request({ action: 'reopen', id: row.id });
    port.notify('Baixa estornada.', 'success');
    return true;
  } catch (failure) {
    port.notify('Não foi possível estornar: ' + messageOf(failure, 'erro desconhecido'), 'error');
    return false;
  }
}
