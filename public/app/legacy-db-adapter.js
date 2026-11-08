const FILE_PATH_PATTERNS = [
  /^erp\/funcDocs\/[^/]+\/[^/]+$/,
  /^erp\/empresaDocs\/[^/]+$/,
  /^erp\/frotaDocs\/[^/]+\/[^/]+$/,
];

function isManagedFilePath(path) {
  return FILE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function joinChunks(value) {
  if (!value || typeof value !== 'object' || !value._partes) return value;
  let joined = '';
  for (let i = 0; i < Number(value._partes); i += 1) joined += value[`p${i}`] || '';
  return joined;
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/s.exec(dataUrl || '');
  if (!match) throw new Error('Formato de arquivo legado inválido.');
  const contentType = match[1] || 'application/octet-stream';
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: contentType }), contentType };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function storagePathForDatabasePath(path) {
  return `erp-files/${path.split('/').slice(1).map(encodeURIComponent).join('/')}`;
}

function snapshotWithValue(snapshot, value) {
  return new Proxy(snapshot, {
    get(target, prop) {
      if (prop === 'val') return () => value;
      return Reflect.get(target, prop);
    },
  });
}

function auditManagedFile(action, path) {
  try {
    const parts = String(path || '').split('/').filter(Boolean);
    const ns = parts[1] || '';
    const module = ns === 'funcDocs' ? 'funcionarios' : ns === 'frotaDocs' ? 'frota' : 'documentos_empresas';
    const entityId = parts[parts.length - 1] || '';
    if (typeof window.erpAudit === 'function') {
      window.erpAudit(action, module, { entityType: 'documento', entityId, scope: ns });
    }
  } catch (_) {}
}

export function createLegacyDatabaseAdapter(rawDb, storage) {
  function wrapRef(rawRef, path) {
    if (!isManagedFilePath(path)) return rawRef;
    const storagePath = storagePathForDatabasePath(path);

    return new Proxy(rawRef, {
      get(target, prop) {
        if (prop === 'set') {
          return async (value) => {
            if (value == null) return target.set(null);
            if (value && typeof value === 'object' && value.__storageV === 1) return target.set(value);
            const dataUrl = joinChunks(value);
            if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return target.set(value);
            const { blob, contentType } = dataUrlToBlob(dataUrl);
            // Uma nova versao nao sobrescreve o arquivo que o metadado antigo aponta.
            // Isso permite compensar falhas do RTDB sem perder documentos existentes.
            const version = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
            const newStoragePath = `${storagePath}--v-${version}`;
            const fileRef = storage.ref(newStoragePath);
            await fileRef.put(blob, { contentType, cacheControl: 'private,max-age=3600' });
            try {
              await target.set({
                __storageV: 1,
                path: newStoragePath,
                contentType,
                size: blob.size,
                updatedAt: Date.now(),
              });
            } catch (error) {
              // Uma resposta perdida nao significa que o RTDB nao confirmou a escrita.
              // Nunca apagar um arquivo que talvez ja esteja referenciado no Database.
              let resultadoConfirmado = false;
              let exclusaoSegura = false;
              try {
                const atual = (await target.once('value')).val();
                resultadoConfirmado = atual?.__storageV === 1 && atual.path === newStoragePath;
                exclusaoSegura = !resultadoConfirmado;
              } catch (verifyError) {
                console.warn('[Documentos] Upload com resultado indeterminado; mantendo arquivo para verificacao:', verifyError);
              }
              if (resultadoConfirmado) {
                auditManagedFile('file_upload', path);
                return;
              }
              if (exclusaoSegura) {
                try { await fileRef.delete(); } catch (cleanupError) {
                  console.warn('[Documentos] Falha em compensar upload sem metadados:', cleanupError);
                  auditManagedFile('file_cleanup_pending', path);
                }
              } else auditManagedFile('file_cleanup_pending', path);
              throw error;
            }
            auditManagedFile('file_upload', path);
          };
        }
        if (prop === 'once') {
          return (eventName, success, failure) => {
            const promise = target.once(eventName).then(async (snapshot) => {
              const value = snapshot.val();
              if (!value || value.__storageV !== 1 || !value.path) return snapshot;
              const url = await storage.ref(value.path).getDownloadURL();
              return snapshotWithValue(snapshot, url);
            });
            if (typeof success === 'function') promise.then(success, failure);
            return promise;
          };
        }
        if (prop === 'remove') {
          return async () => {
            // Se a remocao do RTDB for recusada, o arquivo deve permanecer acessivel.
            const snapshot = await target.once('value');
            const value = snapshot.val();
            const result = await target.remove();
            auditManagedFile('file_delete', path);
            if (value && value.__storageV === 1 && typeof value.path === 'string' &&
                (value.path === storagePath || value.path.startsWith(storagePath + '--v-'))) {
              try { await storage.ref(value.path).delete(); }
              catch (error) {
                // Metadado ja removido: deixar o objeto orfao para limpeza auditada.
                console.warn('[Documentos] Metadado removido, limpeza do Storage pendente:', error);
                auditManagedFile('file_cleanup_pending', path);
              }
            }
            return result;
          };
        }
        return Reflect.get(target, prop);
      },
    });
  }

  return new Proxy(rawDb, {
    get(target, prop) {
      // ref() sem argumento = raiz. ref('') é rejeitado pelo SDK ("invalid path").
      if (prop === 'ref') return (path) => (path === undefined || path === null || path === '' || path === '/')
        ? target.ref()
        : wrapRef(target.ref(path), String(path));
      return Reflect.get(target, prop);
    },
  });
}
