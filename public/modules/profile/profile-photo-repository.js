export function createProfilePhotoRepository(db) {
  if (!db || typeof db.ref !== 'function') {
    throw new Error('Realtime Database indisponível para o módulo de perfil.');
  }

  const root = db.ref('erpUserProfiles');

  function profileRef(uid) {
    const cleanUid = String(uid || '').trim();
    if (!cleanUid) throw new Error('UID do usuário não informado.');
    return root.child(cleanUid);
  }

  async function get(uid) {
    const snapshot = await profileRef(uid).get();
    return snapshot.val() || null;
  }

  async function save(uid, profile) {
    const payload = {
      photoPath: String(profile?.photoPath || ''),
      updatedAt: Number(profile?.updatedAt || Date.now()),
    };

    if (!payload.photoPath) {
      throw new Error('Caminho da foto não informado.');
    }

    await profileRef(uid).set(payload);
    return payload;
  }

  async function remove(uid) {
    await profileRef(uid).remove();
  }

  function subscribe(uid, onValue, onError) {
    const ref = profileRef(uid);
    const handler = (snapshot) => {
      onValue?.(snapshot.val() || null);
    };

    ref.on('value', handler, onError);

    return () => {
      ref.off('value', handler);
    };
  }

  return {
    get,
    save,
    remove,
    subscribe,
  };
}
