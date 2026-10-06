// Same-origin account API client shared by the login screen and homepage.
(() => {
  const state = { user: null, csrfToken: null, available: false };
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });

  const emitChange = () => window.dispatchEvent(new CustomEvent('jsstudio:authchange', { detail: { ...state } }));

  async function request(url, options = {}) {
    await ready;
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.csrfToken) {
      headers.set('X-CSRF-Token', state.csrfToken);
    }
    const response = await fetch(url, {
      ...options,
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'Die Anfrage konnte nicht ausgeführt werden.');
    if (data?.csrfToken) state.csrfToken = data.csrfToken;
    if (data && Object.hasOwn(data, 'user')) state.user = data.user;
    return data;
  }

  async function initialize() {
    try {
      const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
      if (!csrfResponse.ok) throw new Error('Server nicht erreichbar');
      const csrfData = await csrfResponse.json();
      state.csrfToken = csrfData.csrfToken;
      const userResponse = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!userResponse.ok) throw new Error('Server nicht erreichbar');
      state.user = (await userResponse.json()).user;
      state.available = true;
    } catch {
      state.available = false;
      state.user = null;
    } finally {
      resolveReady();
      updateAccountLink();
      emitChange();
    }
  }

  async function refreshCsrf() {
    const response = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Sitzung konnte nicht erneuert werden.');
    const data = await response.json();
    state.csrfToken = data.csrfToken;
  }

  function updateAccountLink() {
    document.querySelectorAll('[data-auth-link]').forEach((link) => {
      link.href = link.dataset.authHref || 'login.html';
      link.textContent = state.user ? 'Mein Konto' : 'Anmelden';
      link.setAttribute('aria-label', state.user ? 'Mein Konto' : 'Am JS Studio anmelden');
    });
  }

  window.JSStudioAuth = { state, ready, request, refreshCsrf, updateAccountLink, emitChange };
  initialize();
})();
