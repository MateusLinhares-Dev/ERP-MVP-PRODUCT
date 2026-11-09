import { randomUUID } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import { getFirebaseAdmin } from '../../shared/firebase/firebase-admin.js';
import { createPurchaseOrder } from '../purchases/application/create-purchase-order.js';
import type {
  Clock,
  IdGenerator,
  PurchaseOrderGateway,
  PurchaseOrderResult,
  SpeechInterpreter,
} from './application/ports.js';
import { QuickEntryService } from './application/quick-entry-service.js';
import { ClaudeSpeechInterpreter } from './infrastructure/claude-speech-interpreter.js';
import {
  RtdbQuickEntryRepository,
  type ChildKeyReader,
} from './infrastructure/rtdb-quick-entry-repository.js';
import { StorageAttachmentStore, type BucketLike } from './infrastructure/storage-attachment-store.js';

export interface QuickEntryModuleOptions {
  db?: Database;
  bucket?: BucketLike;
  clock?: Clock;
  ids?: IdGenerator;
  childKeys?: ChildKeyReader;
  purchases?: PurchaseOrderGateway;
  interpreter?: SpeechInterpreter | null;
  env?: NodeJS.ProcessEnv;
}

export function createQuickEntryModule(options: QuickEntryModuleOptions = {}): QuickEntryService {
  const clock: Clock = options.clock ?? { now: () => Date.now() };
  const ids: IdGenerator = options.ids ?? { uuid: () => randomUUID() };
  const db = options.db ?? getFirebaseAdmin().db;
  const bucket = options.bucket ?? (getFirebaseAdmin().storage.bucket() as unknown as BucketLike);
  const purchases: PurchaseOrderGateway = options.purchases ?? {
    create: (identity, input) =>
      createPurchaseOrder(identity, input, {
        db,
        now: () => clock.now(),
        uuid: () => ids.uuid(),
      } as Parameters<typeof createPurchaseOrder>[2]) as Promise<PurchaseOrderResult>,
  };
  return new QuickEntryService({
    repository: new RtdbQuickEntryRepository(db, clock, ids, options.childKeys),
    storage: new StorageAttachmentStore(bucket),
    purchases,
    interpreter:
      options.interpreter === undefined
        ? ClaudeSpeechInterpreter.fromEnvironment(options.env)
        : options.interpreter,
    clock,
    ids,
  });
}

export { QuickEntryService } from './application/quick-entry-service.js';
export { sanitizeInterpretation } from './domain/speech-interpretation.js';
export { ClaudeSpeechInterpreter } from './infrastructure/claude-speech-interpreter.js';
