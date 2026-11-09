import { randomUUID } from 'node:crypto';
import { hasControlChars } from '../../../shared/domain/text.js';
import { AppError } from '../../../shared/errors/app-error.js';

export interface HelpArticle {
  title: string;
  summary: string;
  category: string;
  keywords: string;
  steps: string[];
  warning: string;
  status: 'published' | 'draft';
  module: string;
}

export interface StoredHelpArticle extends HelpArticle {
  id: string;
  revision: number;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

const CATEGORIES = [
  'compras',
  'comercial',
  'fiscal',
  'financeiro',
  'estoque',
  'pessoas',
  'gestao',
  'seguranca',
];

const bad = (message: string, code = 'INVALID_HELP_ARTICLE', status = 400): AppError =>
  new AppError(status, code, message);

const clean = (value: unknown, max: number, required = false): string => {
  const text = String(value ?? '').trim();
  if (text.length > max || hasControlChars(text) || (required && !text)) {
    throw bad(`Campo inválido (máximo ${max} caracteres).`);
  }
  return text;
};

export function validateArticle(value: unknown = {}): HelpArticle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad('Artigo inválido.');
  const raw = value as Record<string, unknown>;
  const category = clean(raw.category, 40, true);
  if (!CATEGORIES.includes(category)) throw bad('Categoria inválida.');
  const steps = raw.steps;
  if (!Array.isArray(steps) || steps.length > 20) throw bad('Informe até 20 passos.');
  const article: HelpArticle = {
    title: clean(raw.title, 130, true),
    summary: clean(raw.summary, 300, true),
    category,
    keywords: clean(raw.keywords, 260),
    steps: steps.map((step: unknown) => clean(step, 500, true)),
    warning: clean(raw.warning, 500),
    status: raw.status === 'published' ? 'published' : 'draft',
    module: clean(raw.module, 60),
  };
  if (article.status === 'published' && article.steps.length === 0) {
    throw bad('Para publicar, inclua ao menos um passo.');
  }
  return article;
}

export function newArticleId(): string {
  return 'h_' + randomUUID().replace(/-/g, '');
}

export function validateArticleId(id: unknown): string {
  const value = String(id || '');
  if (!/^h_[a-f0-9]{32}$/.test(value)) throw bad('Identificador inválido.');
  return value;
}

export function assertRevision(current: { revision?: number } | null | undefined, expected: number): void {
  if (current && current.revision !== expected) {
    throw bad('Outro usuário atualizou o artigo. Recarregue antes de salvar.', 'REVISION_CONFLICT', 409);
  }
}

export function categoryOptions(): string[] {
  return [...CATEGORIES];
}
