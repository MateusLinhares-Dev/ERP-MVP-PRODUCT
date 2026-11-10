export type RoutedScreen = 'home' | 'entry' | 'review' | 'success' | 'history';

const HASH_OF: Readonly<Record<RoutedScreen, string>> = Object.freeze({
  home: 'inicio',
  entry: 'lancamento',
  review: 'conferir',
  success: 'sucesso',
  history: 'historico',
});

export function screenOfHash(value: unknown): RoutedScreen | null {
  const hash = String(value ?? '').replace(/^#/, '');
  const match = (Object.keys(HASH_OF) as RoutedScreen[]).find((screen) => HASH_OF[screen] === hash);
  return match ?? null;
}

export function screenOfState(state: unknown): RoutedScreen | null {
  if (!state || typeof state !== 'object') return null;
  return screenOfHash((state as { tela?: unknown }).tela);
}

export function recordScreen(screen: RoutedScreen, replace = false): void {
  const tela = HASH_OF[screen];
  if (replace) history.replaceState({ tela }, '', `#${tela}`);
  else history.pushState({ tela }, '', `#${tela}`);
}
