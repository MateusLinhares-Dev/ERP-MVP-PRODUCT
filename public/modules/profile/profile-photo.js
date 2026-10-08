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

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
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

  let publicProfiles = {};
  let publicUsers = {};
  let publicProfilesHandler = null;
  let publicUsersHandler = null;
  let publicProfilesErrorHandler = null;
  let publicUsersErrorHandler = null;
  let publicAvatarObserver = null;
  let publicDecorateScheduled = false;

  const publicUrlCache = new Map();

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

  function profileForLogin(login) {
    const normalized = normalizeLogin(login);
    if (!normalized) return null;

    const preferredKeys = [
      normalized,
      `erp:${normalized}`,
    ];

    for (const key of preferredKeys) {
      if (publicProfiles[key]) {
        return {
          uid: key,
          profile: publicProfiles[key],
        };
      }
    }

    const found = Object.entries(publicProfiles).find(([uid]) => {
      const normalizedUid = normalizeLogin(uid);
      if (normalizedUid === normalized) return true;
      if (normalizedUid === `erp:${normalized}`) return true;
      return normalizedUid.split(':').pop() === normalized;
    });

    if (!found) return null;

    return {
      uid: found[0],
      profile: found[1],
    };
  }

  function loginForName(name) {
    const normalized = normalizeName(name);
    if (!normalized) return '';

    const found = Object.entries(publicUsers).find(([, user]) => {
      return normalizeName(user?.name) === normalized;
    });

    return found ? found[0] : '';
  }

  async function publicPhotoUrlForLogin(login) {
    const entry = profileForLogin(login);
    if (!entry?.profile?.photoPath) return '';

    const version = Number(entry.profile.updatedAt || 0);
    const cacheKey = `${entry.profile.photoPath}|${version}`;

    if (publicUrlCache.has(cacheKey)) {
      return publicUrlCache.get(cacheKey);
    }

    const rawUrl = await photoStorage.getDownloadUrl(entry.profile.photoPath);
    const versionedUrl = addVersion(rawUrl, version);

    publicUrlCache.set(cacheKey, versionedUrl);
    return versionedUrl;
  }

  async function applyPublicAvatar(element, login) {
    if (!element) return;

    const normalized = normalizeLogin(login);
    if (!normalized) {
      element.classList.remove('erp-profile-public-avatar');
      element.style.backgroundImage = '';
      element.style.color = '';
      delete element.dataset.profilePublicLogin;
      return;
    }

    element.dataset.profilePublicLogin = normalized;

    try {
      const url = await publicPhotoUrlForLogin(normalized);

      if (element.dataset.profilePublicLogin !== normalized) return;

      if (!url) {
        element.classList.remove('erp-profile-public-avatar');
        element.style.backgroundImage = '';
        element.style.color = '';
        return;
      }

      element.classList.add('erp-profile-public-avatar');
      element.style.backgroundImage = `url("${url}")`;
      element.style.color = 'transparent';
    } catch (error) {
      if (element.dataset.profilePublicLogin !== normalized) return;

      element.classList.remove('erp-profile-public-avatar');
      element.style.backgroundImage = '';
      element.style.color = '';

      console.warn(
        `[profile-photo] Foto pública de ${normalized} não pôde ser carregada:`,
        error,
      );
    }
  }

  function decorateUserCards() {
    document.querySelectorAll('#users-grid .ucard').forEach((card) => {
      const login = card.querySelector('.ucard-role code')?.textContent?.trim() || '';
      const avatar = card.querySelector('.ucard-av');

      if (!login || !avatar) return;

      void applyPublicAvatar(avatar, login);
    });
  }

  function decorateChatUsers() {
    const list = document.getElementById('chat-conv-list');
    if (!list) return;

    Array.from(list.children).forEach((row) => {
      if (!(row instanceof HTMLElement)) return;

      const children = Array.from(row.children);
      if (children.length < 2) return;

      const avatar = children[0];
      const info = children[1];

      if (!(avatar instanceof HTMLElement)) return;
      if (!(info instanceof HTMLElement)) return;
      if (avatar.tagName !== 'DIV') return;

      const name =
        info.firstElementChild?.textContent?.trim() ||
        '';

      const login = loginForName(name);
      if (!login) return;

      void applyPublicAvatar(avatar, login);
    });
  }

  function decoratePublicAvatars() {
    decorateUserCards();
    decorateChatUsers();
  }

  function scheduleDecoratePublicAvatars() {
    if (publicDecorateScheduled) return;

    publicDecorateScheduled = true;

    requestAnimationFrame(() => {
      publicDecorateScheduled = false;
      decoratePublicAvatars();
    });
  }

  function clearPublicAvatarStyles() {
    document
      .querySelectorAll('.erp-profile-public-avatar')
      .forEach((element) => {
        element.classList.remove('erp-profile-public-avatar');
        element.style.backgroundImage = '';
        element.style.color = '';
        delete element.dataset.profilePublicLogin;
      });
  }

  function stopPublicAvatarSync() {
    if (publicProfilesHandler) {
      db.ref('erpUserProfiles').off('value', publicProfilesHandler);
    }

    if (publicUsersHandler) {
      db.ref('erp/users').off('value', publicUsersHandler);
    }

    publicProfilesHandler = null;
    publicUsersHandler = null;
    publicProfilesErrorHandler = null;
    publicUsersErrorHandler = null;

    publicAvatarObserver?.disconnect();
    publicAvatarObserver = null;

    publicProfiles = {};
    publicUsers = {};
    publicUrlCache.clear();
    clearPublicAvatarStyles();
  }

  function startPublicAvatarSync() {
    stopPublicAvatarSync();

    publicProfilesHandler = (snapshot) => {
      publicProfiles = snapshot.val() || {};
      publicUrlCache.clear();
      scheduleDecoratePublicAvatars();
    };

    publicUsersHandler = (snapshot) => {
      publicUsers = snapshot.val() || {};
      scheduleDecoratePublicAvatars();
    };

    publicProfilesErrorHandler = (error) => {
      console.warn('[profile-photo] Não foi possível carregar os perfis:', error);
    };

    publicUsersErrorHandler = (error) => {
      console.warn('[profile-photo] Não foi possível carregar os usuários:', error);
    };

    db.ref('erpUserProfiles').on(
      'value',
      publicProfilesHandler,
      publicProfilesErrorHandler,
    );

    db.ref('erp/users').on(
      'value',
      publicUsersHandler,
      publicUsersErrorHandler,
    );

    publicAvatarObserver = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        if (mutation.type !== 'childList') return false;

        const target = mutation.target;
        if (!(target instanceof Node)) return false;

        const element =
          target instanceof Element
            ? target
            : target.parentElement;

        if (!element) return false;

        return Boolean(
          element.closest('#users-grid') ||
          element.closest('#chat-conv-list') ||
          element.id === 'users-grid' ||
          element.id === 'chat-conv-list',
        );
      });

      if (relevant) {
        scheduleDecoratePublicAvatars();
      }
    });

    publicAvatarObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    scheduleDecoratePublicAvatars();
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
      stopPublicAvatarSync();
      return;
    }

    bindAvatarEvents();
    applyAvatar(currentUrl);
    startPublicAvatarSync();

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
    async getPhotoUrlForLogin(login) {
      return publicPhotoUrlForLogin(login);
    },
    refreshVisibleAvatars() {
      scheduleDecoratePublicAvatars();
    },
  };

  return () => {
    authUnsubscribe?.();
    unsubscribeProfile?.();
    nameObserver?.disconnect();
    stopPublicAvatarSync();
    clearPendingPreview();
    delete window.erpProfilePhoto;
  };
}
