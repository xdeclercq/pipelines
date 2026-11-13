// The pipeline of one application, computed from what the GitHub API returned. Pure functions:
// no DOM, no network (tested in test/model.test.js).
//
// Stages, in the order of the deployment pipeline:
//   commit       Deliver's jobs "test" and "build" (tests, image built once)
//   qa           web deployed to qa and acceptance tests passed (deployment environment "qa")
//   androidQa    qa APK sent to the testers, by "Deploy to qa" (environment "android-qa")
//   prod         web release (environment "prod")
//   androidProd  Android release (environment "android-prod")
//
// A stage's state: success, failure, cancelled, running, waiting or none; with its start and end
// (ISO dates; no end while it runs) when known.

import { WORKFLOWS, RECENT } from './config.js';

export const STAGES = ['commit', 'qa', 'androidQa', 'prod', 'androidProd'];

const STAGE_ENV = { qa: 'qa', androidQa: 'android-qa', prod: 'prod', androidProd: 'android-prod' };
// The workflow started by hand that moves a version into each stage (its file: a run's `name` is
// its run-name, "Deploy <sha> to qa"), and the prefix of its jobs doing that stage ("deploy / …",
// "android-build / …", "android-qa / …"); its first job, "resolve", checks for all of them.
const STAGE_WORKFLOW = {
  qa: WORKFLOWS.deployQa.file,
  androidQa: WORKFLOWS.deployQa.file,
  prod: WORKFLOWS.promote.file,
  androidProd: WORKFLOWS.promote.file,
};
const STAGE_JOBS = { qa: 'deploy', androidQa: 'android', prod: 'deploy', androidProd: 'android' };
const fileOf = (run) => (run.path ?? '').split('/').pop();
// The last stage each of those workflows reaches: where its failure shows when it left no
// deployment saying more (refused at the start, or the APK build failed).
const LAST_STAGE = (app, file) =>
  file === WORKFLOWS.deployQa.file ? (app.android ? 'androidQa' : 'qa') : app.android ? 'androidProd' : 'prod';

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
const busy = (s) => s === 'running' || s === 'waiting';

function combine(states) {
  if (states.includes('failure')) return 'failure';
  if (states.includes('cancelled')) return 'cancelled';
  if (states.every((s) => s === 'success')) return 'success';
  if (states.includes('running')) return 'running';
  return 'waiting';
}

const earliest = (dates) => dates.filter(Boolean).sort()[0] ?? null;
const latest = (dates) => dates.filter(Boolean).sort().at(-1) ?? null;

function commitStage(run, jobs) {
  if (!run) return { state: 'none' };
  const own = (jobs ?? []).filter((j) => j.name === 'test' || j.name === 'build');
  if (own.length === 0) {
    const state = runState(run);
    return { state, link: run.html_url, start: run.run_started_at ?? run.created_at ?? null, end: busy(state) ? null : (run.updated_at ?? null) };
  }
  const state = combine(own.map(runState));
  const failed = own.find((j) => runState(j) === 'failure');
  return {
    state,
    link: failed?.html_url ?? run.html_url,
    start: earliest(own.map((j) => j.started_at)),
    end: own.every((j) => j.status === 'completed') ? latest(own.map((j) => j.completed_at)) : null,
  };
}

// The deployments of a version to an environment.
function deploymentsOf(deployments, sha) {
  return (deployments ?? []).filter((d) => d.sha === sha);
}

// What a run that is still going does in a stage, from its jobs: nothing once that stage's jobs
// are all done or skipped (its deployment then says how it went), else running or waiting, since
// its first job of that stage started (or since the run started). Without its jobs: running.
function runningStage(run, name, jobs) {
  const at = time(run.created_at);
  const runStart = run.run_started_at ?? run.created_at ?? null;
  if (!jobs) return { at, state: runState(run), link: run.html_url, start: runStart, end: null };
  const own = jobs.filter((j) => j.name.startsWith(STAGE_JOBS[name]));
  if (own.length > 0 && own.every((j) => j.status === 'completed')) return null;
  const going = own.find((j) => runState(j) === 'running');
  return {
    at,
    state: going || jobs.some((j) => j.name === 'resolve' && runState(j) === 'running') ? 'running' : 'waiting',
    link: going?.html_url ?? run.html_url,
    start: earliest(own.map((j) => j.started_at)) ?? runStart,
    end: null,
  };
}

// The newest of what happened to a version in a stage: its deployments, the runs started by hand
// for it (named after its sha) while they run, or that failed if it is their last stage, and, for
// qa, the deploy job of Deliver.
function stage(app, name, sha, data, deliverJob) {
  const events = [];
  for (const d of deploymentsOf(data.deployments[STAGE_ENV[name]], sha)) {
    const status = d.statuses?.find((s) => s.state !== 'inactive') ?? d.statuses?.[0];
    const state = deploymentState(d.statuses);
    events.push({
      at: time(d.created_at),
      state,
      link: status?.log_url || null,
      versionCode: d.payload?.version_code ?? null,
      start: d.created_at ?? null,
      end: busy(state) ? null : (status?.created_at ?? null),
    });
  }
  for (const r of data.dispatchRuns ?? []) {
    if (fileOf(r) !== STAGE_WORKFLOW[name] || !(r.display_title ?? '').includes(sha)) continue;
    const state = runState(r);
    if (busy(state)) {
      const event = runningStage(r, name, data.dispatchJobs?.[r.id]);
      if (event) events.push(event);
    } else if ((state === 'failure' || state === 'cancelled') && LAST_STAGE(app, fileOf(r)) === name) {
      events.push({ at: time(r.created_at), state, link: r.html_url, start: r.run_started_at ?? r.created_at ?? null, end: r.updated_at ?? null });
    }
  }
  if (deliverJob && runState(deliverJob) !== 'none') {
    const state = runState(deliverJob);
    events.push({
      at: time(deliverJob.created_at ?? deliverJob.started_at),
      state,
      link: deliverJob.html_url,
      start: deliverJob.started_at ?? deliverJob.created_at ?? null,
      end: busy(state) ? null : (deliverJob.completed_at ?? null),
    });
  }
  if (events.length === 0) return { state: 'none' };
  events.sort((a, b) => b.at - a.at);
  const newest = events[0];
  return {
    state: newest.state,
    link: newest.link,
    start: newest.start ?? null,
    end: newest.end ?? null,
    versionCode: events.find((e) => e.versionCode != null)?.versionCode ?? null,
  };
}

const everSucceeded = (deployments, sha) => deploymentsOf(deployments, sha).some((d) => deploymentState(d.statuses) === 'success');

// The version an environment runs: the newest deployment that succeeded. For qa and prod the app
// itself says it (live), which also covers a version deployed but refused by its acceptance tests.
function current(deployments, live) {
  if (typeof live === 'string' && live) return live;
  const ok = (deployments ?? []).filter((d) => deploymentState(d.statuses) === 'success').sort((a, b) => time(b.created_at) - time(a.created_at));
  return ok[0]?.sha ?? null;
}

/**
 * data: {
 *   commits: [{ sha, commit: { message, author: { date } }, html_url }]   (newest first)
 *   deliverRuns: [workflow run]                (Deliver, push to main, newest first)
 *   jobs: { [runId]: [job] }
 *   deployments: { qa: [deployment with .statuses], 'android-qa': …, prod: …, 'android-prod': … }
 *   dispatchRuns: [workflow run]               (started by hand, newest first)
 *   dispatchJobs: { [runId]: [job] }           (of those still going)
 *   live: { qa: sha | null, prod: sha | null }
 * }
 * app: { android: boolean }
 */
// Where each environment is: { qa, prod, androidQa, androidProd } → sha or null.
export function positions(data) {
  return {
    qa: current(data.deployments.qa, data.live?.qa),
    prod: current(data.deployments.prod, data.live?.prod),
    androidQa: current(data.deployments['android-qa']),
    androidProd: current(data.deployments['android-prod']),
  };
}

// The versions shown: the RECENT newest commits, then those in qa or prod, newest first.
export function shownCommits(commits, where) {
  const placed = new Set(Object.values(where).filter(Boolean));
  return commits.filter((c, i) => i < RECENT || placed.has(c.sha));
}

export function pipeline(app, data) {
  const where = positions(data);
  const rows = shownCommits(data.commits, where).map((c) => {
    const sha = c.sha;
    const run = (data.deliverRuns ?? []).find((r) => r.head_sha === sha);
    const jobs = run ? data.jobs?.[run.id] : null;
    // The deploy job itself ("deploy-qa / deploy"); some repositories run a check job before it.
    const deliverQa = jobs?.find((j) => j.name === 'deploy-qa / deploy') ?? jobs?.find((j) => j.name.startsWith('deploy-qa'));
    const stages = {
      commit: commitStage(run, jobs),
      qa: stage(app, 'qa', sha, data, deliverQa),
      androidQa: stage(app, 'androidQa', sha, data),
      prod: stage(app, 'prod', sha, data),
      androidProd: stage(app, 'androidProd', sha, data),
    };
    // Deliver's deploy job only succeeds once the acceptance tests passed (and qa-<sha> is tagged),
    // also for the versions deployed before deployments were recorded.
    const accepted = everSucceeded(data.deployments.qa, sha) || runState(deliverQa) === 'success';
    const tested = everSucceeded(data.deployments['android-qa'], sha) || everSucceeded(data.deployments['android-prod'], sha);
    const inQa = where.qa === sha && (!app.android || where.androidQa === sha);
    const actions = {
      // Web then APKs: the workflow runs the acceptance tests itself before building the APKs.
      deployQa:
        stages.commit.state !== 'success'
          ? { enabled: false, reason: "L'étape de commit n'a pas réussi pour cette version." }
          : busy(stages.qa.state) || busy(stages.androidQa.state)
            ? { enabled: false, reason: 'Un déploiement en qa est en cours.' }
            : inQa
              ? { enabled: false, reason: app.android ? 'Cette version est déjà en qa, web et Android.' : 'Cette version est déjà en qa.' }
              : { enabled: true },
      promote: !accepted
        ? { enabled: false, reason: "Cette version n'a pas passé les tests d'acceptation en qa." }
        : app.android && !tested
          ? { enabled: false, reason: "L'APK qa de cette version n'a jamais été envoyé aux testeurs : déployez-la d'abord en qa." }
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

/**
 * For the overview: the version each environment runs, and how far behind main it is.
 * data.recent: how many of data.commits are the newest commits of main, in order (the others are
 * older versions in place, fetched one by one).
 * → { head: { sha, short }, envs: { qa, androidQa, prod, androidProd }, busy }
 *   each env: null (nothing there) or { sha, short, behind } where behind is the number of commits
 *   of main since that version (0: up to date), or null when older than the commits read.
 */
export function summary(app, data, result = pipeline(app, data)) {
  const recent = data.commits.slice(0, data.recent ?? data.commits.length);
  const head = recent[0] ? { sha: recent[0].sha, short: recent[0].sha.slice(0, 7) } : null;
  const env = (sha) => {
    if (!sha) return null;
    const i = recent.findIndex((c) => c.sha === sha);
    return { sha, short: sha.slice(0, 7), behind: i >= 0 ? i : null };
  };
  const envs = {
    qa: env(result.where.qa),
    androidQa: app.android ? env(result.where.androidQa) : null,
    prod: env(result.where.prod),
    androidProd: app.android ? env(result.where.androidProd) : null,
  };
  return { head, envs, read: recent.length, busy: result.busy };
}
