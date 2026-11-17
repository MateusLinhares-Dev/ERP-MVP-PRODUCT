import { messageOf } from '../../../shared/domain/errors.js';
import type { PayablesPort } from './ports.js';

export const PURCHASE_MESSAGE =
  'Esta conta pertence a um pedido de compra. Para mudar valor, vencimento ou parcelas, use Editar no Histórico de compras. Para pagar ou desfazer um pagamento, use Pagar e o histórico de pagamentos (🕒).';

export async function removePayables(
  port: PayablesPort,
  ids: readonly string[],
  done: string,
): Promise<boolean> {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) {
    port.notify('Essa conta já não existe mais na lista. Atualize a tela.', 'error');
    return false;
  }
  try {
    const result = (await port.request({ action: 'delete', ids: list })) as { ids?: unknown[] } | null;
    const removed = Array.isArray(result?.ids) ? result.ids.length : list.length;
    port.notify(done.replace('{n}', String(removed)), 'success');
    return true;
  } catch (failure) {
    port.notify('Não foi possível excluir: ' + messageOf(failure, 'erro desconhecido'), 'error');
    return false;
  }
}
