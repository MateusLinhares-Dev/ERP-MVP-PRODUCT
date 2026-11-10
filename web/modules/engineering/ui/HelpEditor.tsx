import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { messageOf } from '../../../shared/domain/errors.js';
import { HELP_CATEGORIES, categoryLabel } from '../../help-center/domain/help-articles.js';
import { articleToForm, editorArticles, filterEditorArticles, formToPayload } from '../domain/help-editor.js';
import type { ArticleForm, EditableArticle } from '../domain/help-editor.js';

interface HelpEditorProps {
  load(): Promise<unknown>;
  send(body: unknown): Promise<{ id?: string }>;
  confirmDelete(message: string): boolean;
}

const FIRST_CATEGORY = HELP_CATEGORIES[0]?.id ?? 'compras';
const PUBLISHED_MESSAGE = 'Artigo publicado! Agora aparece na Central de Ajuda dos usuários.';
const DRAFT_MESSAGE =
  'Rascunho salvo. Para aparecer aos usuários, escolha “Publicado — visível aos usuários” e salve novamente.';

export function HelpEditor({ load, send, confirmDelete }: HelpEditorProps) {
  const [articles, setArticles] = useState<EditableArticle[]>([]);
  const [listMessage, setListMessage] = useState('Carregando artigos...');
  const [reloads, setReloads] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState<ArticleForm>(() => articleToForm(undefined, FIRST_CATEGORY));
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    load().then(
      (data) => {
        if (!active) return;
        setArticles(editorArticles(data));
        setListMessage('');
      },
      (error: unknown) => {
        if (active) setListMessage(messageOf(error, 'Não foi possível carregar os artigos.'));
      },
    );
    return () => {
      active = false;
    };
  }, [load, reloads]);

  const visible = useMemo(() => filterEditorArticles(articles, query), [articles, query]);
  const current = articles.find((article) => article.id === selected);
  const published = form.status === 'published';

  const select = (id: string) => {
    setSelected(id);
    setForm(
      articleToForm(
        articles.find((article) => article.id === id),
        FIRST_CATEGORY,
      ),
    );
    setMessage('');
  };
  const field = (key: keyof ArticleForm) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const save = async (status: ArticleForm['status']) => {
    if (saving) return;
    const payload = formToPayload({ ...form, status });
    setForm((previous) => ({ ...previous, status }));
    setSaving(true);
    setMessage('Validando e registrando...');
    try {
      const result = await send({
        action: 'save',
        id: selected || undefined,
        revision: current?.revision ?? 0,
        article: payload,
      });
      if (result.id) setSelected(result.id);
      setReloads((count) => count + 1);
      setMessage(status === 'published' ? PUBLISHED_MESSAGE : DRAFT_MESSAGE);
    } catch (error) {
      setMessage(messageOf(error, 'Não foi possível salvar o artigo.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (saving || !current || !confirmDelete('Excluir permanentemente este artigo?')) return;
    setSaving(true);
    try {
      await send({ action: 'delete', id: current.id, revision: current.revision });
      setSelected('');
      setForm(articleToForm(undefined, FIRST_CATEGORY));
      setMessage('');
      setReloads((count) => count + 1);
    } catch (error) {
      setMessage(messageOf(error, 'Não foi possível excluir o artigo.'));
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save(form.status);
  };

  return (
    <>
      <header className="mm-eng-hero">
        <div>
          <small>ENGENHARIA · BASE DE CONHECIMENTO</small>
          <h1>Gestão da Central de Ajuda</h1>
          <p>
            Crie, revise e publique guias reais do ERP. Rascunhos são privados; apenas artigos publicados
            aparecem para os funcionários.
          </p>
        </div>
        <button type="button" id="eng-help-refresh" onClick={() => setReloads((count) => count + 1)}>
          Atualizar
        </button>
      </header>
      <div className="mm-eng-editor-layout">
        <section className="mm-eng-card">
          <div className="mm-eng-row">
            <h2>Artigos</h2>
            <button type="button" className="mm-eng-primary" id="eng-help-new" onClick={() => select('')}>
              + Novo artigo
            </button>
          </div>
          <input
            id="eng-help-find"
            placeholder="Buscar artigo"
            aria-label="Buscar artigo"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div id="eng-help-list" className="mm-eng-help-list">
            {listMessage ||
              (visible.length ? (
                visible.map((article) => (
                  <button
                    key={article.id}
                    type="button"
                    className={article.id === selected ? 'chosen' : ''}
                    data-article={article.id}
                    onClick={() => select(article.id)}
                  >
                    <strong>{article.title}</strong>
                    <small>
                      {categoryLabel(article.category, '')} ·{' '}
                      {article.status === 'published' ? 'Publicado' : 'Rascunho'}
                    </small>
                  </button>
                ))
              ) : (
                <div className="mm-eng-empty">Nenhum artigo cadastrado. Use “Novo artigo”.</div>
              ))}
          </div>
        </section>
        <section className="mm-eng-card">
          <div className="mm-eng-row">
            <div>
              <h2 id="eng-edit-title">{selected ? 'Editar artigo' : 'Novo artigo'}</h2>
              <p>Texto simples: scripts e HTML não são executados.</p>
            </div>
            <span id="eng-edit-status">{current?.status === 'published' ? 'Publicado' : 'Rascunho'}</span>
          </div>
          <form id="eng-help-form" onSubmit={submit}>
            <div className="mm-eng-form-grid">
              <label>
                Título
                <input
                  name="title"
                  maxLength={130}
                  required
                  value={form.title}
                  onChange={(e) => field('title')(e.target.value)}
                />
              </label>
              <label>
                Categoria
                <select
                  name="category"
                  value={form.category}
                  onChange={(e) => field('category')(e.target.value)}
                >
                  {HELP_CATEGORIES.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Resumo
              <textarea
                name="summary"
                rows={2}
                maxLength={300}
                required
                value={form.summary}
                onChange={(e) => field('summary')(e.target.value)}
              />
            </label>
            <label>
              Palavras-chave (opcional)
              <input
                name="keywords"
                maxLength={260}
                value={form.keywords}
                onChange={(e) => field('keywords')(e.target.value)}
              />
            </label>
            <label>
              Passo a passo (um passo por linha)
              <textarea
                name="steps"
                rows={7}
                maxLength={10500}
                placeholder={'1º passo...\n2º passo...'}
                value={form.steps}
                onChange={(e) => field('steps')(e.target.value)}
              />
            </label>
            <label>
              Cuidados e avisos
              <textarea
                name="warning"
                rows={3}
                maxLength={500}
                value={form.warning}
                onChange={(e) => field('warning')(e.target.value)}
              />
            </label>
            <div className="mm-eng-form-grid">
              <label>
                Módulo correspondente (opcional)
                <input
                  name="module"
                  maxLength={60}
                  placeholder="Ex.: fiscal"
                  value={form.module}
                  onChange={(e) => field('module')(e.target.value)}
                />
              </label>
              <label>
                Publicação
                <select name="status" value={form.status} onChange={(e) => field('status')(e.target.value)}>
                  <option value="draft">Rascunho — privado</option>
                  <option value="published">Publicado — visível aos usuários</option>
                </select>
              </label>
            </div>
            <p
              className={published ? 'mm-eng-publication-hint published' : 'mm-eng-publication-hint'}
              id="eng-help-publication-hint"
              role="status"
            >
              {published
                ? 'Ao salvar, este artigo ficará visível aos usuários na Central de Ajuda.'
                : 'Este artigo está em rascunho. Apenas a engenharia pode visualizá-lo.'}
            </p>
            <div className="mm-eng-row">
              <span role="status" id="eng-help-message">
                {message}
              </span>
              <div>
                {selected ? (
                  <button
                    type="button"
                    className="mm-eng-danger"
                    id="eng-help-delete"
                    disabled={saving}
                    onClick={() => void remove()}
                  >
                    Excluir
                  </button>
                ) : null}
                <button
                  type="button"
                  className="mm-eng-primary"
                  id="eng-help-publish"
                  disabled={saving}
                  onClick={() => void save('published')}
                >
                  Publicar artigo
                </button>
                <button type="submit" className="mm-eng-primary" id="eng-help-save" disabled={saving}>
                  {saving ? 'Salvando...' : 'Salvar artigo'}
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
