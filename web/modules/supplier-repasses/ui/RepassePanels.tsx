import { useEffect, useState } from 'react';
import { formatDate, formatMoney } from '../../../shared/domain/format.js';
import type { RepasseSummary } from '../domain/repasses.js';

interface PayablesSummaryProps {
  summary: RepasseSummary;
  onOpen(code: string, name: string): void;
}

export function PayablesSummary({ summary, onOpen }: PayablesSummaryProps) {
  return (
    <>
      <h3>Dinheiro recebido para repasse via PIX</h3>
      <strong>Total a repassar: {formatMoney(summary.totalEmAberto)}</strong>
      <p>
        Obrigações separadas dos títulos de compra. Não abatem adiantamentos nem aparecem duas vezes no total
        de contas a pagar.
      </p>
      {summary.rows.length ? (
        <div className="supplier-repass-payables-list">
          {summary.rows.map((row) => (
            <div key={row.fornCod + row.data}>
              <span>
                {row.nome} · {formatDate(row.data)} · {formatMoney(row.saldo)} pendente
              </span>
              <button
                type="button"
                data-repass-open-forn={row.fornCod}
                onClick={() => onOpen(row.fornCod, row.nome)}
              >
                Ver / baixar
              </button>
            </div>
          ))}
        </div>
      ) : (
        <small>Não há valores pendentes de repasse.</small>
      )}
    </>
  );
}

interface SupplierIndicatorProps {
  code: string;
  balance(code: string): Promise<number>;
  onOpen(): void;
}

export function SupplierIndicator({ code, balance, onOpen }: SupplierIndicatorProps) {
  const [text, setText] = useState('Consultando repasses...');
  useEffect(() => {
    let active = true;
    balance(code).then(
      (value) => {
        if (active) setText('Saldo recebido a repassar via PIX: ' + formatMoney(value));
      },
      () => {
        if (active) setText('Consulte os repasses no cadastro.');
      },
    );
    return () => {
      active = false;
    };
  }, [balance, code]);
  return (
    <>
      <button type="button" id="supplier-cash-repass-open" className="supplier-repass-open" onClick={onOpen}>
        Dinheiro recebido / Valor a repassar
      </button>
      <small id="supplier-cash-repass-indicator" className="supplier-repass-indicator" data-forn-cod={code}>
        {text}
      </small>
    </>
  );
}
