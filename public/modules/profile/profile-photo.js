import {
  createProfilePhotoRepository,
} from './profile-photo-repository.js';

import {
  createProfilePhotoStorage,
  prepareProfilePhoto,
} from './profile-photo-storage.js';

import {
  createProfilePhotoView,
} from './profile-photo-view.js';

const AVATAR_SELECTORS = [
  '#hav',
  '#wbav',
];

function firstLetter(value) {
  const clean = String(value || '').trim();
  return (clean[0] || 'U').toUpperCase();
}

function currentDisplayName(user) {
  return (
    document.getElementById('hname')?.textContent?.trim() ||
    document.getElementById('wbname')?.textContent?.trim() ||
    user?.displayName ||
    user?.uid ||
    'Usuário'
  );
}

function addVersion(url, version) {
  if (!url) return '';
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(String(version || Date.now()))}`;
}

export function initProfilePhoto({
  auth,
  db,
  storage,
} = {}) {
  if (!auth || !db || !storage) {
    console.warn('[profile-photo] Firebase ainda não está disponível.');
    return () => {};
  }

  const repository = createProfilePhotoRepository(db);
  const photoStorage = createProfilePhotoStorage(storage);
  const view = createProfilePhotoView();

  let currentUser = null;
  let currentProfile = null;
  let currentUrl = '';
  let pendingBlob = null;
  let pendingPreviewUrl = '';
  let unsubscribeProfile = null;
  let nameObserver = null;

  function avatarElements() {
    return AVATAR_SELECTORS
      .map((selector) => document.querySelector(selector))
      .filter(Boolean);
  }

  function fallbackInitial() {
    return firstLetter(currentDisplayName(currentUser));
  }

  function applyAvatar(url = '') {
    const initial = fallbackInitial();

    avatarElements().forEach((element) => {
      element.classList.add('erp-profile-avatar-enabled');
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      element.setAttribute('aria-label', 'Alterar foto do perfil');
      element.title = 'Clique para alterar sua foto de perfil';
      element.dataset.profilePhotoBound = '1';

      if (url) {
        element.style.backgroundImage = `url("${url}")`;
        element.style.color = 'transparent';
        element.textContent = initial;
      } else {
        element.style.backgroundImage = '';
        element.style.color = '';
        element.textContent = initial;
      }
    });

    view.setPreview({
      url,
      initial,
    });
    view.setName(currentDisplayName(currentUser));
  }

  function clearPendingPreview() {
    if (pendingPreviewUrl) {
      URL.revokeObjectURL(pendingPreviewUrl);
      pendingPreviewUrl = '';
    }
    pendingBlob = null;
    view.setSaveReady(false);
  }

  function openModal() {
    if (!currentUser) return;
    clearPendingPreview();
    view.setStatus('');
    view.setName(currentDisplayName(currentUser));
    view.setPreview({
      url: currentUrl,
      initial: fallbackInitial(),
    });
    view.setRemoveEnabled(Boolean(currentProfile?.photoPath));
    view.open();
  }

  function bindAvatarEvents() {
    avatarElements().forEach((element) => {
      if (element.dataset.profilePhotoClickBound === '1') return;
      element.dataset.profilePhotoClickBound = '1';

      element.addEventListener('click', openModal);
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openModal();
        }
      });
    });
  }

  async function resolveAndApply(profile) {
    currentProfile = profile || null;

    if (!profile?.photoPath) {
      currentUrl = '';
      applyAvatar('');
      view.setRemoveEnabled(false);
      return;
    }

    try {
      const rawUrl = await photoStorage.getDownloadUrl(profile.photoPath);
      currentUrl = addVersion(rawUrl, profile.updatedAt);
      applyAvatar(currentUrl);
      view.setRemoveEnabled(true);
    } catch (error) {
      console.warn('[profile-photo] Foto não pôde ser carregada:', error);
      currentUrl = '';
      applyAvatar('');
      view.setRemoveEnabled(Boolean(profile?.photoPath));
    }
  }

  async function selectFile(file) {
    if (!file) return;

    try {
      view.setBusy(true);
      view.setStatus('Otimizando imagem...');

      const blob = await prepareProfilePhoto(file);
      clearPendingPreview();
      pendingBlob = blob;
      pendingPreviewUrl = URL.createObjectURL(blob);

      view.setPreview({
        url: pendingPreviewUrl,
        initial: fallbackInitial(),
      });
      view.setSaveReady(true);
      view.setStatus(
        `Imagem pronta (${Math.max(1, Math.round(blob.size / 1024))} KB). Clique em Salvar.`,
        'success',
      );
    } catch (error) {
      clearPendingPreview();
      view.setPreview({
        url: currentUrl,
        initial: fallbackInitial(),
      });
      view.setStatus(error?.message || 'Não foi possível preparar a imagem.', 'error');
    } finally {
      view.setBusy(false);
    }
  }

  async function savePhoto() {
    if (!currentUser || !pendingBlob) return;

    try {
      view.setBusy(true);
      view.setStatus('Enviando foto...');

      const upload = await photoStorage.upload(
        currentUser.uid,
        pendingBlob,
      );

      const profile = await repository.save(currentUser.uid, {
        photoPath: upload.path,
        updatedAt: Date.now(),
      });

      clearPendingPreview();
      await resolveAndApply(profile);
      view.setStatus('Foto atualizada com sucesso.', 'success');

      window.setTimeout(() => {
        view.close();
      }, 650);
    } catch (error) {
      console.error('[profile-photo] Falha ao salvar:', error);
      view.setStatus(
        error?.message || 'Não foi possível salvar a foto.',
        'error',
      );
    } finally {
      view.setBusy(false);
    }
  }

  async function removePhoto() {
    if (!currentUser || !currentProfile?.photoPath) return;

    if (!window.confirm('Remover sua foto de perfil?')) return;

    try {
      view.setBusy(true);
      view.setStatus('Removendo foto...');

      await photoStorage.remove(currentProfile.photoPath);
      await repository.remove(currentUser.uid);

      clearPendingPreview();
      currentProfile = null;
      currentUrl = '';
      applyAvatar('');
      view.setRemoveEnabled(false);
      view.setStatus('Foto removida.', 'success');

      window.setTimeout(() => {
        view.close();
      }, 500);
    } catch (error) {
      console.error('[profile-photo] Falha ao remover:', error);
      view.setStatus(
        error?.message || 'Não foi possível remover a foto.',
        'error',
      );
    } finally {
      view.setBusy(false);
    }
  }

  view.setHandlers({
    close: () => {
      clearPendingPreview();
      view.close();
    },
    choose: () => view.chooseFile(),
    save: savePhoto,
    remove: removePhoto,
    file: selectFile,
  });

  const authUnsubscribe = auth.onAuthStateChanged((user) => {
    currentUser = user || null;

    unsubscribeProfile?.();
    unsubscribeProfile = null;
    clearPendingPreview();

    if (!currentUser) {
      currentProfile = null;
      currentUrl = '';
      applyAvatar('');
      return;
    }

    bindAvatarEvents();
    applyAvatar(currentUrl);

    unsubscribeProfile = repository.subscribe(
      currentUser.uid,
      (profile) => {
        void resolveAndApply(profile);
      },
      (error) => {
        console.warn('[profile-photo] Falha ao observar perfil:', error);
      },
    );
  });

  nameObserver = new MutationObserver(() => {
    bindAvatarEvents();
    if (!currentUrl) applyAvatar('');
    view.setName(currentDisplayName(currentUser));
  });

  const nameTargets = [
    document.getElementById('hname'),
    document.getElementById('wbname'),
  ].filter(Boolean);

  nameTargets.forEach((target) => {
    nameObserver.observe(target, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });

  bindAvatarEvents();

  window.erpProfilePhoto = {
    open: openModal,
    async getPhotoUrlForUid(uid) {
      const profile = await repository.get(uid);
      if (!profile?.photoPath) return '';
      const url = await photoStorage.getDownloadUrl(profile.photoPath);
      return addVersion(url, profile.updatedAt);
    },
  };

  return () => {
    authUnsubscribe?.();
    unsubscribeProfile?.();
    nameObserver?.disconnect();
    clearPendingPreview();
    delete window.erpProfilePhoto;
  };
}
