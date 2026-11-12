// Renders the pipelines, compact enough for a phone: per version, one line for the commit and one
// for its stages (an icon and a duration each) and its buttons. Text from GitHub (commit messages)
// only ever goes through textContent.

import { WORKFLOWS } from './config.js';
import { shortDuration, longDuration, elapsed, age } from './format.js';

const STATE = {
  success: 'réussi',
  failure: 'échec',
  cancelled: 'annulé',
  running: 'en cours',
  waiting: 'en attente',
  none: 'pas encore',
};

// key, legend, name in the tooltips
const COLUMNS = [
  ['commit', 'Commit', 'Commit (tests et image)'],
  ['qa', 'QA 🌐', 'QA web (déploiement et tests d’acceptation)'],
  ['androidQa', 'QA 📱', 'QA Android (APK envoyé aux testeurs)'],
  ['prod', 'Prod 🌐', 'Prod web'],
  ['androidProd', 'Prod 📱', 'Prod Android (APK envoyé au groupe family)'],
];

const ACTIONS = [
  // U+FE0E: the triangle as text, not as an emoji (iOS).
  ['deployQa', '▶\uFE0E QA', 'Déployer en QA'],
  ['promote', '▶\uFE0E Prod', 'Mettre en prod'],
];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('data-') || k.startsWith('aria-')) el.setAttribute(k, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

// Where a version is: QA and Prod, with 🌐 or 📱 when only the web or only Android is there.
function chips(app, here) {
  const out = [];
  for (const [env, web, android] of [['qa', 'qa', 'androidQa'], ['prod', 'prod', 'androidProd']]) {
    const w = here.includes(web);
    const a = app.android && here.includes(android);
    if (!w && !a) continue;
    const both = w && (a || !app.android);
    const label = `${env === 'qa' ? 'QA' : 'Prod'}${both ? '' : w ? ' 🌐' : ' 📱'}`;
    out.push(h('span', { class: `chip ${env}` }, label));
  }
  return out;
}

function stageCell(key, name, stage, now) {
  const ms = elapsed(stage.start, stage.end, now);
  const running = stage.state === 'running' || stage.state === 'waiting';
  const time = ms == null ? '' : shortDuration(ms);
  const tip = [
    `${name} : ${STATE[stage.state] ?? stage.state}`,
    ms == null ? '' : running ? ` depuis ${longDuration(ms)}` : ` en ${longDuration(ms)}`,
    stage.versionCode != null ? ` (APK ${stage.versionCode})` : '',
  ].join('');
  return h(
    stage.link ? 'a' : 'span',
    {
      class: `cell ${stage.state}`,
      href: stage.link ?? null,
      target: stage.link ? '_blank' : null,
      rel: stage.link ? 'noopener' : null,
      title: tip,
      'aria-label': tip,
    },
    h('span', { class: 'icon', 'aria-hidden': 'true' }),
    // A running stage's time is updated every second (see main.js).
    h('span', { class: 'time', 'data-since': running && stage.start ? stage.start : null }, time),
  );
}

function row(app, r, now) {
  return h(
    'div',
    { class: `row${r.here.length ? ' here' : ''}` },
    h(
      'div',
      { class: 'line' },
      h('a', { class: 'sha', href: r.link, target: '_blank', rel: 'noopener' }, r.short),
      chips(app, r.here),
      h('span', { class: 'title', title: r.title }, r.title),
      h('span', { class: 'age', title: r.date ? new Date(r.date).toLocaleString('fr-BE') : '' }, age(r.date, now)),
    ),
    h(
      'div',
      { class: 'grid' },
      COLUMNS.map(([key, , name]) => stageCell(key, name, r.stages[key], now)),
      h(
        'span',
        { class: 'actions' },
        ACTIONS.map(([key, label, name]) =>
          h(
            'button',
            {
              type: 'button',
              class: r.actions[key].enabled ? 'go' : 'go off',
              title: r.actions[key].enabled ? name : `${name} : ${r.actions[key].reason}`,
              'aria-label': name,
              'aria-disabled': r.actions[key].enabled ? null : 'true',
              'data-action': key,
              'data-repo': app.repo,
              'data-sha': r.sha,
              'data-reason': r.actions[key].reason ?? null,
            },
            label,
          ),
        ),
      ),
    ),
  );
}

export function appSection(app, result, error, now = Date.now()) {
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
    h('div', { class: 'grid legend', 'aria-hidden': 'true' }, COLUMNS.map(([, legend, name]) => h('span', { title: name }, legend)), h('span', {})),
    result.rows.map((r) => row(app, r, now)),
  );
}

export function confirmText(action) {
  return { deployQa: 'Déployer en QA ?', promote: 'Mettre en prod ?' }[action];
}

export const workflowOf = (action) => WORKFLOWS[action];
