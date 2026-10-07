function ensureStylesheet() {
  if (document.querySelector('link[data-profile-photo-style]')) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/modules/profile/profile-photo.css';
  link.dataset.profilePhotoStyle = '1';
  document.head.appendChild(link);
}

function ensureModal() {
  let overlay = document.getElementById('profile-photo-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'profile-photo-overlay';
  overlay.className = 'profile-photo-overlay';
  overlay.innerHTML = `
    <div class="profile-photo-modal" role="dialog" aria-modal="true" aria-labelledby="profile-photo-title">
      <div class="profile-photo-header">
        <div>
          <div id="profile-photo-title" class="profile-photo-title">Foto do perfil</div>
          <div class="profile-photo-subtitle">Sua foto aparece no cabeçalho do ERP.</div>
        </div>
        <button type="button" class="profile-photo-close" data-profile-action="close" aria-label="Fechar">×</button>
      </div>

      <div class="profile-photo-body">
        <div class="profile-photo-preview-wrap">
          <div id="profile-photo-preview" class="profile-photo-preview">
            <span id="profile-photo-preview-initial">U</span>
          </div>
        </div>

        <div class="profile-photo-info">
          <strong id="profile-photo-user-name">Usuário</strong>
          <span>JPG, PNG ou WebP. A imagem será recortada em formato quadrado e otimizada para 512×512.</span>
          <span>O arquivo final fica no Firebase Storage, não no Realtime Database.</span>
        </div>

        <input id="profile-photo-file" type="file" accept="image/jpeg,image/png,image/webp" hidden>

        <div class="profile-photo-actions">
          <button type="button" class="profile-photo-btn profile-photo-btn-primary" data-profile-action="choose">
            📷 Escolher foto
          </button>
          <button type="button" class="profile-photo-btn profile-photo-btn-save" data-profile-action="save" disabled>
            💾 Salvar
          </button>
          <button type="button" class="profile-photo-btn profile-photo-btn-danger" data-profile-action="remove">
            🗑️ Remover
          </button>
        </div>

        <div id="profile-photo-status" class="profile-photo-status" aria-live="polite"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  return overlay;
}

export function createProfilePhotoView() {
  ensureStylesheet();
  const overlay = ensureModal();

  const fileInput = overlay.querySelector('#profile-photo-file');
  const preview = overlay.querySelector('#profile-photo-preview');
  const previewInitial = overlay.querySelector('#profile-photo-preview-initial');
  const userName = overlay.querySelector('#profile-photo-user-name');
  const status = overlay.querySelector('#profile-photo-status');
  const saveButton = overlay.querySelector('[data-profile-action="save"]');
  const removeButton = overlay.querySelector('[data-profile-action="remove"]');

  let handlers = {};

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      handlers.close?.();
      return;
    }

    const button = event.target.closest('[data-profile-action]');
    if (!button) return;

    const action = button.dataset.profileAction;
    handlers[action]?.();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0] || null;
    handlers.file?.(file);
  });

  function setHandlers(nextHandlers) {
    handlers = nextHandlers || {};
  }

  function open() {
    overlay.classList.add('is-open');
  }

  function close() {
    overlay.classList.remove('is-open');
    fileInput.value = '';
  }

  function setName(value) {
    userName.textContent = value || 'Usuário';
  }

  function setPreview({ url = '', initial = 'U' } = {}) {
    preview.style.backgroundImage = url ? `url("${url}")` : '';
    preview.classList.toggle('has-photo', Boolean(url));
    previewInitial.textContent = String(initial || 'U').slice(0, 1).toUpperCase();
  }

  function setStatus(message = '', type = '') {
    status.textContent = message;
    status.dataset.type = type;
  }

  function setBusy(busy) {
    overlay.classList.toggle('is-busy', Boolean(busy));
    overlay.querySelectorAll('button').forEach((button) => {
      if (button.dataset.profileAction === 'close') return;
      button.disabled = Boolean(busy) || (
        button.dataset.profileAction === 'save' &&
        !saveButton.dataset.ready
      );
    });
  }

  function setSaveReady(ready) {
    saveButton.dataset.ready = ready ? '1' : '';
    saveButton.disabled = !ready;
  }

  function setRemoveEnabled(enabled) {
    removeButton.disabled = !enabled;
  }

  function chooseFile() {
    fileInput.click();
  }

  return {
    open,
    close,
    chooseFile,
    setHandlers,
    setName,
    setPreview,
    setStatus,
    setBusy,
    setSaveReady,
    setRemoveEnabled,
  };
}
