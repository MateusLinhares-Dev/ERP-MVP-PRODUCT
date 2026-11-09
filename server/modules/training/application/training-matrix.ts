import { randomUUID } from 'node:crypto';
import type { Database, Reference } from 'firebase-admin/database';
import type { Storage } from 'firebase-admin/storage';
import type { Identity } from '../../../shared/auth/identity.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { runTransaction } from '../../../shared/firebase/rtdb-transaction.js';
import { loginFromStorageKey } from '../../access/domain/user.js';
import {
  courseState,
  coursePayload,
  enrollmentPayload,
  safeId,
  textField,
  visibleNotice,
  yearMonthDelta,
  type Course,
  type Enrollment,
} from '../domain/training.js';

export interface TrainingDeps {
  db: Pick<Database, 'ref'>;
  storage: Pick<Storage, 'bucket'>;
  now?: () => string;
}

type Records<T = Record<string, unknown>> = Record<string, T>;
type Body = Record<string, unknown>;

interface StaffRecord {
  mat?: unknown;
  nome?: unknown;
  ativo?: unknown;
  status?: unknown;
}

interface StoredDocument {
  id?: string;
  enrollmentId?: string;
  path?: string;
  [field: string]: unknown;
}

const ALLOWED_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

const err = (message: string, status = 400): AppError =>
  new AppError(status, status === 403 ? 'TRAINING_FORBIDDEN' : 'TRAINING_ERROR', message);

const records = <T = Record<string, unknown>>(value: unknown): Records<T> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Records<T>) : {};

const employeeKey = (mat: unknown): string => {
  const value = String(mat ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '');
  return value.length >= 4 ? value : 'EMP_' + value;
};

const employeeRecords = (value: unknown): StaffRecord[] =>
  (Array.isArray(value) ? value : Object.values(records(value))).filter(
    (item): item is StaffRecord =>
      Boolean(item) &&
      typeof item === 'object' &&
      item.mat != null &&
      Boolean(String(item.mat).trim()) &&
      Boolean(item.nome),
  );

const userRecords = (value: unknown): { login: string; name: string }[] =>
  Object.entries(records(value)).flatMap(([key, user]) => {
    if (!user || typeof user !== 'object') return [];
    const profile = records(user.profile);
    const login = String(user.login || profile.login || loginFromStorageKey(key))
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9._@-]{1,80}$/.test(login)) return [];
    return [{ login, name: String(profile.name || user.name || login).slice(0, 120) }];
  });

const newId = (): string => 'TM' + randomUUID().replace(/-/g, '').slice(0, 24);

export function isTrainingManager(identity: Identity): boolean {
  return (
    identity.admin === true &&
    (String(identity.erpUser || '').toLowerCase() === 'elaine' ||
      (identity.engineer === true && identity.erpUser === 'engadministrator'))
  );
}

const clock = (deps: TrainingDeps): (() => string) => deps.now ?? (() => new Date().toISOString());

export async function trainingNotices(deps: TrainingDeps, identity: Identity) {
  const root = records((await deps.db.ref('erpTraining').get()).val());
  const courses = records<Course>(root.courses);
  const enrollments = records<Enrollment>(root.enrollments);
  const login = String(identity.erpUser || '').toLowerCase();
  const day = clock(deps)().slice(0, 10);
  const notices = Object.values(enrollments).flatMap((entry) => {
    const course = entry ? courses[entry.courseId] : undefined;
    if (!entry || !course || !visibleNotice(entry, course, login, day)) return [];
    const state = courseState(entry, course, day);
    return [
      {
        id: entry.id,
        course: course.title,
        scheduledAt: entry.scheduledAt,
        expiresAt: state.expiresAt,
        status: state.displayStatus,
      },
    ];
  });
  return { notices };
}

export async function trainingMatrix(deps: TrainingDeps, identity: Identity) {
  if (!isTrainingManager(identity)) throw err('Gestão reservada à Elaine.', 403);
  const [training, staff, users] = await Promise.all([
    deps.db.ref('erpTraining').get(),
    deps.db.ref('erp/funcEdit').get(),
    deps.db.ref('erpAuth/users').get(),
  ]);
  const root = records(training.val());
  const employees = employeeRecords(staff.val()).map((item) => ({
    id: employeeKey(item.mat),
    name: String(item.nome).slice(0, 120),
    mat: String(item.mat),
    active:
      item.ativo !== false &&
      !['inativo', 'desligado', 'demitido'].includes(String(item.status || '').toLowerCase()),
  }));
  return {
    courses: records(root.courses),
    enrollments: records(root.enrollments),
    documents: records(root.documents),
    employees,
    erpUsers: userRecords(users.val()),
    history: Object.values(records(root.audit)).slice(-120),
  };
}

class MatrixChange {
  private result: { id?: string } = {};
  private readonly auditKey: string | null;
  private readonly root: Reference;

  constructor(
    private readonly deps: TrainingDeps,
    private readonly identity: Identity,
    private readonly body: Body,
  ) {
    this.root = deps.db.ref('erpTraining');
    this.auditKey = this.root.child('audit').push().key;
  }

  private get action(): string {
    return String(this.body.action || '');
  }

  private get who(): string {
    return String(this.identity.erpUser);
  }

  private now(): string {
    return clock(this.deps)();
  }

  private async commit(changes: Record<string, unknown>): Promise<void> {
    await this.root.update({
      ...changes,
      ['audit/' + this.auditKey]: {
        action: this.action,
        recordId: this.result.id,
        actor: this.who,
        uid: this.identity.uid,
        createdAt: this.now(),
      },
    });
  }

  async run(): Promise<Record<string, unknown>> {
    switch (this.action) {
      case 'course':
        await this.saveCourse();
        break;
      case 'enroll':
        await this.enroll();
        break;
      case 'removeEnrollment':
        await this.removeEnrollment();
        break;
      case 'activate':
        await this.activate();
        break;
      case 'archive':
        await this.archive();
        break;
      case 'document':
        return this.attachDocument();
      case 'removeDocument':
        await this.removeDocument();
        break;
      default:
        throw err('Ação desconhecida.');
    }
    return { ok: true, ...this.result };
  }

  private async saveCourse(): Promise<void> {
    const b = this.body;
    const course = coursePayload(b);
    const key = b.id ? safeId(b.id) : newId();
    const original = b.id ? records<unknown>((await this.root.child('courses/' + key).get()).val()) : null;
    if (b.id && !Object.keys(original ?? {}).length) throw err('Curso não encontrado para edição.', 404);
    const duplicate = Object.values(records((await this.root.child('courses').get()).val())).some(
      (item) =>
        item &&
        item.id !== key &&
        String(item.title || '')
          .trim()
          .toLowerCase() === course.title.toLowerCase(),
    );
    if (duplicate) throw err('Este curso já está cadastrado. Use Editar no catálogo.', 409);
    this.result = { id: key };
    await this.commit({
      ['courses/' + key]: {
        ...course,
        active: original ? original.active !== false : true,
        id: key,
        updatedAt: this.now(),
        updatedBy: this.who,
      },
    });
  }

  private async enroll(): Promise<void> {
    const b = this.body;
    const entry = enrollmentPayload(b);
    const key = b.id ? safeId(b.id) : newId();
    const [courseSnap, employeeSnap, usersSnap, enrollSnap] = await Promise.all([
      this.root.child('courses/' + entry.courseId).get(),
      this.deps.db.ref('erp/funcEdit').get(),
      this.deps.db.ref('erpAuth/users').get(),
      this.root.child('enrollments').get(),
    ]);
    const course = courseSnap.val() as Course | null;
    const enrollmentsNow = records<Enrollment>(enrollSnap.val());
    const previous = b.id ? enrollmentsNow[key] : null;
    if (b.id && !previous) throw err('Vínculo não encontrado para edição.', 404);
    if (!course || (course.active === false && (!previous || previous.courseId !== entry.courseId))) {
      throw err('Curso não encontrado ou inativo.');
    }
    if (!employeeRecords(employeeSnap.val()).some((item) => employeeKey(item.mat) === entry.employeeId)) {
      throw err('Funcionário não cadastrado no RH. Atualize a matriz e selecione novamente.');
    }
    if (entry.notifyEnabled && !entry.employeeLogin) {
      throw err('Selecione o usuário do ERP que receberá o aviso ou desmarque os avisos.');
    }
    if (
      entry.employeeLogin &&
      !userRecords(usersSnap.val()).some((user) => user.login === entry.employeeLogin)
    ) {
      throw err('Usuário do ERP não encontrado para os avisos.');
    }
    if (entry.status === 'concluido' && course.renewalMonths && entry.completedAt && !entry.expiresAt) {
      entry.expiresAt = yearMonthDelta(entry.completedAt, course.renewalMonths);
    }
    const duplicate = Object.values(enrollmentsNow).find(
      (item) =>
        item &&
        item.id !== key &&
        item.employeeId === entry.employeeId &&
        item.courseId === entry.courseId &&
        item.status !== 'dispensado',
    );
    if (duplicate && !previous) {
      throw err(
        'Esse funcionário já possui vínculo ativo com este curso. Edite o vínculo existente ou exclua o duplicado.',
        409,
      );
    }
    const pairKey = entry.employeeId + '_' + entry.courseId;
    const lock = this.root.child('enrollmentLocks/' + pairKey);
    let reserved = false;
    if (!previous) {
      const tx = await runTransaction(lock, (current) => {
        if (current === null || current === key) return key;
        const holder = enrollmentsNow[String(current)];
        if (
          !holder ||
          holder.status === 'dispensado' ||
          `${holder.employeeId}_${holder.courseId}` !== pairKey
        )
          return key;
        return undefined;
      });
      if (!tx.committed)
        throw err('Já existe cadastro deste curso para o funcionário. Atualize a matriz.', 409);
      reserved = true;
    }
    try {
      this.result = { id: key };
      await this.commit({
        ['enrollments/' + key]: { ...entry, id: key, updatedAt: this.now(), updatedBy: this.who },
      });
    } catch (error) {
      if (reserved) {
        try {
          await runTransaction(lock, (current) => (current == null || current === key ? null : undefined));
        } catch (releaseError) {
          console.warn('[Matriz] Liberação do índice após falha:', (releaseError as Error | null)?.message);
        }
      }
      throw error;
    }
  }

  private async removeEnrollment(): Promise<void> {
    const key = safeId(this.body.id);
    const item = (await this.root.child('enrollments/' + key).get()).val() as Enrollment | null;
    if (!item) throw err('Vínculo não encontrado.', 404);
    const documents = Object.values(
      records<StoredDocument>((await this.root.child('documents').get()).val()),
    );
    if (documents.some((document) => document && document.enrollmentId === key)) {
      throw err(
        'Esse vínculo possui certificado. Exclua o certificado primeiro ou mantenha o vínculo no histórico.',
        409,
      );
    }
    const pairPath = 'enrollmentLocks/' + item.employeeId + '_' + item.courseId;
    const indexed: unknown = (await this.root.child(pairPath).get()).val();
    this.result = { id: key };
    await this.commit({ ['enrollments/' + key]: null, ...(indexed === key ? { [pairPath]: null } : {}) });
  }

  private async activate(): Promise<void> {
    const key = safeId(this.body.id);
    if (!(await this.root.child('courses/' + key).get()).exists()) throw err('Curso não encontrado.', 404);
    this.result = { id: key };
    await this.commit({
      ['courses/' + key + '/active']: true,
      ['courses/' + key + '/updatedAt']: this.now(),
      ['courses/' + key + '/updatedBy']: this.who,
    });
  }

  private async archive(): Promise<void> {
    const key = safeId(this.body.id);
    const kind = String(this.body.kind);
    if (kind !== 'courses' && kind !== 'enrollments') throw err('Tipo inválido.');
    if (!(await this.root.child(kind + '/' + key).get()).exists()) throw err('Registro não encontrado.', 404);
    this.result = { id: key };
    const fields =
      kind === 'courses'
        ? { active: false, updatedAt: this.now(), updatedBy: this.who }
        : { status: 'dispensado', notifyEnabled: false, updatedAt: this.now(), updatedBy: this.who };
    await this.commit(
      Object.fromEntries(Object.entries(fields).map(([field, value]) => [`${kind}/${key}/${field}`, value])),
    );
  }

  private async attachDocument(): Promise<Record<string, unknown>> {
    const b = this.body;
    const enrollmentId = safeId(b.enrollmentId);
    const docId = safeId(b.id);
    const extension = String(b.extension || '');
    const mime = ALLOWED_MIME[extension];
    if (!mime) throw err('Formato inválido.');
    const path = `erp-files/training/${enrollmentId}/${docId}.${extension}`;
    const documentRef = this.root.child('documents/' + docId);
    const previous = await documentRef.get();
    if (previous.exists()) {
      const saved = previous.val() as StoredDocument | null;
      if (saved?.enrollmentId !== enrollmentId || saved.path !== path) {
        throw err('Identificador já utilizado em outro documento.', 409);
      }
      return { ok: true, id: docId, document: saved, alreadyExists: true };
    }
    if (!(await this.root.child('enrollments/' + enrollmentId).get()).exists())
      throw err('Vínculo inexistente.', 404);
    const file = this.deps.storage.bucket().file(path);
    const [exists] = await file.exists();
    if (!exists) throw err('Anexo ainda não foi enviado.', 409);
    const [meta] = await file.getMetadata();
    if (Number(meta.size) < 1 || Number(meta.size) > 10 * 1024 * 1024)
      throw err('Anexo fora do limite de 10 MB.');
    if (meta.contentType !== mime) throw err('O tipo do arquivo não corresponde à extensão.', 400);
    const document = {
      id: docId,
      enrollmentId,
      name: textField(b.name, 140),
      path,
      createdAt: this.now(),
      createdBy: this.who,
    };
    const transaction = await runTransaction(documentRef, (current) =>
      current === null ? document : undefined,
    );
    const saved = transaction.snapshot?.val() as StoredDocument | null | undefined;
    if (saved?.enrollmentId !== enrollmentId || saved.path !== path) {
      throw err('Identificador já utilizado em outro documento.', 409);
    }
    if (transaction.committed) {
      try {
        await this.root
          .child('audit')
          .child('document_' + docId)
          .set({
            action: this.action,
            recordId: docId,
            actor: this.who,
            uid: this.identity.uid,
            createdAt: this.now(),
          });
      } catch (auditError) {
        console.error('[Matriz] Documento salvo, mas o registro de auditoria falhou.', auditError);
      }
    }
    return { ok: true, id: docId, document: saved, alreadyExists: !transaction.committed };
  }

  private async removeDocument(): Promise<void> {
    const key = safeId(this.body.id);
    const document = (await this.root.child('documents/' + key).get()).val() as StoredDocument | null;
    if (!document) throw err('Documento não encontrado.', 404);
    if (!String(document.path || '').startsWith('erp-files/training/')) throw err('Caminho inválido.');
    this.result = { id: key };
    await this.commit({ ['documents/' + key]: null });
    await this.deps.storage.bucket().file(String(document.path)).delete({ ignoreNotFound: true });
  }
}

export async function changeTrainingMatrix(deps: TrainingDeps, identity: Identity, body: Body) {
  if (!isTrainingManager(identity)) throw err('Somente Elaine pode alterar a matriz.', 403);
  return new MatrixChange(deps, identity, body).run();
}
