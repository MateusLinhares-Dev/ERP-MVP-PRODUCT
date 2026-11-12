import { useState } from 'react';
import { toBRDate } from '../../../shared/domain/dates.js';
import { formatQuantity } from '../../../shared/domain/money.js';
import { RECENT_WEIGHING_DAYS } from '../domain/sales.js';
import type { PendingWeighing } from '../domain/sales.js';

interface PendingWeighingsProps {
  rows: PendingWeighing[];
  old: PendingWeighing[];
  canOperate: boolean;
  onOpen(key: string): void;
  onRomaneio(key: string): void;
  onArchive(key: string): void;
}

function Card({
  row,
  canOperate,
  onOpen,
  onRomaneio,
  onArchive,
}: {
  row: PendingWeighing;
  canOperate: boolean;
  onOpen(key: string): void;
  onRomaneio(key: string): void;
  onArchive(key: string): void;
}) {
  return (
    <article className="phase4-pending-card">
      <div className="phase4-pending-ticket">
        <b>{row.ticket}</b>
        <span>{toBRDate(row.date) || '—'}</span>
      </div>
      <div className="phase4-pending-main">
        <strong>{row.client || 'Cliente'}</strong>
        <span>
          {row.items
            .map((item) => item.material)
            .filter(Boolean)
            .join(', ') || 'Material não informado'}
          {row.plate ? ' · placa ' + row.plate : ''}
        </span>
      </div>
      <div className="phase4-pending-weight">
        <b>{formatQuantity(row.kg)} kg</b>
        <span>líquido</span>
      </div>
      <div className="phase4-pending-actions">
        <button type="button" className="phase4-po-outline" onClick={() => onRomaneio(row.key)}>
          🖨️ Romaneio
        </button>
        {canOperate ? (
          <button
            type="button"
            className="phase4-po-outline erp-sale-archive"
            title="A venda desta pesagem já foi lançada de outro jeito: tirar da fila"
            onClick={() => onArchive(row.key)}
          >
            ✓ Já lançada
          </button>
        ) : null}
        {canOperate ? (
          <button type="button" className="phase4-po-save" onClick={() => onOpen(row.key)}>
            Abrir pedido →
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function PendingWeighings({
  rows,
  old,
  canOperate,
  onOpen,
  onRomaneio,
  onArchive,
}: PendingWeighingsProps) {
  const [showOld, setShowOld] = useState(false);
  const card = (row: PendingWeighing) => (
    <Card
      key={row.key}
      row={row}
      canOperate={canOperate}
      onOpen={onOpen}
      onRomaneio={onRomaneio}
      onArchive={onArchive}
    />
  );
  return (
    <>
      {rows.length ? (
        <>
          <div className="phase4-pending-intro">
            <b>Pesagens de saída a fechar</b>
            <span>
              Cada linha é uma carga já pesada que ainda precisa de preço e do fechamento financeiro.
            </span>
          </div>
          <div className="phase4-pending-grid" id="vendas-pesagens-list">
            {rows.map(card)}
          </div>
        </>
      ) : (
        <div className="phase4-pending-empty">
          <b>✅ Nenhuma pesagem de saída aguardando fechamento.</b>
          <span>
            Quando uma venda for pesada na Balança Rodoviária, ela aparece aqui até virar um pedido de venda.
          </span>
        </div>
      )}
      {old.length ? (
        <div className="erp-sales-old-weighings">
          <button type="button" className="erp-sales-clear" onClick={() => setShowOld((value) => !value)}>
            {showOld ? 'Esconder' : 'Mostrar'} {old.length} {old.length === 1 ? 'pesagem' : 'pesagens'} com
            mais de {RECENT_WEIGHING_DAYS} dias sem pedido
          </button>
          {showOld ? (
            <div className="phase4-pending-grid" id="vendas-pesagens-antigas">
              {old.map(card)}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
