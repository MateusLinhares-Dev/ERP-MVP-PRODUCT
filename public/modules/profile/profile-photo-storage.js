const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_STORED_BYTES = 2 * 1024 * 1024;
const TARGET_SIZE = 512;
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem selecionada.'));
    };

    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Não foi possível processar a imagem.'));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

async function renderSquareWebp(file, quality) {
  const image = await loadImageFromFile(file);
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sx = Math.max(0, (image.naturalWidth - sourceSize) / 2);
  const sy = Math.max(0, (image.naturalHeight - sourceSize) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas indisponível para processar a foto.');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, TARGET_SIZE, TARGET_SIZE);
  context.drawImage(
    image,
    sx,
    sy,
    sourceSize,
    sourceSize,
    0,
    0,
    TARGET_SIZE,
    TARGET_SIZE,
  );

  return canvasToBlob(canvas, 'image/webp', quality);
}

export async function prepareProfilePhoto(file) {
  if (!(file instanceof File)) {
    throw new Error('Selecione uma imagem válida.');
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Formato não permitido. Use JPG, PNG ou WebP.');
  }

  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('A imagem original deve ter no máximo 10 MB.');
  }

  let blob = await renderSquareWebp(file, 0.86);

  if (blob.size > MAX_STORED_BYTES) {
    blob = await renderSquareWebp(file, 0.72);
  }

  if (blob.size > MAX_STORED_BYTES) {
    blob = await renderSquareWebp(file, 0.58);
  }

  if (blob.size > MAX_STORED_BYTES) {
    throw new Error('A imagem ficou maior que 2 MB mesmo após otimização.');
  }

  return blob;
}

export function createProfilePhotoStorage(storage) {
  if (!storage || typeof storage.ref !== 'function') {
    throw new Error('Firebase Storage indisponível para o módulo de perfil.');
  }

  function pathFor(uid) {
    const cleanUid = String(uid || '').trim();
    if (!cleanUid || cleanUid.includes('/')) {
      throw new Error('UID inválido para armazenamento da foto.');
    }
    return `erp-files/profilePhotos/${cleanUid}/avatar.webp`;
  }

  async function upload(uid, blob) {
    const path = pathFor(uid);
    const ref = storage.ref(path);

    await ref.put(blob, {
      contentType: 'image/webp',
      cacheControl: 'public,max-age=3600',
      customMetadata: {
        purpose: 'erp-profile-photo',
      },
    });

    return {
      path,
      url: await ref.getDownloadURL(),
    };
  }

  async function getDownloadUrl(path) {
    const cleanPath = String(path || '').trim();
    if (!cleanPath) return '';
    return storage.ref(cleanPath).getDownloadURL();
  }

  async function remove(path) {
    const cleanPath = String(path || '').trim();
    if (!cleanPath) return;

    try {
      await storage.ref(cleanPath).delete();
    } catch (error) {
      if (
        error?.code === 'storage/object-not-found' ||
        error?.code === 'storage/object_not_found'
      ) {
        return;
      }
      throw error;
    }
  }

  return {
    upload,
    getDownloadUrl,
    remove,
    pathFor,
  };
}
