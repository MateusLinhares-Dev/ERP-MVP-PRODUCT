interface HeaderProps {
  initial: string;
  showSignOut: boolean;
  onSignOut(): void;
}

export function Header({ initial, showSignOut, onSignOut }: HeaderProps) {
  return (
    <header className="header">
      <div className="hdr-brand">
        <img
          className="brand-logo-img"
          src="/assets/branding/manuela-metais-symbol.png"
          alt=""
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
        <div>
          <div className="hdr-logo">
            Manuela <span>Metais</span>
          </div>
          <div className="hdr-sub">Lançamento rápido</div>
        </div>
      </div>
      <div className="hdr-user">
        {initial ? (
          <div className="hdr-avatar" aria-hidden="true">
            {initial}
          </div>
        ) : null}
        {showSignOut ? (
          <button type="button" className="btn-out" onClick={onSignOut}>
            Sair
          </button>
        ) : null}
      </div>
    </header>
  );
}
