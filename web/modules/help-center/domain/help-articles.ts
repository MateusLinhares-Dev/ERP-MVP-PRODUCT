import { foldAccents } from '../../../shared/domain/text.js';

export interface HelpCategory {
  id: string;
  label: string;
  description: string;
}

export interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  category: string;
  keywords?: string;
  steps?: string[];
  warning?: string;
  module?: string;
  status?: string;
}

export const ALL_CATEGORIES = 'todos';
export const HELP_PAGE_SIZE = 8;

export const HELP_CATEGORIES: readonly HelpCategory[] = Object.freeze([
  { id: 'compras', label: 'Compras e pesagem', description: 'Recebimento e canhotos' },
  { id: 'comercial', label: 'Clientes e vendas', description: 'Pedidos e faturamento' },
  { id: 'fiscal', label: 'Fiscal', description: 'Notas e apuração' },
  { id: 'financeiro', label: 'Financeiro', description: 'Pagamentos e recebimentos' },
  { id: 'estoque', label: 'Estoque e almoxarifado', description: 'Materiais e movimentações' },
  { id: 'pessoas', label: 'Equipe e capacitações', description: 'RH e certificados' },
  { id: 'gestao', label: 'Gestão e contratos', description: 'Contratos e vencimentos' },
  { id: 'seguranca', label: 'Acesso e segurança', description: 'Usuários e problemas' },
]);

export function categoryLabel(id: string, fallback: string): string {
  return HELP_CATEGORIES.find((category) => category.id === id)?.label ?? fallback;
}

export function publishedArticles(raw: unknown): HelpArticle[] {
  const list = raw && typeof raw === 'object' ? (raw as { articles?: unknown }).articles : undefined;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is HelpArticle =>
      Boolean(item) && typeof item === 'object' && (item as HelpArticle).status === 'published',
  );
}

export function searchArticles(
  articles: readonly HelpArticle[],
  text = '',
  category = ALL_CATEGORIES,
): HelpArticle[] {
  const words = foldAccents(text).split(/\s+/).filter(Boolean);
  return articles.filter((article) => {
    if (category !== ALL_CATEGORIES && article.category !== category) return false;
    const haystack = foldAccents(
      [article.title, article.summary, article.keywords, ...(article.steps ?? [])].join(' '),
    );
    return words.every((word) => haystack.includes(word));
  });
}

export function articleText(article: HelpArticle): string {
  return [article.title, article.summary, ...(article.steps ?? [])].join('\n');
}
