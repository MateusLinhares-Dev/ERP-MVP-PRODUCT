import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import './dialog.css';

export function Dialog({
  title,
  onClose,
  children,
  className = '',
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="erp-cp-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className={'erp-cp-dialog' + (className ? ' ' + className : '')}>
        <header>
          <h3>{title}</h3>
          <button type="button" aria-label="Fechar" onClick={onClose}>
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
