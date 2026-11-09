import { businessTodayISO } from '../../../shared/domain/business-date.js';
import { AppError } from '../../../shared/errors/app-error.js';

export type EnrollmentStatus = 'planejado' | 'agendado' | 'concluido' | 'dispensado';
export type DisplayStatus = EnrollmentStatus | 'sem-vencimento' | 'vencido' | 'a-vencer' | 'em-dia';

export interface Course {
  title: string;
  category: string;
  description: string;
  renewalMonths: number;
  noticeDays: number;
  mandatory: boolean;
  active: boolean;
  id?: string;
}

export interface Enrollment {
  courseId: string;
  employeeId: string;
  employeeLogin: string;
  status: EnrollmentStatus;
  completedAt: string;
  scheduledAt: string;
  expiresAt: string;
  notes: string;
  notifyAt: string;
  notifyEnabled: boolean;
  id?: string;
}

export type CourseState = Enrollment & {
  expiresAt: string;
  daysRemaining: number | null;
  displayStatus: DisplayStatus;
};

type Raw = Record<string, unknown> | null | undefined;

const STATUSES: readonly EnrollmentStatus[] = ['planejado', 'agendado', 'concluido', 'dispensado'];

const invalid = (message: string, status = 400): AppError =>
  new AppError(status, 'TRAINING_VALIDATION', message);

export const textField = (value: unknown, max = 160): string => {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw invalid(`Texto obrigatório, até ${max} caracteres.`);
  return text;
};

export const optionalText = (value: unknown, max = 500): string =>
  String(value ?? '')
    .trim()
    .slice(0, max);

export const safeId = (id: unknown): string => {
  const value = String(id || '');
  if (!/^[A-Za-z0-9_-]{4,100}$/.test(value)) throw invalid('Identificador inválido.');
  return value;
};

export const validDate = (value: unknown): string => {
  const text = String(value || '');
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(text) &&
    Number.isFinite(Date.parse(text + 'T12:00:00Z')) &&
    new Date(text + 'T12:00:00Z').toISOString().slice(0, 10) === text;
  if (!valid) throw invalid('Informe uma data válida.');
  return text;
};

export const optionalDate = (value: unknown): string => (value ? validDate(value) : '');

export const yearMonthDelta = (iso: unknown, months: unknown): string => {
  const date = new Date(validDate(iso) + 'T12:00:00Z');
  const count = Number(months);
  if (!Number.isInteger(count) || count < 0 || count > 240)
    throw invalid('Periodicidade deve ficar entre 0 e 240 meses.');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + count);
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, monthEnd));
  return date.toISOString().slice(0, 10);
};

export const coursePayload = (raw: Raw): Course => {
  const months = Number(raw?.renewalMonths || 0);
  if (!Number.isInteger(months) || months < 0 || months > 240)
    throw invalid('Intervalo de renovação inválido.');
  const noticeDays = Number(raw?.noticeDays ?? 30);
  if (!Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 365)
    throw invalid('Antecedência do aviso inválida.');
  return {
    title: textField(raw?.title, 120),
    category: optionalText(raw?.category, 60),
    description: optionalText(raw?.description, 500),
    renewalMonths: months,
    noticeDays,
    mandatory: Boolean(raw?.mandatory),
    active: raw?.active !== false,
  };
};

export const enrollmentPayload = (raw: Raw): Enrollment => {
  const courseId = safeId(raw?.courseId);
  const employeeId = safeId(raw?.employeeId);
  const status = String(raw?.status || 'planejado') as EnrollmentStatus;
  if (!STATUSES.includes(status)) throw invalid('Status de curso inválido.');
  const completedAt = optionalDate(raw?.completedAt);
  const scheduledAt = optionalDate(raw?.scheduledAt);
  const expiresAt = optionalDate(raw?.expiresAt);
  if (status === 'concluido' && !completedAt) throw invalid('Informe a conclusão do curso.');
  return {
    courseId,
    employeeId,
    employeeLogin: optionalText(raw?.employeeLogin, 80).toLowerCase(),
    status,
    completedAt,
    scheduledAt,
    expiresAt,
    notes: optionalText(raw?.notes, 500),
    notifyAt: optionalDate(raw?.notifyAt),
    notifyEnabled: Boolean(raw?.notifyEnabled),
  };
};

export const courseState = (
  entry: Enrollment,
  course: Pick<Course, 'renewalMonths' | 'noticeDays'>,
  asOf: string = businessTodayISO(),
): CourseState => {
  const expires =
    entry.expiresAt ||
    (entry.completedAt && course.renewalMonths
      ? yearMonthDelta(entry.completedAt, course.renewalMonths)
      : '');
  const days = expires
    ? Math.round((Date.parse(expires + 'T12:00:00Z') - Date.parse(asOf + 'T12:00:00Z')) / 86400000)
    : null;
  const status: DisplayStatus =
    entry.status !== 'concluido'
      ? entry.status
      : days === null
        ? 'sem-vencimento'
        : days < 0
          ? 'vencido'
          : days <= course.noticeDays
            ? 'a-vencer'
            : 'em-dia';
  return { ...entry, expiresAt: expires, daysRemaining: days, displayStatus: status };
};

export const visibleNotice = (
  assignment: Enrollment,
  course: Pick<Course, 'renewalMonths' | 'noticeDays'>,
  login: string,
  asOf: string,
): boolean => {
  const state = courseState(assignment, course, asOf);
  return (
    assignment.notifyEnabled &&
    String(assignment.employeeLogin || '').toLowerCase() === String(login || '').toLowerCase() &&
    (!assignment.notifyAt || assignment.notifyAt <= asOf) &&
    ['vencido', 'a-vencer', 'planejado', 'agendado'].includes(state.displayStatus)
  );
};
