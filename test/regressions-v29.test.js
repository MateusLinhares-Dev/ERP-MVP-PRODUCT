import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL('../'+p, import.meta.url),'utf8');

test('restore history não depende de índice action do RTDB',()=>{
  const src=read('api/admin/restore-history.js');
  assert.doesNotMatch(src,/orderByChild\(['\"]action['\"]\)/);
  assert.match(src,/ref\(['\"]erpAudit['\"]\)\.limitToLast\(250\)\.get\(\)/);
  assert.match(src,/snapshot-restored/);
  assert.match(src,/manual-database-backup-imported/);
});
