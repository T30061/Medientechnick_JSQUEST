// Shared mini-quiz, XP rewards, and saved course progress for JS Studio.
(() => {
  const STORAGE_KEY = 'jsStudioQuestProgress';
  const WINDOW_PREFIX = 'jsStudioQuest:';
  const XP_PER_LESSON = 25;
  let accountUser = null;
  let accountProgress = null;
  let csrfToken = null;

  const readWindowProgress = () => {
    try {
      if (!window.name.startsWith(WINDOW_PREFIX)) return { completed: [], xp: 0 };
      const saved = JSON.parse(window.name.slice(WINDOW_PREFIX.length));
      return { completed: Array.isArray(saved.completed) ? saved.completed : [], xp: Number(saved.xp) || 0 };
    } catch {
      return { completed: [], xp: 0 };
    }
  };

  const loadProgress = () => {
    if (accountUser && accountProgress) return { completed: [...accountProgress.completed], xp: accountProgress.xp };
    let browserProgress = { completed: [], xp: 0 };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      browserProgress = { completed: Array.isArray(saved.completed) ? saved.completed : [], xp: Number(saved.xp) || 0 };
    } catch { /* Use the same-tab fallback below for local files or restricted storage. */ }
    const sameTabProgress = readWindowProgress();
    return {
      completed: [...new Set([...browserProgress.completed, ...sameTabProgress.completed])],
      xp: Math.max(browserProgress.xp, sameTabProgress.xp)
    };
  };

  const saveProgress = (progress) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // The window-name fallback below keeps progress when browsing local files.
    }
    try { window.name = `${WINDOW_PREFIX}${JSON.stringify(progress)}`; } catch { /* Saving is optional. */ }
  };

  const initializeServerAccount = async () => {
    try {
      const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
      if (!csrfResponse.ok) return;
      csrfToken = (await csrfResponse.json()).csrfToken;
      const userResponse = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!userResponse.ok) return;
      accountUser = (await userResponse.json()).user;
      if (!accountUser) return;
      const progressResponse = await fetch('/api/progress', { credentials: 'same-origin', cache: 'no-store' });
      if (!progressResponse.ok) throw new Error('Server-Lernstand konnte nicht geladen werden.');
      accountProgress = await progressResponse.json();
    } catch {
      accountUser = null;
      accountProgress = null;
    }
  };

  const updateProgressUI = () => {
    const progress = loadProgress();
    const total = document.querySelectorAll('.curriculum-link').length;
    const completed = progress.completed.length;
    const percent = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    const count = document.querySelector('[data-quest-count]');
    const xp = document.querySelector('[data-quest-xp]');
    const level = document.querySelector('[data-quest-level]');
    const bar = document.querySelector('[data-quest-progress]');
    const progressBar = document.querySelector('.curriculum-progress-track');
    const label = document.querySelector('[data-quest-label]');

    if (count) count.textContent = `${completed} / ${total} Lektionen`;
    if (xp) xp.textContent = `${progress.xp} XP`;
    if (level) {
      const ranks = ['Code-Neuling', 'Script-Scout', 'Bug-Jäger', 'DOM-Zauberer', 'JS-Legende', 'JS-Meister'];
      const rankIndex = Math.min(ranks.length - 1, Math.floor(progress.xp / 100));
      level.textContent = `Level ${rankIndex + 1} · ${ranks[rankIndex]}`;
    }
    if (bar) bar.style.width = `${percent}%`;
    if (progressBar) progressBar.setAttribute('aria-valuenow', String(completed));
    if (label) label.textContent = `${percent}% geschafft`;

    document.querySelectorAll('.curriculum-link').forEach((link) => {
      const lessonId = link.getAttribute('href')?.split('/').pop()?.replace('.html', '');
      if (progress.completed.includes(lessonId)) {
        link.classList.add('is-complete');
        link.setAttribute('aria-label', `${link.querySelector('strong')?.textContent || 'Lektion'}, abgeschlossen`);
        const arrow = link.querySelector('span:last-child');
        if (arrow) {
          arrow.classList.add('quest-check');
          arrow.textContent = '✓';
        }
      }
    });
  };

  const createChallenge = () => {
    const { lessonId, quizQuestion, quizOptions, quizAnswer, quizHint } = document.body.dataset;
    if (!lessonId || !quizQuestion || !quizOptions) return;

    const main = document.querySelector('main');
    if (!main) return;
    const options = quizOptions.split('|');
    const challenge = document.createElement('section');
    challenge.className = 'quest-card';
    challenge.setAttribute('aria-labelledby', 'quest-title');
    challenge.innerHTML = `
      <div class="quest-heading">
        <span class="quest-icon" aria-hidden="true">✳</span>
        <div><p class="quest-kicker">BOSS-CHECK / +${XP_PER_LESSON} XP</p><h2 id="quest-title">Zeit für den Mini-Quest!</h2></div>
        <span class="quest-reward">+${XP_PER_LESSON} XP</span>
      </div>
      <p class="quest-question"></p>
      <fieldset class="quest-options"><legend class="sr-only">Wähle eine Antwort</legend></fieldset>
      <div class="quest-actions"><button class="quest-submit" type="button">Antwort prüfen <span aria-hidden="true">→</span></button><button class="quest-hint-button" type="button">Tipp anzeigen</button></div>
      <p class="quest-hint" hidden></p>
      <p class="quest-feedback" aria-live="polite" role="status"></p>`;

    challenge.querySelector('.quest-question').textContent = quizQuestion;
    const fieldset = challenge.querySelector('.quest-options');
    options.forEach((option, index) => {
      const label = document.createElement('label');
      label.className = 'quest-option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'quest-answer';
      radio.value = String(index);
      const text = document.createElement('span');
      text.textContent = option;
      label.append(radio, text);
      fieldset.append(label);
    });

    const lessonNav = main.querySelector('.lesson-nav, .exercise-nav');
    if (lessonNav) lessonNav.before(challenge);
    else main.append(challenge);

    const feedback = challenge.querySelector('.quest-feedback');
    const submit = challenge.querySelector('.quest-submit');
    const hint = challenge.querySelector('.quest-hint');
    const hintButton = challenge.querySelector('.quest-hint-button');
    hint.textContent = `💡 ${quizHint || 'Lies die Erklärung noch einmal und achte auf die Codebeispiele.'}`;

    const progress = loadProgress();
    const alreadyComplete = progress.completed.includes(lessonId);
    if (alreadyComplete) {
      challenge.classList.add('is-complete');
      feedback.textContent = 'Quest bereits geschafft — XP wurden gespeichert. Du kannst die Antwort trotzdem noch üben.';
    }

    hintButton.addEventListener('click', () => {
      hint.hidden = !hint.hidden;
      hintButton.textContent = hint.hidden ? 'Tipp anzeigen' : 'Tipp ausblenden';
    });

    submit.addEventListener('click', async () => {
      const selected = challenge.querySelector('input[name="quest-answer"]:checked');
      if (!selected) {
        feedback.textContent = 'Wähle erst eine Antwort aus.';
        challenge.classList.remove('is-correct');
        return;
      }
      if (selected.value !== quizAnswer) {
        feedback.textContent = 'Noch nicht ganz — lies den Tipp und versuche es noch einmal. Du schaffst das!';
        challenge.classList.remove('is-correct');
        challenge.classList.add('is-wrong');
        return;
      }

      challenge.classList.remove('is-wrong');
      challenge.classList.add('is-correct');
      if (!progress.completed.includes(lessonId)) {
        if (accountUser) {
          submit.disabled = true;
          try {
            const response = await fetch(`/api/progress/${encodeURIComponent(lessonId)}`, {
              method: 'PUT',
              credentials: 'same-origin',
              headers: { 'X-CSRF-Token': csrfToken }
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'Der Lernstand konnte nicht gespeichert werden.');
            accountProgress = result;
          } catch (error) {
            challenge.classList.remove('is-correct');
            feedback.textContent = `${error.message} Bitte prüfe die Verbindung und versuche es erneut.`;
            submit.disabled = false;
            return;
          }
          submit.disabled = false;
        } else {
          progress.completed.push(lessonId);
          progress.xp += XP_PER_LESSON;
          saveProgress(progress);
        }
        feedback.textContent = `Richtig! Quest geschafft — +${XP_PER_LESSON} XP. Weiter zum nächsten Thema! 🎉`;
      } else {
        feedback.textContent = 'Richtig! Quest erneut geschafft — deine XP hast du dafür schon erhalten. 🎉';
      }
      updateProgressUI();
    });
  };

  const init = async () => {
    await initializeServerAccount();
    createChallenge();
    updateProgressUI();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
