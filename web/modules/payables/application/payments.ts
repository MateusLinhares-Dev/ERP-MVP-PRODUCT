type Row = Record<string, unknown>;

export interface PaymentGateway {
  pay(body: Row): Promise<Row>;
  reverse(body: Row): Promise<Row>;
  status(payableId: string, operationId: string): Promise<Row>;
}

export interface PaymentLedger {
  apply(kind: 'payment' | 'reversal' | 'status', result: Row): void;
}

interface Pending {
  operationId: string;
  expiresAt: number;
  blockedUntil: number;
}

const HOLD_MS = 180_000;
const clampSeconds = (value: unknown): number => Math.max(1, Math.min(120, Math.ceil(Number(value) || 10)));

export function createPendingPayments(now: () => number, uuid: () => string) {
  const store = new Map<string, Pending>();
  const live = (id: string): Pending | null => {
    const entry = store.get(id);
    if (entry && entry.expiresAt > now()) return entry;
    store.delete(id);
    return null;
  };
  return {
    operation(id: string): string {
      return live(id)?.operationId ?? uuid();
    },
    hold(id: string, operationId: string, blockedUntil = 0): void {
      store.set(id, { operationId, expiresAt: now() + HOLD_MS, blockedUntil });
    },
    blockedSeconds(id: string): number {
      const entry = live(id);
      return entry && entry.blockedUntil > now() ? Math.ceil((entry.blockedUntil - now()) / 1000) : 0;
    },
    forget(id: string): void {
      store.delete(id);
    },
  };
}

export type PendingPayments = ReturnType<typeof createPendingPayments>;

export type Outcome =
  | { kind: 'done'; message: string }
  | { kind: 'blocked'; seconds: number; message: string }
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string; lock?: boolean };

export interface PaymentDeps {
  gateway: PaymentGateway;
  ledger: PaymentLedger;
  pending: PendingPayments;
  now: () => number;
}

interface FailureLike {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  retryAfterSeconds?: unknown;
}

const failureOf = (error: unknown): FailureLike =>
  error && typeof error === 'object' ? (error as FailureLike) : {};
const unknownResult = (failure: FailureLike): boolean =>
  failure.code === 'NETWORK_ERROR' || !Number(failure.status) || Number(failure.status) >= 500;

export async function submitPayment(deps: PaymentDeps, payload: Row): Promise<Outcome> {
  const id = String(payload.payableId ?? '');
  const operationId = String(payload.operationId ?? '');
  const waiting = deps.pending.blockedSeconds(id);
  if (waiting)
    return {
      kind: 'blocked',
      seconds: waiting,
      message: `Existe uma baixa sendo processada. Aguarde ${waiting} segundo(s) antes de consultar novamente. Não registre outro pagamento.`,
    };
  deps.pending.hold(id, operationId);
  try {
    const result = await deps.gateway.pay(payload);
    deps.pending.forget(id);
    deps.ledger.apply('payment', result);
    const payable = result.payable as { status?: unknown } | undefined;
    return {
      kind: 'done',
      message:
        payable?.status === 'Pago'
          ? 'Conta quitada e operação confirmada.'
          : 'Compensação ou pagamento parcial confirmado.',
    };
  } catch (error) {
    const failure = failureOf(error);
    if (failure.code === 'PAYMENT_IN_PROGRESS') {
      const seconds = clampSeconds(failure.retryAfterSeconds);
      deps.pending.hold(id, operationId, deps.now() + seconds * 1000);
      return {
        kind: 'blocked',
        seconds,
        message: `Há uma baixa em processamento para este título. Use “Verificar situação” após ${seconds} segundo(s). Nenhum novo pagamento foi enviado por este aviso.`,
      };
    }
    if (failure.code === 'PAYABLE_CHANGED') {
      deps.pending.forget(id);
      return {
        kind: 'error',
        message:
          'Esta conta foi alterada ou quitada em outra sessão. Feche a janela e atualize a listagem antes de tentar novamente.',
      };
    }
    if (unknownResult(failure))
      return {
        kind: 'error',
        message: 'Não foi possível confirmar o pagamento. Use “Verificar situação” antes de tentar de novo.',
      };
    return { kind: 'error', message: String(failure.message || 'Não foi possível confirmar o pagamento.') };
  }
}

export async function verifyPayment(deps: PaymentDeps, id: string, operationId: string): Promise<Outcome> {
  let data: Row;
  try {
    data = await deps.gateway.status(id, operationId);
  } catch (error) {
    return {
      kind: 'error',
      message: String(
        failureOf(error).message || 'Falha ao consultar o pagamento. Nenhuma baixa foi enviada.',
      ),
    };
  }
  if (data.state === 'confirmed') {
    deps.ledger.apply('status', data);
    deps.pending.forget(id);
    return { kind: 'done', message: 'Pagamento confirmado no Firebase. Compra e conta atualizadas.' };
  }
  if (data.state === 'processing') {
    const seconds = clampSeconds(data.retryAfterSeconds);
    deps.pending.hold(id, operationId, deps.now() + seconds * 1000);
    return {
      kind: 'blocked',
      seconds,
      message: `A baixa ainda está em processamento. Nenhum novo pagamento foi enviado. Confira novamente após ${seconds} segundos.`,
    };
  }
  if (data.state === 'pending') {
    deps.pending.hold(id, operationId, 0);
    return {
      kind: 'info',
      message:
        'O Firebase ainda mostra esta conta como pendente. Confira o extrato antes de confirmar novamente.',
    };
  }
  if (data.state === 'needs_review')
    return {
      kind: 'error',
      lock: true,
      message:
        'A conta e a compra mostram situações diferentes. Nenhum pagamento foi enviado. É necessário conferir o histórico financeiro.',
    };
  return {
    kind: 'error',
    lock: true,
    message: 'Conta não localizada no Firebase. Nenhum pagamento foi enviado.',
  };
}

const reversing = new Set<string>();

export async function reversePayment(deps: PaymentDeps, body: Row | null): Promise<string> {
  if (!body) return 'Pagamento não encontrado (recarregue e tente de novo).';
  const id = String(body.payableId ?? '');
  if (reversing.has(id)) return 'A exclusão deste pagamento já está em andamento.';
  reversing.add(id);
  try {
    const result = await deps.gateway.reverse(body);
    if (!result.payable) return 'Não foi possível excluir o pagamento.';
    deps.ledger.apply('reversal', result);
    return '';
  } catch (error) {
    const failure = failureOf(error);
    if (unknownResult(failure))
      return 'Sem resposta do servidor. Atualize a tela e confira a conta antes de tentar de novo.';
    return String(failure.message || 'Não foi possível excluir o pagamento.');
  } finally {
    reversing.delete(id);
  }
}
