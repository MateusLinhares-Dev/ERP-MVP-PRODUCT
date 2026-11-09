import type { App } from 'firebase-admin/app';
import type { Database } from 'firebase-admin/database';
import type { Identity } from '../../../shared/auth/identity.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { recordAuditSafely } from '../../audit/infrastructure/audit-repository.js';
import { newArticleId, validateArticle, validateArticleId } from '../domain/help-article.js';
import {
  firebaseArticleTransport,
  mutateHelpArticle,
  type ArticleTransport,
} from './help-article-mutation.js';

export interface HelpCenterDeps {
  db: Pick<Database, 'ref'>;
  transport?: () => Promise<ArticleTransport>;
}

interface ArticleRow {
  id: string;
  title?: unknown;
  status?: unknown;
  createdBy?: unknown;
  updatedBy?: unknown;
  [field: string]: unknown;
}

const fail = (message: string, status = 400, code = 'HELP_ERROR'): AppError =>
  new AppError(status, code, message);

const rows = (value: unknown): ArticleRow[] =>
  Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {})
    .map(([id, article]: [string, unknown]) => ({
      ...(article && typeof article === 'object' ? article : {}),
      id,
    }))
    .filter((article) => typeof article === 'object');

export const isHelpEditor = (identity: Identity): boolean =>
  identity.engineer === true && identity.erpUser === 'engadministrator';

export function defaultArticleTransport(app: App): () => Promise<ArticleTransport> {
  return () =>
    firebaseArticleTransport({
      app,
      projectId: String(process.env.FIREBASE_PROJECT_ID || ''),
      databaseUrl: String(process.env.FIREBASE_DATABASE_URL || ''),
    });
}

export async function listHelpArticles(deps: HelpCenterDeps, identity: Identity) {
  const editor = isHelpEditor(identity);
  const all = rows((await deps.db.ref('erpHelp/articles').get()).val());
  return {
    articles: all
      .filter((article) => editor || article.status === 'published')
      .map((article) => ({
        ...article,
        createdBy: editor ? article.createdBy : undefined,
        updatedBy: editor ? article.updatedBy : undefined,
      }))
      .sort((a, b) => String(a.title).localeCompare(String(b.title), 'pt-BR')),
    editor,
  };
}

export async function changeHelpArticle(
  deps: HelpCenterDeps,
  identity: Identity,
  body: Record<string, unknown>,
) {
  const action = String(body.action || '');
  if (action !== 'save' && action !== 'delete') throw fail('Ação inválida.');
  const id = body.id ? validateArticleId(body.id) : newArticleId();
  if (action === 'delete' && !body.id) throw fail('Selecione o artigo.');
  const expected = Number(body.revision || 0);
  if (!Number.isSafeInteger(expected) || expected < 0) throw fail('Revisão inválida.');
  const article = action === 'save' ? validateArticle(body.article) : null;
  if (!deps.transport) throw fail('Armazenamento da ajuda indisponível.', 503, 'HELP_STORE_UNAVAILABLE');
  const result = await mutateHelpArticle(await deps.transport(), {
    action,
    id,
    existing: Boolean(body.id),
    revision: expected,
    article,
    actor: String(identity.erpUser),
  });
  if (result.outcome === 'conflict') {
    throw fail(
      'Este artigo foi alterado em outra sessão. Atualize a lista para continuar.',
      409,
      'REVISION_CONFLICT',
    );
  }
  if (result.outcome === 'not_found') {
    throw fail(
      'O artigo realmente não existe no Firebase. Atualize a lista e selecione novamente.',
      404,
      'ARTICLE_NOT_FOUND',
    );
  }
  await recordAuditSafely({
    actorUid: identity.uid,
    actorLogin: identity.erpUser,
    action: action === 'delete' ? 'help_deleted' : 'help_saved',
    module: 'help_center',
    entityType: 'article',
    entityId: id,
  });
  return { ok: true, id, article: result.article };
}
