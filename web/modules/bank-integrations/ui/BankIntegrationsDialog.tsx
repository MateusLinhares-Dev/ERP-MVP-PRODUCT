import { useCallback, useEffect, useState } from 'react';
import { messageOf } from '../../../shared/domain/errors.js';
import { openPluggyConnect } from '../application/pluggy-connect.js';
import { formatLastSync, usesSandbox } from '../domain/integration.js';
import type {
  ExternalAccount,
  IntegrationAction,
  IntegrationConfig,
  IntegrationReply,
} from '../domain/integration.js';

interface BankIntegrationsDialogProps {
  bankCode: string;
  call(action: IntegrationAction, fields?: Record<string, unknown>): Promise<IntegrationReply>;
  confirm(message: string): boolean;
  onClose(): void;
  onOpenReconciliation(bankCode: string): void;
}

interface Notice {
  text: string;
  error: boolean;
}

type Operation = Exclude<IntegrationAction, 'status' | 'connect-token' | 'link'> | 'connect' | 'reconcile';

export function BankIntegrationsDialog({
  bankCode,
  call,
  confirm,
  onClose,
  onOpenReconciliation,
}: BankIntegrationsDialogProps) {
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<IntegrationConfig>({});
  const [accounts, setAccounts] = useState<ExternalAccount[]>([]);
  const [canConfigure, setCanConfigure] = useState(false);
  const [notice, setNotice] = useState<Notice>({ text: '', error: false });
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');

  useEffect(() => {
    let active = true;
    call('status').then(
      (result) => {
        if (!active) return;
        setConfig(result.config ?? {});
        setCanConfigure(result.canConfigure === true);
        setLoaded(true);
      },
      (error: unknown) => {
        if (active) setNotice({ text: messageOf(error, 'Falha na integração.'), error: true });
      },
    );
    return () => {
      active = false;
    };
  }, [call]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const showAccounts = useCallback((list: ExternalAccount[] | undefined, current: IntegrationConfig) => {
    setAccounts(list ?? []);
    setSelectedAccount(current.accountId ?? '');
  }, []);

  const run = async (operation: Operation) => {
    if (busy) return;
    setBusy(true);
    setNotice({ text: '', error: false });
    try {
      if (operation === 'save') {
        if (!clientId.trim() || !clientSecret.trim()) throw new Error('Informe Client ID e Client Secret.');
        if (
          config.configured &&
          !confirm('Substituir as credenciais atuais e desconectar a instituição existente?')
        )
          return;
        const result = await call('save', { clientId: clientId.trim(), clientSecret: clientSecret.trim() });
        setConfig(result.config ?? {});
        showAccounts([], result.config ?? {});
        setNotice({ text: result.message ?? '', error: false });
      } else if (operation === 'test') {
        setNotice({ text: (await call('test')).message ?? '', error: false });
      } else if (operation === 'connect') {
        const token = await call('connect-token');
        await openPluggyConnect({
          connectToken: String(token.accessToken ?? ''),
          includeSandbox: usesSandbox(location.hostname),
          onSuccess: (event) => {
            call('link', { itemId: event?.item?.id || event?.id })
              .then((linked) => {
                setConfig(linked.config ?? {});
                showAccounts(linked.accounts, linked.config ?? {});
                setNotice({ text: 'Instituição conectada. Selecione a conta bancária.', error: false });
              })
              .catch((error: unknown) =>
                setNotice({ text: messageOf(error, 'Falha na integração.'), error: true }),
              );
          },
          onError: () => setNotice({ text: 'A conexão com a instituição não foi concluída.', error: true }),
        });
        setNotice({ text: 'Conclua a conexão na janela segura do provedor.', error: false });
      } else if (operation === 'accounts') {
        showAccounts((await call('accounts')).accounts, config);
        setNotice({ text: 'Contas atualizadas.', error: false });
      } else if (operation === 'select-account') {
        if (!selectedAccount) throw new Error('Selecione uma conta externa.');
        const result = await call('select-account', { accountId: selectedAccount });
        setConfig(result.config ?? {});
        setNotice({ text: result.message ?? '', error: false });
      } else if (operation === 'disconnect') {
        if (
          !confirm('Desvincular esta conta do provedor? Os extratos já importados continuarão disponíveis.')
        )
          return;
        const result = await call('disconnect');
        setConfig(result.config ?? {});
        showAccounts([], result.config ?? {});
        setNotice({ text: result.message ?? '', error: false });
      } else if (operation === 'sync') {
        const result = await call('sync');
        const status = await call('status');
        setConfig(status.config ?? {});
        setNotice({ text: result.message ?? '', error: false });
      } else {
        onClose();
        onOpenReconciliation(bankCode);
      }
    } catch (error) {
      setNotice({ text: messageOf(error, 'Falha na integração.'), error: true });
    } finally {
      setBusy(false);
    }
  };

  const saved = config.configured === true;
  const connected = config.connected === true;
  const linked = Boolean(config.accountId);
  const button = (operation: Operation, label: string, disabled = false) => (
    <button
      type="button"
      data-operation={operation}
      disabled={busy || disabled}
      onClick={() => void run(operation)}
    >
      {label}
    </button>
  );

  return (
    <div
      className="erp-bank-integration-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="erp-bank-integration-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Integrações bancárias"
      >
        <header>
          <div>
            <h2>Integrações bancárias</h2>
            <p>Conta {bankCode}</p>
          </div>
          <button type="button" data-integration-close onClick={onClose}>
            Fechar
          </button>
        </header>
        <div className="erp-bank-integration-content">
          <div
            role="status"
            aria-live="polite"
            data-integration-notice
            data-error={notice.error ? 'true' : 'false'}
          >
            {notice.text}
          </div>
          <div data-integrations-main>
            {!loaded ? (
              <p>Carregando configurações...</p>
            ) : (
              <>
                <div className="erp-bank-integration-summary">
                  <div>
                    <small>Provedor</small>
                    <strong>Pluggy / Open Finance</strong>
                  </div>
                  <div>
                    <small>Credenciais</small>
                    <strong>{saved ? 'Configuradas' : 'Não configuradas'}</strong>
                  </div>
                  <div>
                    <small>Conexão bancária</small>
                    <strong>{connected ? 'Conectada' : 'Não conectada'}</strong>
                  </div>
                  <div>
                    <small>Última importação</small>
                    <strong>{formatLastSync(config.lastSyncAt)}</strong>
                  </div>
                </div>
                {canConfigure ? (
                  <>
                    <div className="erp-bank-integration-grid">
                      <section className="erp-bank-integration-section">
                        <h3>1. Credenciais do provedor</h3>
                        <div className="erp-bank-integration-form">
                          <label>
                            Client ID
                            <input
                              name="clientId"
                              autoComplete="off"
                              maxLength={200}
                              placeholder="Client ID Pluggy"
                              value={clientId}
                              onChange={(event) => setClientId(event.target.value)}
                            />
                          </label>
                          <label>
                            Client Secret
                            <input
                              name="clientSecret"
                              type="password"
                              autoComplete="new-password"
                              maxLength={300}
                              placeholder="Client Secret"
                              value={clientSecret}
                              onChange={(event) => setClientSecret(event.target.value)}
                            />
                          </label>
                        </div>
                        <div className="erp-bank-integration-actions">
                          {button('save', 'Salvar credenciais')}
                          {button('test', 'Testar conexão', !saved)}
                        </div>
                      </section>
                      <section className="erp-bank-integration-section">
                        <h3>2. Vincular conta bancária</h3>
                        <p>
                          Conecte a instituição pelo ambiente seguro do provedor. Depois selecione a conta
                          correspondente ao cadastro do ERP.
                        </p>
                        <div className="erp-bank-integration-actions">
                          {button('connect', 'Conectar instituição', !saved)}
                          {button('accounts', 'Atualizar contas', !connected)}
                        </div>
                        <div data-external-accounts>
                          {accounts.length ? (
                            <>
                              <label>
                                Conta conectada
                                <select
                                  data-external-select
                                  value={selectedAccount}
                                  onChange={(event) => setSelectedAccount(event.target.value)}
                                >
                                  <option value="">Selecione</option>
                                  {accounts.map((account) => (
                                    <option key={account.id} value={account.id}>
                                      {account.name} · {account.type} · {account.numberEnd}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {button('select-account', 'Salvar vínculo')}
                            </>
                          ) : null}
                        </div>
                        {connected ? (
                          <div className="erp-bank-integration-actions">
                            {button('disconnect', 'Desvincular')}
                          </div>
                        ) : null}
                      </section>
                    </div>
                    <section className="erp-bank-integration-section">
                      <h3>3. Sincronização</h3>
                      <p>
                        Importa movimentações bancárias como pendentes de conciliação. Não cria baixas nem
                        modifica o saldo automaticamente.
                      </p>
                      <div className="erp-bank-integration-actions">
                        {button('sync', 'Buscar movimentações', !linked)}
                        {button('reconcile', 'Abrir conciliação')}
                      </div>
                    </section>
                  </>
                ) : (
                  <div className="erp-bank-integration-section">
                    <p>
                      O perfil atual pode consultar a situação desta integração. A configuração e a
                      sincronização exigem acesso de administrador.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
