// Renders the pipelines, compact enough for a phone: per version, one line for the commit and one
// for its five stages, an icon and a duration each. A button that can be used takes the place of
// the stage it starts. Text from GitHub (commit messages)
// only ever goes through textContent.

import { WORKFLOWS, keyOf } from './config.js';
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
  ['androidProd', 'Prod 📱', 'Prod Android (APK publié)'],
];

// Each button shows in place of a stage it starts (its slot, see pipeline() in model.js).
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

// A button that starts a workflow for a version (see main.js); state: that of the stage it takes
// the place of.
function button(app, sha, key, label, name, state, extra = {}) {
  const was = state === 'none' ? '' : ` (actuellement : ${STATE[state] ?? state})`;
  return h(
    'button',
    {
      type: 'button',
      class: `go was-${state}${extra.class ? ` ${extra.class}` : ''}`, // a failure frames it in red
      title: `${name}${was}`,
      'aria-label': `${name}${was}`,
      'data-action': key,
      'data-repo': app.repo,
      'data-app': app.name,
      'data-sha': sha,
    },
    label,
    extra.children ?? null,
  );
}

function row(app, r, now) {
  const slots = {};
  for (const [key, label, name] of ACTIONS) if (r.actions[key].slot) slots[r.actions[key].slot] = [key, label, name];
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
      COLUMNS.map(([key, , name]) =>
        slots[key] ? button(app, r.sha, ...slots[key], r.stages[key].state) : stageCell(key, name, r.stages[key], now),
      ),
    ),
  );
}

export function appSection(app, result, error, now = Date.now()) {
  const head = h(
    'h2',
    {},
    h('span', { class: 'sr-only' }, app.name), // the menu shows it
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
    h('div', { class: 'grid legend', 'aria-hidden': 'true' }, COLUMNS.map(([, legend, name]) => h('span', { title: name }, legend))),
    result.rows.map((r) => row(app, r, now)),
  );
}

// The question asked before starting a workflow: which application and which version.
export function confirmText(action, appName, sha) {
  const what = `${appName} ${sha.slice(0, 7)}`;
  return { deployQa: `Déployer ${what} en QA ?`, promote: `Mettre ${what} en prod ?` }[action];
}

export const workflowOf = (action) => WORKFLOWS[action];

// The overview: per application, the version each environment runs and whether it is up to date
// with main (✓) or how many commits behind (−3), and under it the buttons that move it on: ▶ QA
// (the newest commit of main) under QA, ▶ Prod (the version in QA) under Prod. The name opens the
// application's pipeline. Only the applications the token reaches are given.
function versionCell(name, env, read) {
  if (!env) return h('span', { class: 'version none', title: `${name} : rien`, 'aria-label': `${name} : rien` }, '—');
  const late = env.behind === null ? `${read}+` : String(env.behind);
  const tip = env.behind === 0 ? `${name} : ${env.short}, à jour avec main` : `${name} : ${env.short}, ${late} commit(s) de retard sur main`;
  return h(
    'span',
    { class: `version ${env.behind === 0 ? 'fresh' : 'late'}`, title: tip, 'aria-label': tip },
    h('span', { class: 'vsha' }, env.short),
    h('span', { class: 'badge' }, env.behind === 0 ? '✓' : `−${late}`),
  );
}

export function overview(states) {
  if (!states.length) return h('section', { class: 'overview' }, h('p', { class: 'error' }, 'Ce jeton n’a accès à aucune des applications.'));
  return h(
    'section',
    { class: 'overview' },
    h('div', { class: 'ogrid legend', 'aria-hidden': 'true' }, h('span', {}, ''), COLUMNS.slice(1).map(([, legend, name]) => h('span', { title: name }, legend))),
    states.map(({ app, summary, error }) =>
      h(
        'div',
        { class: 'ogrid orow' },
        h(
          'a',
          { class: 'oapp', href: `#${keyOf(app)}` },
          h('span', { class: 'oname' }, app.name, summary?.busy ? h('span', { class: 'cell running mini', title: 'Une étape est en cours' }, h('span', { class: 'icon' })) : null),
          h('span', { class: 'ohead' }, summary?.head ? `main ${summary.head.short}` : ''),
        ),
        error
          ? h('span', { class: 'error oerror' }, error)
          : !summary
            ? h('span', { class: 'loading oerror' }, 'Chargement…')
            : [
                ...COLUMNS.slice(1).map(([key, , name]) => versionCell(name, summary.envs[key], summary.read)),
                ...overviewButtons(app, summary.actions),
              ],
      ),
    ),
  );
}

function overviewButtons(app, actions) {
  return ACTIONS.map(([key, label, name]) => {
    const v = actions[key];
    if (!v) return null;
    return button(app, v.sha, key, label, `${name} ${v.short} : ${v.title}`, v.was, {
      class: `ogo ${key}`,
      children: h('span', { class: 'vsha' }, v.short),
    });
  });
}
