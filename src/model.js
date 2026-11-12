// The pipeline of one application, computed from what the GitHub API returned. Pure functions:
// no DOM, no network (tested in test/model.test.js).
//
// Stages, in the order of the deployment pipeline:
//   commit       Deliver's jobs "test" and "build" (tests, image built once)
//   qa           deployed to qa and acceptance tests passed (deployment environment "qa")
//   androidQa    manual test stage: qa APK sent to the testers (environment "android-qa")
//   prod         web release (environment "prod")
//   androidProd  Android release (environment "android-prod")
//
// A stage's state: success, failure, cancelled, running, waiting or none.

import { WORKFLOWS } from './config.js';

export const STAGES = ['commit', 'qa', 'androidQa', 'prod', 'androidProd'];

const STAGE_ENV = { qa: 'qa', androidQa: 'android-qa', prod: 'prod', androidProd: 'android-prod' };
// The workflow started by hand that moves a version into each stage.
const STAGE_WORKFLOW = {
  qa: WORKFLOWS.deployQa.name,
  androidQa: WORKFLOWS.testAndroid.name,
  prod: WORKFLOWS.promote.name,
  androidProd: WORKFLOWS.promote.name,
};

// State of a workflow run or job (same fields).
export function runState(run) {
  if (!run) return 'none';
  if (run.status !== 'completed') return ['queued', 'waiting', 'pending', 'requested'].includes(run.status) ? 'waiting' : 'running';
  switch (run.conclusion) {
    case 'success':
      return 'success';
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
    case 'neutral':
      return 'none';
    default:
      return 'failure';
  }
}

// State of a deployment from its statuses (newest first). "inactive" only means a newer deployment
// to the same environment succeeded after this one: it had succeeded.
export function deploymentState(statuses) {
  if (!statuses || statuses.length === 0) return 'waiting';
  const s = statuses.find((x) => x.state !== 'inactive');
  if (!s) return 'success';
  return (
    { success: 'success', failure: 'failure', error: 'cancelled', in_progress: 'running', queued: 'waiting', pending: 'waiting' }[s.state] ??
    'waiting'
  );
}

// Whether a deployment's statuses can no longer change what deploymentState says.
export function isFinal(statuses) {
  return ['success', 'failure', 'cancelled'].includes(deploymentState(statuses));
}

const time = (iso) => (iso ? Date.parse(iso) : 0);

function combine(states) {
  if (states.includes('failure')) return 'failure';
  if (states.includes('cancelled')) return 'cancelled';
  if (states.every((s) => s === 'success')) return 'success';
  if (states.includes('running')) return 'running';
  return 'waiting';
}

function commitStage(run, jobs) {
  if (!run) return { state: 'none' };
  const own = (jobs ?? []).filter((j) => j.name === 'test' || j.name === 'build');
  if (own.length === 0) return { state: runState(run), link: run.html_url };
  const state = combine(own.map(runState));
  const failed = own.find((j) => runState(j) === 'failure');
  return { state, link: failed?.html_url ?? run.html_url };
}

// The deployments of a version to an environment.
function deploymentsOf(deployments, sha) {
  return (deployments ?? []).filter((d) => d.sha === sha);
}

// The newest of what happened to a version in a stage: its deployments, the runs started by hand
// for it (named after its sha), and, for qa, the deploy job of Deliver.
function stage(name, sha, data, deliverJob) {
  const events = [];
  for (const d of deploymentsOf(data.deployments[STAGE_ENV[name]], sha)) {
    const latest = d.statuses?.find((s) => s.state !== 'inactive') ?? d.statuses?.[0];
    events.push({
      at: time(d.created_at),
      state: deploymentState(d.statuses),
      link: latest?.log_url || null,
      versionCode: d.payload?.version_code ?? null,
    });
  }
  for (const r of data.dispatchRuns ?? []) {
    if (r.name === STAGE_WORKFLOW[name] && (r.display_title ?? '').includes(sha)) {
      events.push({ at: time(r.created_at), state: runState(r), link: r.html_url });
    }
  }
  if (deliverJob && runState(deliverJob) !== 'none') {
    events.push({ at: time(deliverJob.created_at ?? deliverJob.started_at), state: runState(deliverJob), link: deliverJob.html_url });
  }
  if (events.length === 0) return { state: 'none' };
  events.sort((a, b) => b.at - a.at);
  const newest = events[0];
  // A run started by hand ends after the deployment it created: the deployment says more.
  return { state: newest.state, link: newest.link, versionCode: events.find((e) => e.versionCode != null)?.versionCode ?? null };
}

const everSucceeded = (deployments, sha) => deploymentsOf(deployments, sha).some((d) => deploymentState(d.statuses) === 'success');

// The version an environment runs: the newest deployment that succeeded. For qa and prod the app
// itself says it (live), which also covers a version deployed but refused by its acceptance tests.
function current(deployments, live) {
  if (typeof live === 'string' && live) return live;
  const ok = (deployments ?? []).filter((d) => deploymentState(d.statuses) === 'success').sort((a, b) => time(b.created_at) - time(a.created_at));
  return ok[0]?.sha ?? null;
}

const busy = (s) => s === 'running' || s === 'waiting';

/**
 * data: {
 *   commits: [{ sha, commit: { message, author: { date } }, html_url }]   (newest first)
 *   deliverRuns: [workflow run]                (Deliver, push to main, newest first)
 *   jobs: { [runId]: [job] }
 *   deployments: { qa: [deployment with .statuses], 'android-qa': …, prod: …, 'android-prod': … }
 *   dispatchRuns: [workflow run]               (started by hand, newest first)
 *   live: { qa: sha | null, prod: sha | null }
 * }
 * app: { android: boolean }
 */
export function pipeline(app, data) {
  const where = {
    qa: current(data.deployments.qa, data.live?.qa),
    prod: current(data.deployments.prod, data.live?.prod),
    androidQa: current(data.deployments['android-qa']),
    androidProd: current(data.deployments['android-prod']),
  };
  const rows = data.commits.map((c) => {
    const sha = c.sha;
    const run = (data.deliverRuns ?? []).find((r) => r.head_sha === sha);
    const jobs = run ? data.jobs?.[run.id] : null;
    const deliverQa = jobs?.find((j) => j.name.startsWith('deploy-qa'));
    const stages = {
      commit: commitStage(run, jobs),
      qa: stage('qa', sha, data, deliverQa),
      androidQa: stage('androidQa', sha, data),
      prod: stage('prod', sha, data),
      androidProd: stage('androidProd', sha, data),
    };
    // Deliver's deploy job only succeeds once the acceptance tests passed (and qa-<sha> is tagged),
    // also for the versions deployed before deployments were recorded.
    const accepted = everSucceeded(data.deployments.qa, sha) || runState(deliverQa) === 'success';
    const tested = everSucceeded(data.deployments['android-qa'], sha) || everSucceeded(data.deployments['android-prod'], sha);
    const actions = {
      deployQa:
        stages.commit.state !== 'success'
          ? { enabled: false, reason: "L'étape de commit n'a pas réussi pour cette version." }
          : where.qa === sha
            ? { enabled: false, reason: 'Cette version est déjà en qa.' }
            : busy(stages.qa.state)
              ? { enabled: false, reason: 'Un déploiement en qa est en cours.' }
              : { enabled: true },
      testAndroid: !app.android
        ? { enabled: false, reason: "Pas d'application Android." }
        : !accepted
          ? { enabled: false, reason: "Cette version n'a pas passé les tests d'acceptation en qa." }
          : busy(stages.androidQa.state)
            ? { enabled: false, reason: 'Les APK de cette version sont en cours de construction.' }
            : where.androidQa === sha
              ? { enabled: false, reason: 'Les testeurs ont déjà cette version.' }
              : { enabled: true },
      promote: !accepted
        ? { enabled: false, reason: "Cette version n'a pas passé les tests d'acceptation en qa." }
        : app.android && !tested
          ? { enabled: false, reason: "Cette version n'a pas été testée sur Android." }
          : where.prod === sha && (!app.android || where.androidProd === sha)
            ? { enabled: false, reason: 'Cette version est déjà en prod.' }
            : busy(stages.prod.state) || busy(stages.androidProd.state)
              ? { enabled: false, reason: 'Une mise en prod est en cours.' }
              : { enabled: true },
    };
    return {
      sha,
      short: sha.slice(0, 7),
      title: (c.commit?.message ?? '').split('\n')[0],
      date: c.commit?.author?.date ?? c.commit?.committer?.date ?? null,
      link: c.html_url,
      here: Object.entries(where)
        .filter(([, s]) => s === sha)
        .map(([env]) => env),
      stages,
      actions,
    };
  });
  return { rows, where, busy: rows.some((r) => STAGES.some((s) => busy(r.stages[s].state))) };
}
