import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { erpSessionUser } from '../shared/auth/erp-session.js';
import type { ApiClient } from '../shared/http/api-client.js';
import { orphanPreview, restoredMovement } from '../modules/advance-review/domain/orphan-review.js';
import type { OrphanPreview, OrphanReply } from '../modules/advance-review/domain/orphan-review.js';
import { OrphanReviewDialog } from '../modules/advance-review/ui/OrphanReviewDialog.js';

interface LegacyAdvances {
  showToast?: (message: string, kind: string, duration: number) => void;
  ERPAdvanceActions?: {
    applyOrphanResult?: (supplierCode: string, advanceCode: string, reply: OrphanReply) => void;
  };
}

const legacy = (): LegacyAdvances => window as unknown as LegacyAdvances;

function toast(message: string, kind: 'error' | 'success'): void {
  const show = legacy().showToast;
  if (show) show(message, kind, 6500);
  else window.alert(message);
}

function openDialog(
  preview: OrphanPreview,
  supplierCode: string,
  advanceCode: string,
  send: (payload: Record<string, unknown>) => Promise<OrphanReply>,
): Promise<OrphanReply | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (reply: OrphanReply | null) => {
      root.unmount();
      host.remove();
      resolve(reply);
    };
    root.render(
      <StrictMode>
        <OrphanReviewDialog
          preview={preview}
          supplierCode={supplierCode}
          advanceCode={advanceCode}
          send={send}
          onDone={done}
        />
      </StrictMode>,
    );
  });
}

export function installAdvanceReview(api: ApiClient): void {
  const send = (payload: Record<string, unknown>) =>
    api.request<OrphanReply>('/api/finance/advance-orphan-recovery', { method: 'POST', body: payload });

  async function review(supplier: unknown, advance: unknown): Promise<boolean> {
    const supplierCode = String(supplier ?? '');
    const advanceCode = String(advance ?? '');
    const user = erpSessionUser();
    if (!user) throw new Error('Sessão expirada.');
    const { claims } = await user.getIdTokenResult();
    if (claims.canAdvances !== true || claims.canBanking !== true)
      throw new Error('Esta conferência precisa de acesso ao Financeiro e Bancos.');
    const preview = orphanPreview(
      await send({ action: 'preview', fornCod: supplierCode, adtCod: advanceCode }),
    );
    if (!preview.eligible) {
      toast(
        'Este adiantamento já possui utilização ou outros vínculos. Confira Compra de Sucata → Histórico e Contas a Pagar antes de alterá-lo. Nada foi modificado.',
        'error',
      );
      return false;
    }
    const reply = await openDialog(preview, supplierCode, advanceCode, send);
    if (!reply) return false;
    if (!restoredMovement(reply) && reply.removedCode !== advanceCode)
      throw new Error('Servidor não confirmou o cancelamento.');
    legacy().ERPAdvanceActions?.applyOrphanResult?.(supplierCode, advanceCode, reply);
    toast(
      restoredMovement(reply)
        ? 'Pagamento já realizado registrado no extrato do ERP. Nenhum novo pagamento foi enviado.'
        : 'Adiantamento cancelado após conferência. O histórico foi preservado.',
      'success',
    );
    return true;
  }

  Object.assign(window, { ERPAdvanceReview: Object.freeze({ review }) });
}
