import type { HelpArticle } from '../../help-center/domain/help-articles.js';

export interface EditableArticle extends HelpArticle {
  revision?: number;
}

export interface ArticleForm {
  title: string;
  category: string;
  summary: string;
  keywords: string;
  steps: string;
  warning: string;
  module: string;
  status: 'draft' | 'published';
}

export interface ArticlePayload extends Omit<ArticleForm, 'steps'> {
  steps: string[];
}

export const EDITOR_LIST_LIMIT = 100;

export function emptyArticleForm(category: string): ArticleForm {
  return {
    title: '',
    category,
    summary: '',
    keywords: '',
    steps: '',
    warning: '',
    module: '',
    status: 'draft',
  };
}

export function articleToForm(article: EditableArticle | undefined, fallbackCategory: string): ArticleForm {
  if (!article) return emptyArticleForm(fallbackCategory);
  return {
    title: article.title ?? '',
    category: article.category || fallbackCategory,
    summary: article.summary ?? '',
    keywords: article.keywords ?? '',
    steps: (article.steps ?? []).join('\n'),
    warning: article.warning ?? '',
    module: article.module ?? '',
    status: article.status === 'published' ? 'published' : 'draft',
  };
}

export function formToPayload(form: ArticleForm): ArticlePayload {
  return {
    ...form,
    steps: form.steps
      .split('\n')
      .map((step) => step.trim())
      .filter(Boolean),
  };
}

export function editorArticles(raw: unknown): EditableArticle[] {
  const list = raw && typeof raw === 'object' ? (raw as { articles?: unknown }).articles : undefined;
  return Array.isArray(list)
    ? (list.filter((item) => item && typeof item === 'object') as EditableArticle[])
    : [];
}

export function filterEditorArticles(articles: readonly EditableArticle[], query: string): EditableArticle[] {
  const term = query.trim().toLowerCase();
  return articles
    .filter((article) =>
      [article.title, article.summary, article.category].join(' ').toLowerCase().includes(term),
    )
    .slice(0, EDITOR_LIST_LIMIT);
}
