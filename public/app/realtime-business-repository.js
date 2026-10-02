export function createRealtimeBusinessRepository(db) {
  const root = 'erp';
  const pathOf = (path = '') => `${root}/${String(path).replace(/^\/+|\/+$/g, '')}`.replace(/\/$/, '');

  async function read(path) {
    const snap = await db.ref(pathOf(path)).once('value');
    return snap.val();
  }

  async function upsert(collection, id, value) {
    if (!id) throw new Error(`ID obrigatório para ${collection}.`);
    await db.ref(pathOf(`${collection}/${id}`)).set(value);
    return value;
  }

  async function remove(collection, id) {
    if (!id) return;
    await db.ref(pathOf(`${collection}/${id}`)).remove();
  }

  async function upsertMany(collection, objectById) {
    const updates = {};
    Object.entries(objectById || {}).forEach(([id, value]) => {
      if (id && value != null) updates[pathOf(`${collection}/${id}`)] = value;
    });
    if (Object.keys(updates).length) await db.ref().update(updates);
  }

  return Object.freeze({ read, upsert, remove, upsertMany });
}
