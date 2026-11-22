// Entry point: the token, the menu, the refresh loop and the buttons.

import { APPS, keyOf, WORKFLOWS } from './config.js';
import { GitHub, ApiError } from './github.js';
import { loadApp, newCache } from './load.js';
import { pipeline, summary } from './model.js';
import { appSection, overview, confirmText, startedText } from './view.js';
import { shortDuration } from './format.js';

const TOKEN_KEY = 'pipelines.token';
const VIEW_KEY = 'pipelines.view';
const OVERVIEW = 'apercu';
const BUSY_EVERY = 15_000; // while something runs
const IDLE_EVERY = 120_000;

const $ = (id) => document.getElementById(id);
// hidden: the token has no access to the repository (a fine-grained token limited to some of
// them); such an application leaves the menu and the overview until a forced refresh finds it.
const state = APPS.map((app) => ({ app, cache: newCache(), result: null, summary: null, error: null, hidden: false }));
const shown = () => state.filter((s) => !s.hidden);
let gh = null;
let timer = null;
let loading = false;

// The view shown: the overview, or one application the token reaches (#tabula). The address wins,
// then the last choice, then the overview.
const views = () => [OVERVIEW, ...shown().map((s) => keyOf(s.app))];
function currentView() {
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (views().includes(fromHash)) return fromHash;
  const saved = localStorage.getItem(VIEW_KEY);
  return views().includes(saved) ? saved : OVERVIEW;
}

// Rebuilt only when the applications reached change, so a refresh does not close an open menu.
let menuKeys = null;
function menu() {
  const select = $('view');
  const keys = views().join();
  if (keys !== menuKeys) {
    menuKeys = keys;
    select.replaceChildren(
      new Option('Vue d’ensemble', OVERVIEW),
      ...shown().map((s) => new Option(s.app.name, keyOf(s.app))),
    );
  }
  select.value = currentView();
}

function render() {
  menu();
  if (!gh) return $('apps').replaceChildren();
  const view = currentView();
  if (view === OVERVIEW) return $('apps').replaceChildren(overview(shown()));
  const s = state.find((x) => keyOf(x.app) === view);
  $('apps').replaceChildren(appSection(s.app, s.result, s.error));
}

$('view').addEventListener('change', () => {
  const view = $('view').value;
  localStorage.setItem(VIEW_KEY, view);
  location.hash = view === OVERVIEW ? '' : view;
  render();
});
window.addEventListener('hashchange', () => {
  const view = currentView();
  localStorage.setItem(VIEW_KEY, view);
  render();
});

let sayTimer = null;
// A message under the header; information goes away by itself after a few seconds.
function say(text, kind = 'info') {
  const el = $('message');
  el.textContent = text;
  el.className = kind;
  el.hidden = !text;
  clearTimeout(sayTimer);
  if (text && kind === 'info') sayTimer = setTimeout(() => (el.hidden = true), 6_000);
}

function askToken(reason) {
  gh = null;
  clearTimeout(timer);
  $('token-form').hidden = false;
  $('forget').hidden = true;
  say(reason ?? '', reason ? 'error' : 'info');
  $('token').focus();
}

function describe(err, app) {
  if (err instanceof ApiError) {
    if (err.status === 404) return `Ce jeton n’a pas accès à ${app.repo} (ou à ses déploiements et workflows).`;
    if (err.status === 403) return `GitHub refuse : ${err.message}`;
  }
  return `Erreur : ${err.message}`;
}

// Whether the token cannot see the repository at all: GitHub answers 404 for a private repository
// outside a fine-grained token's selection. Any other answer leaves the error shown.
async function outOfReach(gh, app) {
  try {
    await gh.get(`/repos/${app.repo}`);
    return false;
  } catch (err) {
    return err instanceof ApiError && err.status === 404;
  }
}

async function refresh({ force = false } = {}) {
  if (!gh || loading) return;
  loading = true;
  clearTimeout(timer);
  $('refresh').disabled = true;
  try {
    const client = gh;
    await Promise.all(
      state
        .filter((s) => force || !s.hidden)
        .map(async (s) => {
          try {
            const data = await loadApp(client, s.app, s.cache, { force });
            s.result = pipeline(s.app, data);
            s.summary = summary(s.app, data, s.result);
            s.error = null;
            s.hidden = false;
          } catch (err) {
            if (err instanceof ApiError && err.status === 401) throw err;
            s.hidden = err instanceof ApiError && err.status === 404 && (await outOfReach(client, s.app));
            s.result = s.hidden ? null : s.result;
            s.summary = s.hidden ? null : s.summary;
            s.error = s.hidden ? null : describe(err, s.app);
          }
        }),
    );
    $('updated').textContent = new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
    render();
    const busy = state.some((s) => s.result?.busy);
    timer = setTimeout(() => !document.hidden && refresh(), busy ? BUSY_EVERY : IDLE_EVERY);
  } catch (err) {
    askToken('Jeton refusé par GitHub (expiré ou révoqué) : collez-en un nouveau.');
  } finally {
    loading = false;
    $('refresh').disabled = false;
  }
}

function start(token) {
  gh = new GitHub(token);
  $('token-form').hidden = true;
  $('forget').hidden = false;
  say('');
  render();
  refresh({ force: true });
}

$('token-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const token = $('token').value.trim();
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
  $('token').value = '';
  start(token);
});

$('forget').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  state.forEach((s) => {
    s.result = null;
    s.summary = null;
    s.error = null;
    s.hidden = false;
    s.cache = newCache();
  });
  askToken();
  render();
});

$('refresh').addEventListener('click', () => refresh({ force: true }));

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});

$('apps').addEventListener('click', async (e) => {
  const button = e.target.closest('button[data-action]');
  if (!button || !gh) return;
  // Already started: no second click while it launches.
  if (button.getAttribute('aria-disabled') === 'true') return;
  const { action, repo, sha, app, run } = button.dataset;
  if (!confirm(confirmText(action, app, sha))) return;
  button.setAttribute('aria-disabled', 'true');
  try {
    if (action === 'rerun') await gh.rerunFailed(repo, run);
    else await gh.dispatch(repo, WORKFLOWS[action].file, sha);
    say(startedText(action, sha));
    setTimeout(() => refresh(), 5_000);
  } catch (err) {
    say(err instanceof ApiError && err.status === 403
      ? 'Ce jeton ne peut pas lancer de workflow : il lui faut Actions en lecture et écriture.'
      : `Échec du lancement : ${err.message}`, 'error');
    button.removeAttribute('aria-disabled');
  }
});

// The time of what runs, every second.
setInterval(() => {
  const now = Date.now();
  for (const el of document.querySelectorAll('[data-since]')) el.textContent = shortDuration(now - Date.parse(el.dataset.since));
}, 1_000);

const saved = localStorage.getItem(TOKEN_KEY);
if (saved) start(saved);
else {
  askToken();
  render();
}
