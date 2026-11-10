export type IconName =
  | 'cart'
  | 'currency'
  | 'list'
  | 'mic'
  | 'camera'
  | 'clip'
  | 'chevron'
  | 'back'
  | 'check'
  | 'spark';

export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <symbol id="i-cart" viewBox="0 0 24 24">
        <circle cx="9" cy="20" r="1.5" />
        <circle cx="18" cy="20" r="1.5" />
        <path d="M3 4h2l2.2 10.2a1 1 0 0 0 1 .8h9.8a1 1 0 0 0 1-.8L21 7H7" />
      </symbol>
      <symbol id="i-currency" viewBox="0 0 24 24">
        <path d="M12 2v20" />
        <path d="M17 6.5c0-1.7-2.2-3-5-3s-5 1.3-5 3 1.5 2.6 5 3 5 1.3 5 3-2.2 3-5 3-5-1.3-5-3" />
      </symbol>
      <symbol id="i-list" viewBox="0 0 24 24">
        <rect x="6" y="4" width="12" height="17" rx="2" />
        <path d="M9 4.5h6" />
        <path d="M9 10h6" />
        <path d="M9 14h6" />
      </symbol>
      <symbol id="i-mic" viewBox="0 0 24 24">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
        <path d="M8 21h8" />
      </symbol>
      <symbol id="i-camera" viewBox="0 0 24 24">
        <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
        <circle cx="12" cy="13.5" r="3.5" />
      </symbol>
      <symbol id="i-clip" viewBox="0 0 24 24">
        <path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
      </symbol>
      <symbol id="i-chevron" viewBox="0 0 24 24">
        <path d="M9 6l6 6-6 6" />
      </symbol>
      <symbol id="i-back" viewBox="0 0 24 24">
        <path d="M15 6l-6 6 6 6" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </symbol>
      <symbol id="i-spark" viewBox="0 0 24 24">
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      </symbol>
    </svg>
  );
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
