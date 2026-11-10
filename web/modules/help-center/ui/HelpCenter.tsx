import { useEffect, useMemo, useRef, useState } from 'react';
import { messageOf } from '../../../shared/domain/errors.js';
import {
  ALL_CATEGORIES,
  HELP_CATEGORIES,
  HELP_PAGE_SIZE,
  articleText,
  categoryLabel,
  publishedArticles,
  searchArticles,
} from '../domain/help-articles.js';
import type { HelpArticle } from '../domain/help-articles.js';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; articles: HelpArticle[] }
  | { status: 'failed'; message: string };

interface HelpCenterProps {
  load(): Promise<unknown>;
  canOpenModule(module: string): boolean;
  openModule(module: string): void;
}

const NO_ARTICLES: HelpArticle[] = [];

function ArticleDetail({
  article,
  canOpenModule,
  openModule,
}: { article: HelpArticle } & Omit<HelpCenterProps, 'load'>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [article.id]);
  const module = article.module ?? '';
  return (
    <div id="mm-help-article-detail" className="mm-help-detail" ref={ref}>
      <div className="mm-help-detail-head">
        <span className="mm-help-article-type">{categoryLabel(article.category, 'Artigo')}</span>
        <h2>{article.title}</h2>
        <p>{article.summary}</p>
      </div>
      <div className="mm-help-guide">
        <h3>Passo a passo</h3>
        <ol>
          {(article.steps ?? []).map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
        {article.warning ? (
          <div className="mm-help-warning">
            <strong>Atenção</strong>
            <p>{article.warning}</p>
          </div>
        ) : null}
      </div>
      {module && canOpenModule(module) ? (
        <button type="button" className="mm-help-open-module" onClick={() => openModule(module)}>
          Abrir módulo
        </button>
      ) : null}
      <button
        type="button"
        className="mm-help-copy"
        onClick={() => {
          navigator.clipboard?.writeText(articleText(article)).catch(() => undefined);
        }}
      >
        Copiar orientação
      </button>
    </div>
  );
}

export function HelpCenter({ load, canOpenModule, openModule }: HelpCenterProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    load().then(
      (data) => {
        if (active) setState({ status: 'ready', articles: publishedArticles(data) });
      },
      (error: unknown) => {
        if (active)
          setState({ status: 'failed', message: messageOf(error, 'Não foi possível carregar os artigos.') });
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const articles = state.status === 'ready' ? state.articles : NO_ARTICLES;
  const found = useMemo(() => searchArticles(articles, query, category), [articles, query, category]);
  const pages = Math.max(1, Math.ceil(found.length / HELP_PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = found.slice((current - 1) * HELP_PAGE_SIZE, current * HELP_PAGE_SIZE);
  const detail = found.find((article) => article.id === selected) ?? null;

  const chooseCategory = (next: string, scroll: boolean) => {
    setCategory(next);
    setPage(1);
    setSelected('');
    if (scroll)
      requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  return (
    <>
      <div className="mm-help-hero">
        <div className="mm-help-hero-copy">
          <span className="mm-help-eyebrow">CENTRAL DE CONHECIMENTO · MANUELA METAIS</span>
          <h1>Como podemos ajudar?</h1>
          <p>Pesquise instruções e procedimentos publicados pela equipe responsável pelo ERP.</p>
          <label className="mm-help-searchbox">
            <span aria-hidden="true">⌕</span>
            <input
              id="mm-help-search"
              type="search"
              placeholder="Pesquisar dúvida, módulo ou procedimento"
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
                setSelected('');
              }}
            />
          </label>
        </div>
        <div className="mm-help-hero-illustration">
          <span className="mm-help-hero-circle" aria-hidden="true">
            ?
          </span>
        </div>
      </div>
      <div className="mm-help-home-content">
        <div className="mm-help-section-heading">
          <div>
            <span className="mm-help-kicker">BIBLIOTECA INTERNA</span>
            <h2>Explore por assunto</h2>
            <p>Os conteúdos aparecerão à medida que forem publicados pela engenharia.</p>
          </div>
          <span id="mm-help-total" className="mm-help-count">
            {articles.length} artigo(s) publicado(s)
          </span>
        </div>
        <div className="mm-help-category-grid">
          {HELP_CATEGORIES.map((item) => (
            <button
              key={item.id}
              className="mm-help-category"
              type="button"
              data-category={item.id}
              onClick={() => chooseCategory(item.id, true)}
            >
              <span className="mm-help-category-icon">▤</span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="mm-help-section-heading">
          <div>
            <span className="mm-help-kicker">ARTIGOS PUBLICADOS</span>
            <h2>Guias e orientações</h2>
          </div>
        </div>
        <div className="mm-help-filter-row">
          <label>
            Categoria{' '}
            <select
              id="mm-help-category"
              value={category}
              onChange={(event) => chooseCategory(event.target.value, false)}
            >
              <option value={ALL_CATEGORIES}>Todas as categorias</option>
              {HELP_CATEGORIES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div id="mm-help-list" className="mm-help-recommend-grid" aria-live="polite" ref={listRef}>
          {state.status === 'loading' ? (
            <p className="mm-help-empty">Carregando artigos publicados...</p>
          ) : null}
          {state.status === 'failed' ? (
            <div className="mm-help-empty">
              <h3>Ajuda indisponível</h3>
              <p>{state.message}</p>
            </div>
          ) : null}
          {state.status === 'ready' && visible.length
            ? visible.map((article) => (
                <button
                  key={article.id}
                  type="button"
                  className="mm-help-article"
                  data-article={article.id}
                  onClick={() => setSelected(article.id)}
                >
                  <span className="mm-help-article-icon">?</span>
                  <span className="mm-help-article-text">
                    <span className="mm-help-article-type">{categoryLabel(article.category, 'Guia')}</span>
                    <strong>{article.title}</strong>
                    <small>{article.summary}</small>
                  </span>
                </button>
              ))
            : null}
          {state.status === 'ready' && !visible.length ? (
            <div className="mm-help-empty">
              <h3>
                {articles.length
                  ? 'Nenhum artigo corresponde à pesquisa.'
                  : 'A Central de Ajuda está sendo preparada'}
              </h3>
              <p>
                {articles.length
                  ? 'Tente outros termos ou escolha outra categoria.'
                  : 'Os guias serão disponibilizados aqui após a publicação pela equipe de engenharia.'}
              </p>
            </div>
          ) : null}
        </div>
        <div id="mm-help-pagination" className="mm-help-pager">
          {found.length > HELP_PAGE_SIZE ? (
            <>
              <span>
                {found.length} resultados · página {current} de {pages}
              </span>
              <div>
                <button
                  type="button"
                  data-page="prev"
                  disabled={current === 1}
                  onClick={() => setPage(current - 1)}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  data-page="next"
                  disabled={current === pages}
                  onClick={() => setPage(current + 1)}
                >
                  Próxima
                </button>
              </div>
            </>
          ) : null}
        </div>
        {detail ? (
          <ArticleDetail article={detail} canOpenModule={canOpenModule} openModule={openModule} />
        ) : null}
      </div>
    </>
  );
}
