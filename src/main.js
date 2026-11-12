// Entry point: the token, the refresh loop and the buttons.

import { APPS } from './config.js';
import { GitHub, ApiError } from './github.js';
import { loadApp, newCache } from './load.js';
import { pipeline } from './model.js';
import { appSection, confirmText, workflowOf } from './view.js';

const TOKEN_KEY = 'pipelines.token';
const BUSY_EVERY = 15_000; // while something runs
const IDLE_EVERY = 120_000;

const $ = (id) => document.getElementById(id);
const state = APPS.map((app) => ({ app, cache: newCache(), result: null, error: null }));
let gh = null;
let timer = null;
let loading = false;

function render() {
  $('apps').replaceChildren(...(gh ? state.map((s) => appSection(s.app, s.result, s.error)) : []));
}

function say(text, kind = 'info') {
  const el = $('message');
  el.textContent = text;
  el.className = kind;
  el.hidden = !text;
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

async function refresh({ force = false } = {}) {
  if (!gh || loading) return;
  loading = true;
  clearTimeout(timer);
  $('refresh').disabled = true;
  try {
    await Promise.all(
      state.map(async (s) => {
        try {
          s.result = pipeline(s.app, await loadApp(gh, s.app, s.cache, { force }));
          s.error = null;
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) throw err;
          s.error = describe(err, s.app);
        }
      }),
    );
    $('updated').textContent = `à jour à ${new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
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
    s.error = null;
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
  if (!button || button.disabled || !gh) return;
  const { action, repo, sha, label } = button.dataset;
  if (!confirm(confirmText(action, label))) return;
  const workflow = workflowOf(action);
  button.disabled = true;
  try {
    await gh.dispatch(repo, workflow.file, sha);
    say(`« ${workflow.name} » lancé pour ${sha.slice(0, 7)}. Suivi ci-dessous dans quelques secondes.`);
    setTimeout(() => refresh(), 5_000);
  } catch (err) {
    say(err instanceof ApiError && err.status === 403
      ? 'Ce jeton ne peut pas lancer de workflow : il lui faut Actions en lecture et écriture.'
      : `Échec du lancement : ${err.message}`, 'error');
    button.disabled = false;
  }
});

const saved = localStorage.getItem(TOKEN_KEY);
if (saved) start(saved);
else askToken();
