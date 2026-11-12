// Fetches what pipeline() needs for one application. What can no longer change (the jobs of a
// finished run, the statuses of a finished deployment) is kept in `cache` between refreshes.

import { ENVIRONMENTS, COMMITS } from './config.js';
import { isFinal, positions, shownCommits } from './model.js';

// Deployments per environment whose statuses are read: the newest ones are enough to place the
// versions shown.
const DEPLOYMENTS = 15;

export function newCache() {
  return { jobs: new Map(), statuses: new Map(), commits: new Map(), live: new Map() };
}

async function statusesOf(gh, repo, deployment, cache) {
  const kept = cache.statuses.get(deployment.id);
  if (kept) return kept;
  const statuses = await gh.get(`/repos/${repo}/deployments/${deployment.id}/statuses?per_page=10`);
  if (isFinal(statuses)) cache.statuses.set(deployment.id, statuses);
  return statuses;
}

async function jobsOf(gh, repo, run, cache) {
  const key = `${run.id}/${run.run_attempt}`;
  const kept = cache.jobs.get(key);
  if (kept) return kept;
  const { jobs } = await gh.get(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=50`);
  if (run.status === 'completed') cache.jobs.set(key, jobs);
  return jobs;
}

// The commit an environment's server says it runs (GET /api/auth/status, field revision).
// Asked again only when that environment's newest deployment changes, so this page does not keep
// the Fly machines awake.
async function liveRevision(url, newest, cache, force) {
  const key = `${url}|${newest?.id}|${newest?.state}`;
  if (!force && cache.live.has(key)) return cache.live.get(key);
  let revision = null;
  try {
    const res = await fetch(`${url}/api/auth/status`, { cache: 'no-store' });
    if (res.ok) revision = (await res.json()).revision ?? null;
  } catch {
    // unreachable: fall back on the deployments
  }
  cache.live.set(key, revision);
  return revision;
}

export async function loadApp(gh, app, cache, { force = false } = {}) {
  const r = app.repo;
  const [commits, deliver, dispatch, ...lists] = await Promise.all([
    gh.get(`/repos/${r}/commits?sha=main&per_page=${COMMITS}`),
    gh.get(`/repos/${r}/actions/workflows/deliver.yml/runs?branch=main&event=push&per_page=${COMMITS * 2}`),
    gh.get(`/repos/${r}/actions/runs?event=workflow_dispatch&per_page=30`),
    ...ENVIRONMENTS.map((env) => gh.get(`/repos/${r}/deployments?environment=${env}&per_page=${DEPLOYMENTS}`)),
  ]);

  const deployments = {};
  await Promise.all(
    ENVIRONMENTS.map(async (env, i) => {
      deployments[env] = await Promise.all(lists[i].map(async (d) => ({ ...d, statuses: await statusesOf(gh, r, d, cache) })));
    }),
  );

  const newest = (env) => {
    const d = deployments[env][0];
    return d ? { id: d.id, state: d.statuses[0]?.state } : null;
  };
  const [qa, prod] = await Promise.all([liveRevision(app.qa, newest('qa'), cache, force), liveRevision(app.prod, newest('prod'), cache, force)]);
  const live = { qa, prod };

  // The versions in place, even when older than the commits read.
  const read = new Set(commits.map((c) => c.sha));
  const where = positions({ deployments, live });
  for (const sha of new Set(Object.values(where))) {
    if (!sha || !/^[0-9a-f]{40}$/.test(sha) || read.has(sha)) continue;
    if (!cache.commits.has(sha)) cache.commits.set(sha, await gh.get(`/repos/${r}/commits/${sha}`));
    commits.push(cache.commits.get(sha));
    read.add(sha);
  }

  // Jobs of Deliver, only for the versions shown.
  const shown = new Set(shownCommits(commits, where).map((c) => c.sha));
  const runs = deliver.workflow_runs;
  const firstRun = new Map();
  for (const run of runs) if (shown.has(run.head_sha) && !firstRun.has(run.head_sha)) firstRun.set(run.head_sha, run);
  const jobs = {};
  await Promise.all([...firstRun.values()].map(async (run) => (jobs[run.id] = await jobsOf(gh, r, run, cache))));

  // Jobs of the runs started by hand that are still going: which stage they are at.
  const dispatchJobs = {};
  await Promise.all(
    dispatch.workflow_runs
      .filter((run) => run.status !== 'completed')
      .map(async (run) => (dispatchJobs[run.id] = await jobsOf(gh, r, run, cache))),
  );

  return { commits, deliverRuns: runs, jobs, deployments, dispatchRuns: dispatch.workflow_runs, dispatchJobs, live };
}
