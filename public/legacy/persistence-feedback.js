(function (global) {
  'use strict';
  const original = typeof global.showToast === 'function' ? global.showToast.bind(global) : null;
  const receipt = global.__ERP_CLOUD_SAVE_STATE__;
  if (!original || !receipt || global.__ERP_PERSISTENCE_FEEDBACK_INSTALLED__) return;
  global.__ERP_PERSISTENCE_FEEDBACK_INSTALLED__ = true;

  const waiting = [];
  let pendingTimer = null;
  let lastWaitingNotice = 0;
  let lastRendered = '';
  const saveWords = /salv|grav|cadastrad|registrad|atualizad|lançad|exclu[ií]d|pagament|baixad|quitad|finalizad|conclu[ií]d/i;

  function statusPanel() {
    let panel = document.getElementById('erp-save-receipt-status');
    if (panel || !document.body) return panel;
    panel = document.createElement('div');
    panel.id = 'erp-save-receipt-status';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.style.cssText = 'display:none;position:fixed;left:18px;bottom:18px;max-width:min(460px,calc(100vw - 36px));z-index:150100;padding:12px 16px;border-radius:10px;box-shadow:0 8px 32px #0003;font:600 13px/1.5 system-ui,sans-serif;';
    document.body.appendChild(panel);
    return panel;
  }
  function render(message, error) {
    const panel = statusPanel();
    if (!panel) return;
    const key = (error ? 'error:' : 'pending:') + message;
    if (!message) {
      panel.style.display = 'none';
      lastRendered = '';
      return;
    }
    if (lastRendered === key) return;
    lastRendered = key;
    panel.textContent = message;
    panel.style.background = error ? '#fee2e2' : '#fff7da';
    panel.style.border = error ? '1px solid #d04b46' : '1px solid #dfac36';
    panel.style.color = error ? '#8c1915' : '#5c4313';
    panel.style.display = 'block';
  }
  function refresh(state) {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    const confirmed = Number(state.confirmed || 0);
    for (let i = waiting.length - 1; i >= 0; i--) {
      const task = waiting[i];
      if (task.version <= confirmed) {
        waiting.splice(i, 1);
        original(task.message, task.type, task.duration);
      }
    }
    if (state.error) {
      render('Falha ao confirmar dados no Firebase. As alterações ainda estão pendentes; confira a conexão e não feche a tela antes de confirmar.', true);
    } else if (state.pending) {
      pendingTimer = setTimeout(function () {
        if (global.__ERP_CLOUD_SAVE_STATE__?.pending && !global.__ERP_CLOUD_SAVE_STATE__?.error) {
          render('Gravando no Firebase. Esta alteração ainda NÃO foi confirmada no servidor.', false);
        }
      }, 2000);
    } else {
      render('', false);
    }
  }
  global.showToast = function (message, type = 'success', duration = 4000) {
    const state = global.__ERP_CLOUD_SAVE_STATE__;
    if (type === 'success' && state && state.pending && saveWords.test(String(message || ''))) {
      waiting.push({version: Math.max(0, Number(state.requested) || 0), message, type, duration});
      if (Date.now() - lastWaitingNotice > 4000) {
        lastWaitingNotice = Date.now();
        original('Alteração pendente: aguardando confirmação no Firebase.', 'info', 4500);
      }
      refresh(state);
      return;
    }
    return original(message, type, duration);
  };
  document.addEventListener('erp:cloud-save-state', function (event) {
    refresh(event.detail || global.__ERP_CLOUD_SAVE_STATE__);
  });
  refresh(receipt);
})(window);
