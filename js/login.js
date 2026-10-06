(() => {
  const auth = window.JSStudioAuth;
  const form = document.querySelector('#auth-form');
  const message = document.querySelector('#auth-message');
  const submitButton = document.querySelector('[data-submit]');
  const accountPanel = document.querySelector('[data-auth-account]');
  const guestPanel = document.querySelector('[data-auth-guest]');
  const confirmation = document.querySelector('[data-confirmation]');
  let mode = 'login';

  const showMessage = (text, kind = '') => {
    message.textContent = text;
    message.classList.toggle('is-error', kind === 'error');
    message.classList.toggle('is-success', kind === 'success');
  };

  function setMode(nextMode) {
    mode = nextMode;
    document.querySelectorAll('[data-mode]').forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    const registering = mode === 'register';
    confirmation.hidden = !registering;
    confirmation.querySelector('input').required = registering;
    document.querySelector('#password').autocomplete = registering ? 'new-password' : 'current-password';
    submitButton.innerHTML = registering ? 'Konto erstellen <span aria-hidden="true">→</span>' : 'Anmelden <span aria-hidden="true">→</span>';
    document.querySelector('#auth-title').innerHTML = registering ? 'Dein neues<br><span>Abenteuer.</span>' : 'Willkommen<br><span>zurück.</span>';
    showMessage(auth.state.available ? '' : 'Der Lernserver ist nicht erreichbar. Starte ihn mit „npm start“ und öffne dann http://localhost:3000.');
    submitButton.disabled = !auth.state.available;
  }

  async function showAccount(user) {
    guestPanel.hidden = true;
    accountPanel.hidden = false;
    document.querySelector('[data-account-email]').textContent = user.email;
    document.querySelector('[data-account-id]').textContent = user.id;
    showMessage('Dein Konto und dein Lernstand werden sicher auf dem Server gespeichert.', 'success');
    try {
      const progress = await auth.request('/api/progress');
      document.querySelector('[data-account-xp]').textContent = `${progress.xp} XP`;
      document.querySelector('[data-account-lessons]').textContent = `${progress.completed.length} / 21 Lektionen`;
    } catch (error) {
      showMessage(error.message, 'error');
    }
  }

  function showGuest() {
    accountPanel.hidden = true;
    guestPanel.hidden = false;
    setMode(mode);
  }

  function getGuestProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem('jsStudioQuestProgress') || '{}');
      return Array.isArray(saved.completed) ? saved.completed : [];
    } catch {
      try {
        const prefix = 'jsStudioQuest:';
        const saved = window.name.startsWith(prefix) ? JSON.parse(window.name.slice(prefix.length)) : {};
        return Array.isArray(saved.completed) ? saved.completed : [];
      } catch { return []; }
    }
  }

  document.querySelectorAll('[data-mode]').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!auth.state.available) return showMessage('Der Server ist gerade nicht erreichbar. Bitte starte den Lernserver und lade diese Seite neu.', 'error');
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    if (mode === 'register' && password !== form.elements.passwordConfirm.value) {
      return showMessage('Die beiden Passwörter stimmen nicht überein.', 'error');
    }
    if (mode === 'register' && password.length < 12) {
      return showMessage('Wähle ein Passwort mit mindestens 12 Zeichen.', 'error');
    }

    submitButton.disabled = true;
    showMessage(mode === 'register' ? 'Konto wird sicher erstellt …' : 'Anmeldung läuft …');
    try {
      const registering = mode === 'register';
      const result = await auth.request(registering ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body: { email, password }
      });
      auth.updateAccountLink();
      auth.emitChange();
      if (registering) {
        const completed = getGuestProgress();
        for (const lessonId of completed) {
          try { await auth.request(`/api/progress/${encodeURIComponent(lessonId)}`, { method: 'PUT' }); } catch { /* The new account remains usable if guest progress cannot be imported. */ }
        }
      }
      await showAccount(result.user);
    } catch (error) {
      showMessage(error.message, 'error');
      submitButton.disabled = false;
    }
  });

  document.querySelector('[data-logout]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await auth.request('/api/auth/logout', { method: 'POST' });
      auth.state.user = null;
      auth.state.csrfToken = null;
      auth.updateAccountLink();
      auth.emitChange();
      await auth.refreshCsrf();
      showGuest();
      showMessage('Du wurdest abgemeldet.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('[data-copy-id]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.querySelector('[data-account-id]').textContent);
      showMessage('Konto-ID kopiert.', 'success');
    } catch {
      showMessage('Kopieren nicht möglich. Markiere die ID und kopiere sie manuell.', 'error');
    }
  });

  auth.ready.then(() => {
    if (auth.state.user) showAccount(auth.state.user);
    else showGuest();
  });
  window.addEventListener('jsstudio:authchange', (event) => {
    if (event.detail.user) showAccount(event.detail.user);
    else if (event.detail.available) showGuest();
  });
})();
