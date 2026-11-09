export {
  changeSnapshots,
  exchangeBackup,
  isDataOwner,
  restoreHistory,
} from './application/data-administration.js';
export {
  BUSINESS_SNAPSHOT_NODES,
  buildExactRestorePatch,
  createSnapshot,
  isValidSnapshotKey,
  normalizeBusinessSnapshot,
  restoreSnapshot,
} from './application/snapshot-service.js';
