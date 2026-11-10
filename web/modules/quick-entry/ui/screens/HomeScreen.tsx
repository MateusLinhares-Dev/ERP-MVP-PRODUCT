import { Icon } from '../../../../shared/ui/icons.js';
import type { EntryKind } from '../../domain/contracts.js';

interface HomeScreenProps {
  displayName: string;
  showErpLink: boolean;
  onNew(kind: EntryKind): void;
  onHistory(): void;
}

export function HomeScreen({ displayName, showErpLink, onNew, onHistory }: HomeScreenProps) {
  return (
    <section className="home-screen">
      <div className="welcome">
        <div className="welcome-avatar" aria-hidden="true">
          {(displayName || '?').charAt(0)}
        </div>
        <div>
          <h1 className="greeting">Olá, {displayName}!</h1>
          <p className="subtitle">O que você quer lançar agora?</p>
        </div>
      </div>
      <div className="actions">
        <button type="button" className="action-card" onClick={() => onNew('compra')}>
          <span className="action-icon">
            <Icon name="cart" />
          </span>
          <span className="action-text">
            <strong>Compra</strong>
            <small>Comprei material de um fornecedor</small>
          </span>
          <Icon name="chevron" className="action-arrow" />
        </button>
        <button type="button" className="action-card" onClick={() => onNew('venda')}>
          <span className="action-icon sale">
            <Icon name="currency" />
          </span>
          <span className="action-text">
            <strong>Venda</strong>
            <small>Vendi material para um cliente</small>
          </span>
          <Icon name="chevron" className="action-arrow" />
        </button>
      </div>
      <button type="button" className="btn secondary with-icon" onClick={onHistory}>
        <Icon name="list" />
        Meus lançamentos
      </button>
      {showErpLink ? (
        <a className="erp-link" href="/?completo=1">
          Abrir o sistema completo
        </a>
      ) : null}
    </section>
  );
}
