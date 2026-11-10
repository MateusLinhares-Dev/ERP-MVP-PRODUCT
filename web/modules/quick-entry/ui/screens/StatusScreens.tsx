import { Icon } from '../../../../shared/ui/icons.js';

export function LoadingScreen({ message, failed }: { message: string; failed: boolean }) {
  return (
    <section className="centered">
      <div className="spinner" aria-hidden="true" />
      <p className="loading-message">{message}</p>
      {failed ? (
        <button type="button" className="btn secondary" onClick={() => location.reload()}>
          Tentar de novo
        </button>
      ) : null}
    </section>
  );
}

export function BlockedScreen({ message, onSignOut }: { message: string; onSignOut(): void }) {
  return (
    <section className="centered">
      <p className="big-text">{message}</p>
      <button type="button" className="btn secondary" onClick={onSignOut}>
        Entrar com outro usuário
      </button>
    </section>
  );
}

interface SuccessScreenProps {
  message: string;
  detail: string;
  onAnother(): void;
  onHome(): void;
}

export function SuccessScreen({ message, detail, onAnother, onHome }: SuccessScreenProps) {
  return (
    <section className="centered success-screen">
      <div className="check" aria-hidden="true">
        <Icon name="check" />
      </div>
      <p className="big-text">{message}</p>
      <p className="subtitle">{detail}</p>
      <button type="button" className="btn primary large" onClick={onAnother}>
        + Fazer outro lançamento
      </button>
      <button type="button" className="btn secondary" onClick={onHome}>
        Voltar ao início
      </button>
    </section>
  );
}
