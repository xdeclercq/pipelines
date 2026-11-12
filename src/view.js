// Renders the pipelines. Text from GitHub (commit messages) only ever goes through textContent.

import { WORKFLOWS } from './config.js';

const STATE = {
  success: ['✓', 'réussi'],
  failure: ['✗', 'échec'],
  cancelled: ['⊘', 'annulé'],
  running: ['●', 'en cours'],
  waiting: ['…', 'en attente'],
  none: ['', ''],
};

const COLUMNS = [
  ['commit', 'Commit', 'Tests et image, à chaque push sur main'],
  ['qa', 'Acceptation', 'Déployée en qa, tests d’acceptation passés'],
  ['androidQa', 'Test Android', 'APK qa envoyé aux testeurs (groupe Firebase « qa »)'],
  ['prod', 'Prod web', 'Image en prod'],
  ['androidProd', 'Prod Android', 'APK prod envoyé au groupe « family »'],
];

const ACTIONS = [
  ['deployQa', 'Déployer en qa'],
  ['testAndroid', 'Tester sur Android'],
  ['promote', 'Mettre en prod'],
];

const HERE = { qa: 'qa', prod: 'prod', androidQa: 'android qa', androidProd: 'android prod' };

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('data-')) el.setAttribute(k, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const s = (Date.parse(iso) - now) / 1000;
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
  }
  return 'à l’instant';
}

function stageCell(stage) {
  const [icon, label] = STATE[stage.state] ?? STATE.none;
  const text = stage.state === 'none' ? '—' : `${icon} ${label}`;
  const content = stage.link ? h('a', { href: stage.link, target: '_blank', rel: 'noopener' }, text) : text;
  return h(
    'td',
    { class: `stage ${stage.state}` },
    content,
    stage.versionCode != null && stage.state !== 'none' ? h('span', { class: 'code', title: 'versionCode de l’APK' }, ` ${stage.versionCode}`) : null,
  );
}

function row(app, r) {
  return h(
    'tr',
    { class: r.here.length ? 'here' : '' },
    h(
      'td',
      { class: 'version' },
      h('a', { class: 'sha', href: r.link, target: '_blank', rel: 'noopener' }, r.short),
      r.here.map((env) => h('span', { class: `chip ${env}` }, HERE[env])),
      h('div', { class: 'title', title: r.title }, r.title),
      h('div', { class: 'date' }, ago(r.date)),
    ),
    COLUMNS.map(([key]) => stageCell(r.stages[key])),
    h(
      'td',
      { class: 'actions' },
      h(
        'div',
        {},
        ACTIONS.filter(([key]) => app.android || key !== 'testAndroid').map(([key, label]) =>
        h(
          'button',
          {
            type: 'button',
            disabled: !r.actions[key].enabled,
            title: r.actions[key].reason ?? '',
            'data-action': key,
            'data-repo': app.repo,
            'data-sha': r.sha,
            'data-label': `${r.short} « ${r.title} »`,
          },
          label,
        ),
      ),
      ),
    ),
  );
}

export function appSection(app, result, error) {
  const head = h(
    'h2',
    {},
    app.name,
    h('a', { href: app.qa, target: '_blank', rel: 'noopener' }, 'qa'),
    h('a', { href: app.prod, target: '_blank', rel: 'noopener' }, 'prod'),
    h('a', { href: `https://github.com/${app.repo}/actions`, target: '_blank', rel: 'noopener' }, 'Actions'),
  );
  if (error) return h('section', { class: 'app' }, head, h('p', { class: 'error' }, error));
  if (!result) return h('section', { class: 'app' }, head, h('p', { class: 'loading' }, 'Chargement…'));
  return h(
    'section',
    { class: 'app' },
    head,
    h(
      'div',
      { class: 'table' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Version'), COLUMNS.map(([, label, title]) => h('th', { title }, label)), h('th', {}, ''))),
        h('tbody', {}, result.rows.map((r) => row(app, r))),
      ),
    ),
  );
}

export function confirmText(action, label) {
  return {
    deployQa: `Déployer ${label} en qa ?\n(tests d’acceptation ensuite)`,
    testAndroid: `Construire les APK qa et prod de ${label} et envoyer l’APK qa aux testeurs ?`,
    promote: `Mettre ${label} en prod, web et Android ?`,
  }[action];
}

export const workflowOf = (action) => WORKFLOWS[action];
