async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
  });
  let body = {};
  try { body = await response.json(); } catch (_) {}
  if (!response.ok) {
    const error = new Error(body.message || `Erro HTTP ${response.status}`);
    error.status = response.status;
    error.retryAfterSeconds = body.retryAfterSeconds || 0;
    error.code = body.code || 'HTTP_ERROR';
    throw error;
  }
  return body;
}

function waitForAuthState(auth, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; off(); resolve(auth.currentUser || null); } }, timeoutMs);
    const off = auth.onAuthStateChanged((user) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      resolve(user || null);
    });
  });
}

export function createSecureAuthClient(auth) {
  async function authHeaders() {
    const user = auth.currentUser || await waitForAuthState(auth);
    if (!user) throw new Error('Sessão não autenticada.');
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }

  return {
    async login(password) {
      const payload = await jsonFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      await auth.signInWithCustomToken(payload.customToken);
      return { username: payload.username, profile: payload.profile };
    },

    async restore(expectedUsername) {
      const user = auth.currentUser || await waitForAuthState(auth);
      if (!user) return false;
      try {
        const headers = await authHeaders();
        const session = await jsonFetch('/api/auth/session', { method: 'GET', headers });
        return !expectedUsername || session.username === expectedUsername;
      } catch (_) {
        try { await auth.signOut(); } catch (_) {}
        return false;
      }
    },

    async session() {
      return jsonFetch('/api/auth/session', { method: 'GET', headers: await authHeaders() });
    },

    async manageUser(action, data) {
      return jsonFetch('/api/admin/users', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ action, ...data }),
      });
    },

    async verifyAdminPassword(password) {
      return jsonFetch('/api/auth/verify-admin', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ password }),
      });
    },

    async logout() {
      await auth.signOut();
    },
  };
}
