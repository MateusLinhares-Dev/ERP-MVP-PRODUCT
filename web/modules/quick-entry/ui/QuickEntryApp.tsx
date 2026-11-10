import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { goToLogin, signOutAndLeave } from '../../../shared/auth/firebase-session.js';
import type { SessionAuth } from '../../../shared/auth/firebase-session.js';
import { messageOf } from '../../../shared/domain/errors.js';
import { formatMoney } from '../../../shared/domain/format.js';
import { newId } from '../../../shared/domain/ids.js';
import { IconSprite } from '../../../shared/ui/icons.js';
import { Toast } from '../../../shared/ui/Toast.js';
import { useToast } from '../../../shared/ui/use-toast.js';
import { prepareFile, toBase64 } from '../application/attachment-files.js';
import { interpretEntry } from '../application/quick-entry-api.js';
import { recordScreen, screenOfHash, screenOfState } from '../application/screen-history.js';
import type { RoutedScreen } from '../application/screen-history.js';
import { BLOCKED_MESSAGE, startSession } from '../application/session.js';
import type { ReadySession } from '../application/session.js';
import { useSpeechRecognition } from '../application/use-speech-recognition.js';
import type { EntryKind } from '../domain/contracts.js';
import {
  DEFAULT_ATTACHMENT_LIMIT,
  applyInterpretation,
  createDraft,
  hasContent,
  isPurchase,
  isUnderstood,
  reopenDraft,
  spokenKindOf,
  validateDraft,
} from '../domain/entry-draft.js';
import type { AttachmentDraft, EntryDraft } from '../domain/entry-draft.js';
import { Header } from './Header.js';
import { EntryScreen } from './screens/EntryScreen.js';
import { HistoryScreen } from './screens/HistoryScreen.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { ReviewScreen } from './screens/ReviewScreen.js';
import { BlockedScreen, LoadingScreen, SuccessScreen } from './screens/StatusScreens.js';

type Screen = 'loading' | 'blocked' | RoutedScreen;
type Drafts = Readonly<Record<EntryKind, EntryDraft | null>>;
type DraftChange = (draft: EntryDraft) => EntryDraft;

const SAVE_LABEL = 'Está certo, SALVAR';
const SAVING_LABEL = 'Salvando… não feche';
const RETRYING_LABEL = 'A conexão oscilou, tentando de novo…';
const UNSUPPORTED_SPEECH =
  'Este navegador não reconhece voz. Toque no campo de texto e use o microfone do teclado.';

function withDraft(drafts: Drafts, kind: EntryKind, draft: EntryDraft | null): Drafts {
  return kind === 'compra' ? { ...drafts, compra: draft } : { ...drafts, venda: draft };
}

function successText(kind: EntryKind, referencia: string, parte: string, total: number) {
  const purchase = isPurchase(kind);
  return {
    message: purchase ? `Compra ${referencia} lançada!` : 'Venda lançada!',
    detail: `${parte} — ${formatMoney(total)}${purchase ? ' · conta a pagar gerada' : ' · conta a receber gerada'}`,
  };
}

export function QuickEntryApp() {
  const { toast, notify, dismiss } = useToast();
  const [screen, setScreen] = useState<Screen>('loading');
  const [loadingMessage, setLoadingMessage] = useState('Carregando…');
  const [bootFailed, setBootFailed] = useState(false);
  const [auth, setAuth] = useState<SessionAuth | null>(null);
  const [session, setSession] = useState<ReadySession | null>(null);
  const [kind, setKind] = useState<EntryKind>('compra');
  const [drafts, setDrafts] = useState<Drafts>({ compra: null, venda: null });
  const [lastSaved, setLastSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState(SAVE_LABEL);
  const [understanding, setUnderstanding] = useState(false);
  const [success, setSuccess] = useState({ message: '', detail: '' });
  const savingNow = useRef(false);
  const draft = drafts[kind];

  const show = useCallback(
    (next: Screen) => {
      dismiss();
      setScreen(next);
    },
    [dismiss],
  );

  const go = useCallback(
    (next: RoutedScreen, replace = false) => {
      recordScreen(next, replace);
      show(next);
    },
    [show],
  );

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  useEffect(() => {
    let active = true;
    startSession({
      onSignedIn: (signedIn) => {
        if (active) setAuth(signedIn);
      },
      onLoadingCatalog: () => {
        if (active) setLoadingMessage('Buscando fornecedores, clientes e materiais…');
      },
    }).then(
      (result) => {
        if (!active) return;
        if (result.status === 'signed-out') {
          goToLogin();
          return;
        }
        if (result.status === 'blocked') {
          setScreen('blocked');
          return;
        }
        const wantsHistory = screenOfHash(location.hash) === 'history';
        setSession(result.session);
        recordScreen('home', true);
        setScreen('home');
        if (wantsHistory) {
          recordScreen('history');
          setScreen('history');
        }
      },
      (error: unknown) => {
        if (!active) return;
        console.error('[rapido] iniciar', error);
        setLoadingMessage(messageOf(error, 'Não foi possível abrir. Verifique a internet.'));
        setBootFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (!session) return;
      if (savingNow.current) {
        recordScreen('review');
        return;
      }
      const target = screenOfState(event.state) ?? 'home';
      const current = drafts[kind];
      const leavesFlow = target === 'entry' || target === 'review';
      if ((leavesFlow && (lastSaved || !current)) || (target === 'success' && !success.message)) {
        recordScreen('home', true);
        show('home');
        return;
      }
      if (target === 'review' && current && validateDraft(current).problems.length) {
        recordScreen('entry', true);
        show('entry');
        return;
      }
      show(target);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [session, drafts, kind, lastSaved, success.message, show]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const unsaved = screen === 'entry' && !lastSaved && draft !== null && hasContent(draft);
      if (!savingNow.current && !unsaved) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [screen, lastSaved, draft]);

  const updateDraft = useCallback((target: EntryKind, change: DraftChange) => {
    setDrafts((previous) => {
      const current = previous[target];
      return current ? withDraft(previous, target, change(current)) : previous;
    });
  }, []);

  const changeCurrent = useCallback((change: DraftChange) => updateDraft(kind, change), [kind, updateDraft]);

  const openEntry = useCallback(
    (next: EntryKind) => {
      if (!session) return;
      const today = session.options.today;
      setLastSaved(false);
      setKind(next);
      setDrafts((previous) => {
        const existing = previous[next];
        return withDraft(previous, next, existing ? reopenDraft(existing) : createDraft(next, today, newId));
      });
      go('entry');
    },
    [session, go],
  );

  const understand = useCallback(
    async (spokenText?: string) => {
      if (!session) return;
      const text = (spokenText ?? drafts[kind]?.spokenText ?? '').trim();
      if (!text) {
        notify('Fale ou escreva o lançamento primeiro.');
        return;
      }
      const { api, options } = session;
      setUnderstanding(true);
      try {
        const first = await interpretEntry(api, options, text, kind);
        const spoken = spokenKindOf(first);
        const switched = spoken && spoken !== kind ? spoken : null;
        const target = switched ?? kind;
        const result = switched ? await interpretEntry(api, options, text, switched) : first;
        setDrafts((previous) => {
          const base = switched
            ? { ...createDraft(switched, options.today, newId), spokenText: text }
            : previous[target];
          return base
            ? withDraft(previous, target, applyInterpretation(base, result, options, newId))
            : previous;
        });
        if (switched) {
          setKind(switched);
          setLastSaved(false);
          notify(
            `Você falou em ${switched}: mudei para ${switched.toUpperCase()}. Confira os campos em amarelo.`,
            'success',
            6000,
          );
        } else if (isUnderstood(result)) notify('Pronto! Confira os campos em amarelo.', 'success');
        else notify('Não consegui entender. Veja as dicas no quadro amarelo.', 'error');
      } catch (error) {
        notify(messageOf(error, 'Não consegui entender. Tente de novo.'), 'error');
      } finally {
        setUnderstanding(false);
      }
    },
    [session, drafts, kind, notify],
  );

  const speech = useSpeechRecognition({
    onText: (text) => updateDraft(kind, (current) => ({ ...current, spokenText: text })),
    onFinished: (text) => {
      void understand(text);
    },
    onError: (message) => notify(message, 'error', 6000),
  });

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!session) return;
      const target = kind;
      const limit = session.options.limits?.attachments || DEFAULT_ATTACHMENT_LIMIT;
      let count = drafts[target]?.attachments.length ?? 0;
      const patch = (localId: string, change: Partial<AttachmentDraft>) =>
        updateDraft(target, (current) => ({
          ...current,
          attachments: current.attachments.map((attachment) =>
            attachment.localId === localId ? { ...attachment, ...change } : attachment,
          ),
        }));
      for (const file of files) {
        if (count >= limit) {
          notify(`Máximo de ${limit} anexos por lançamento.`, 'error');
          break;
        }
        count++;
        const pending: AttachmentDraft = {
          localId: newId(),
          nome: file.name || 'arquivo',
          status: 'Preparando…',
          preview: '',
          failed: false,
          ref: null,
        };
        updateDraft(target, (current) => ({ ...current, attachments: [...current.attachments, pending] }));
        try {
          const prepared = await prepareFile(file);
          const preview = prepared.tipo.startsWith('image/') ? URL.createObjectURL(prepared.blob) : '';
          patch(pending.localId, { nome: prepared.nome, status: 'Enviando…', preview });
          const { anexo } = await session.api.uploadAttachment({
            nome: prepared.nome,
            tipo: prepared.tipo,
            conteudo: await toBase64(prepared.blob),
          });
          patch(pending.localId, { ref: anexo, nome: anexo.nome, status: 'Enviado' });
        } catch (error) {
          patch(pending.localId, { status: `Falhou: ${messageOf(error, 'erro')}`, failed: true });
        }
      }
    },
    [session, drafts, kind, notify, updateDraft],
  );

  const removeAttachment = useCallback(
    (localId: string) => {
      const removed = drafts[kind]?.attachments.find((item) => item.localId === localId);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      updateDraft(kind, (current) => ({
        ...current,
        attachments: current.attachments.filter((attachment) => attachment.localId !== localId),
      }));
    },
    [drafts, kind, updateDraft],
  );

  const review = useCallback((): boolean => {
    if (!draft) return false;
    const { problems, invalid } = validateDraft(draft);
    if (problems.length) {
      updateDraft(kind, (current) => ({ ...current, doubts: problems, invalid }));
      notify('Falta preencher algumas coisas.', 'error');
      return false;
    }
    go('review');
    return true;
  }, [draft, kind, updateDraft, notify, go]);

  const save = useCallback(async () => {
    if (!session || !draft || savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setSaveLabel(SAVING_LABEL);
    try {
      const { entry } = await session.api.save(draft, () => setSaveLabel(RETRYING_LABEL));
      for (const attachment of draft.attachments) {
        if (attachment.preview) URL.revokeObjectURL(attachment.preview);
      }
      setDrafts((previous) => withDraft(previous, draft.kind, null));
      setSuccess(successText(draft.kind, entry.referencia, entry.parte, entry.total));
      setLastSaved(true);
      recordScreen('success', true);
      show('success');
    } catch (error) {
      notify(messageOf(error, 'Não foi possível salvar.'), 'error', 9000);
    } finally {
      savingNow.current = false;
      setSaving(false);
      setSaveLabel(SAVE_LABEL);
    }
  }, [session, draft, notify, show]);

  const signOut = useCallback(() => {
    void signOutAndLeave(auth);
  }, [auth]);

  const goHome = useCallback(() => go('home'), [go]);
  const back = useCallback(() => history.back(), []);
  const initial = session ? (session.displayName || '?').charAt(0) : '';

  return (
    <>
      <IconSprite />
      <Header initial={initial} showSignOut={auth !== null} onSignOut={signOut} />
      <main>
        {screen === 'loading' ? <LoadingScreen message={loadingMessage} failed={bootFailed} /> : null}
        {screen === 'blocked' ? <BlockedScreen message={BLOCKED_MESSAGE} onSignOut={signOut} /> : null}
        {session && screen === 'home' ? (
          <HomeScreen
            displayName={session.displayName}
            showErpLink={session.usesErp}
            onNew={openEntry}
            onHistory={() => go('history')}
          />
        ) : null}
        {session && screen === 'entry' && draft ? (
          <EntryScreen
            key={kind}
            draft={draft}
            options={session.options}
            understanding={understanding}
            speech={speech}
            nextId={newId}
            onChange={changeCurrent}
            onUnderstand={() => void understand()}
            onSpeechUnsupported={() => notify(UNSUPPORTED_SPEECH, 'info', 7000)}
            onAddFiles={(files) => void addFiles(files)}
            onRemoveAttachment={removeAttachment}
            onReview={review}
            onHome={goHome}
          />
        ) : null}
        {session && screen === 'review' && draft ? (
          <ReviewScreen
            draft={draft}
            saving={saving}
            saveLabel={saveLabel}
            onBack={back}
            onSave={() => void save()}
          />
        ) : null}
        {screen === 'success' ? (
          <SuccessScreen
            message={success.message}
            detail={success.detail}
            onAnother={() => openEntry(kind)}
            onHome={goHome}
          />
        ) : null}
        {session && screen === 'history' ? (
          <HistoryScreen api={session.api} onHome={goHome} onError={(message) => notify(message, 'error')} />
        ) : null}
      </main>
      <Toast toast={toast} />
    </>
  );
}
