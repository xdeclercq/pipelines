import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pipeline, deploymentState, runState } from '../src/model.js';

const A = 'a'.repeat(40); // newest commit
const B = 'b'.repeat(40);
const C = 'c'.repeat(40); // oldest
const APP = { android: true };

const at = (minutes) => new Date(Date.UTC(2026, 10, 12, 10, minutes)).toISOString();
const commit = (sha, minutes) => ({ sha, html_url: `https://github.com/x/y/commit/${sha}`, commit: { message: `Change ${sha[0]}\n\nBody`, author: { date: at(minutes) } } });
const run = (id, sha, status = 'completed', conclusion = 'success') => ({ id, head_sha: sha, status, conclusion, html_url: `run/${id}`, run_attempt: 1 });
const job = (name, conclusion = 'success', status = 'completed') => ({ name, status, conclusion, html_url: `job/${name}`, created_at: at(1) });
const deployment = (id, sha, minutes, states, payload = {}) => ({
  id,
  sha,
  created_at: at(minutes),
  payload,
  statuses: states.map((state) => ({ state, log_url: `log/${id}` })),
});
const dispatch = (name, sha, minutes, status = 'completed', conclusion = 'success') => ({
  name,
  display_title: `${name} ${sha}`,
  status,
  conclusion,
  html_url: `dispatch/${name}/${minutes}`,
  created_at: at(minutes),
});

// Three commits that passed the commit stage; C in prod, B tested on Android, A just deployed to qa.
function data(overrides = {}) {
  return {
    commits: [commit(A, 30), commit(B, 20), commit(C, 10)],
    deliverRuns: [run(3, A), run(2, B), run(1, C)],
    jobs: {
      3: [job('test'), job('build'), job('deploy-qa / deploy')],
      2: [job('test'), job('build'), job('deploy-qa / deploy')],
      1: [job('test'), job('build'), job('deploy-qa / deploy')],
    },
    deployments: {
      qa: [deployment(13, A, 32, ['success']), deployment(12, B, 22, ['inactive', 'success']), deployment(11, C, 12, ['inactive', 'success'])],
      'android-qa': [deployment(22, B, 25, ['success'], { version_code: 459000 }), deployment(21, C, 15, ['inactive', 'success'], { version_code: 458000 })],
      prod: [deployment(31, C, 16, ['success'])],
      'android-prod': [deployment(41, C, 17, ['success'], { version_code: 458000 })],
    },
    dispatchRuns: [],
    live: { qa: A, prod: C },
    ...overrides,
  };
}
const rowOf = (p, sha) => p.rows.find((r) => r.sha === sha);

describe('states', () => {
  test('of a deployment: the newest status that is not "inactive"', () => {
    assert.equal(deploymentState([{ state: 'inactive' }, { state: 'success' }]), 'success');
    assert.equal(deploymentState([{ state: 'inactive' }]), 'success');
    assert.equal(deploymentState([{ state: 'failure' }, { state: 'in_progress' }]), 'failure');
    assert.equal(deploymentState([{ state: 'in_progress' }]), 'running');
    assert.equal(deploymentState([{ state: 'error' }]), 'cancelled');
    assert.equal(deploymentState([]), 'waiting');
  });

  test('of a run or job', () => {
    assert.equal(runState(run(1, A, 'in_progress', null)), 'running');
    assert.equal(runState(run(1, A, 'queued', null)), 'waiting');
    assert.equal(runState(run(1, A, 'completed', 'timed_out')), 'failure');
    assert.equal(runState(run(1, A, 'completed', 'skipped')), 'none');
    assert.equal(runState(undefined), 'none');
  });
});

describe('the pipeline of a version', () => {
  test('shows each stage and where each environment is', () => {
    const p = pipeline(APP, data());
    assert.deepEqual(p.where, { qa: A, prod: C, androidQa: B, androidProd: C });
    const b = rowOf(p, B);
    assert.deepEqual(
      Object.fromEntries(Object.entries(b.stages).map(([k, v]) => [k, v.state])),
      { commit: 'success', qa: 'success', androidQa: 'success', prod: 'none', androidProd: 'none' },
    );
    assert.equal(b.stages.androidQa.versionCode, 459000);
    assert.equal(b.stages.androidQa.link, 'log/22');
    assert.deepEqual(rowOf(p, A).here, ['qa']);
    assert.deepEqual(rowOf(p, C).here, ['prod', 'androidProd']);
    assert.equal(b.short, 'bbbbbbb');
    assert.equal(b.title, 'Change b');
    assert.equal(p.busy, false);
  });

  test('opens a stage only to the versions that passed the previous ones', () => {
    const p = pipeline(APP, data());
    const a = rowOf(p, A);
    assert.equal(a.actions.deployQa.enabled, true, 'web in qa, but not yet on Android');
    assert.equal(a.actions.promote.enabled, false);
    assert.match(a.actions.promote.reason, /jamais été envoyé aux testeurs/);
    const b = rowOf(p, B);
    assert.equal(b.actions.deployQa.enabled, true, 'back to an earlier version in qa');
    assert.equal(b.actions.promote.enabled, true);
    const c = rowOf(p, C);
    assert.equal(c.actions.promote.enabled, false);
    assert.match(c.actions.promote.reason, /déjà en prod/);
  });

  test('a version in qa, web and Android, cannot be deployed there again', () => {
    const d = data();
    d.deployments['android-qa'].unshift(deployment(23, A, 45, ['success'], { version_code: 460000 }));
    const a = rowOf(pipeline(APP, d), A);
    assert.equal(a.actions.deployQa.enabled, false);
    assert.match(a.actions.deployQa.reason, /web et Android/);
  });

  test('without Android, qa and prod are the web alone', () => {
    const p = pipeline({ android: false }, data());
    assert.equal(rowOf(p, A).actions.promote.enabled, true);
    assert.equal(rowOf(p, A).actions.deployQa.enabled, false, 'already in qa');
  });

  test('failed tests stop the line', () => {
    const d = data();
    d.jobs[3] = [job('test', 'failure'), job('build'), job('deploy-qa / deploy', 'skipped')];
    d.deployments.qa = d.deployments.qa.filter((x) => x.sha !== A);
    d.live.qa = B;
    const a = rowOf(pipeline(APP, d), A);
    assert.equal(a.stages.commit.state, 'failure');
    assert.equal(a.stages.commit.link, 'job/test');
    assert.equal(a.stages.qa.state, 'none');
    assert.equal(a.actions.deployQa.enabled, false);
    assert.equal(a.actions.promote.enabled, false);
  });

  test('a version refused by its acceptance tests runs in qa but goes no further', () => {
    const d = data();
    d.deployments.qa[0] = deployment(13, A, 32, ['failure', 'in_progress']);
    d.jobs[3][2] = job('deploy-qa / deploy', 'failure');
    const p = pipeline(APP, d);
    const a = rowOf(p, A);
    assert.equal(a.stages.qa.state, 'failure');
    assert.deepEqual(a.here, ['qa'], 'the app says it runs A');
    assert.equal(a.actions.promote.enabled, false);
  });

  test('without the app answering, qa is the newest deployment that succeeded', () => {
    const d = data({ live: { qa: null, prod: null } });
    d.deployments.qa[0] = deployment(13, A, 32, ['failure']);
    const p = pipeline(APP, d);
    assert.equal(p.where.qa, B);
    assert.equal(p.where.prod, C);
  });

  test('a run started by hand shows while it runs, and its failure on its last stage', () => {
    const running = pipeline(APP, data({ dispatchRuns: [dispatch('Deploy to qa', A, 40, 'in_progress', null)] }));
    assert.equal(rowOf(running, A).stages.qa.state, 'running');
    assert.equal(rowOf(running, A).stages.androidQa.state, 'running');
    assert.equal(rowOf(running, A).actions.deployQa.enabled, false);
    assert.equal(running.busy, true);

    // The web was already in qa (skipped), the APK build failed: Android shows it, the web does not.
    const failed = pipeline(APP, data({ dispatchRuns: [dispatch('Deploy to qa', A, 40, 'completed', 'failure')] }));
    assert.equal(rowOf(failed, A).stages.qa.state, 'success');
    assert.equal(rowOf(failed, A).stages.androidQa.state, 'failure');
    assert.equal(rowOf(failed, A).stages.androidQa.link, 'dispatch/Deploy to qa/40');

    const refused = pipeline(APP, data({ dispatchRuns: [dispatch('Promote to prod', A, 40, 'completed', 'failure')] }));
    assert.equal(rowOf(refused, A).stages.androidProd.state, 'failure');
    assert.equal(rowOf(refused, A).stages.androidProd.link, 'dispatch/Promote to prod/40');
    assert.equal(rowOf(refused, A).stages.prod.state, 'none');
    assert.equal(rowOf(refused, B).stages.prod.state, 'none', 'another version is not concerned');
  });

  test('the newest event wins: a redeploy to qa after an older success', () => {
    const d = data({ dispatchRuns: [dispatch('Deploy to qa', B, 50, 'in_progress', null)] });
    const b = rowOf(pipeline(APP, d), B);
    assert.equal(b.stages.qa.state, 'running');
    assert.equal(b.actions.deployQa.enabled, false);
    d.deployments.qa.unshift(deployment(14, B, 51, ['failure']));
    d.dispatchRuns[0] = dispatch('Deploy to qa', B, 50, 'completed', 'failure');
    const b2 = rowOf(pipeline(APP, d), B);
    assert.equal(b2.stages.qa.state, 'failure', 'its deployment says the web failed');
    assert.equal(b2.stages.qa.link, 'log/14');
  });

  test('Deliver deploying to qa shows before its deployment is recorded', () => {
    const d = data();
    d.deliverRuns[0] = run(3, A, 'in_progress', null);
    d.jobs[3] = [job('test'), job('build'), job('deploy-qa / deploy', null, 'queued')];
    d.deployments.qa.shift();
    d.live.qa = B;
    const a = rowOf(pipeline(APP, d), A);
    assert.equal(a.stages.commit.state, 'success');
    assert.equal(a.stages.qa.state, 'waiting');
  });

  test('each stage has its start and end, no end while it runs', () => {
    const d = data();
    d.jobs[3] = [
      { ...job('test'), started_at: at(31), completed_at: at(34) },
      { ...job('build'), started_at: at(31), completed_at: at(33) },
      { ...job('deploy-qa / deploy'), started_at: at(34), completed_at: at(36) },
    ];
    d.deployments.qa[0] = deployment(13, A, 34, []);
    d.deployments.qa[0].statuses = [{ state: 'success', log_url: 'log/13', created_at: at(36) }, { state: 'in_progress', created_at: at(34) }];
    d.dispatchRuns = [{ ...dispatch('Deploy to qa', A, 40, 'in_progress', null), run_started_at: at(41) }];
    const a = rowOf(pipeline(APP, d), A);
    assert.deepEqual([a.stages.commit.start, a.stages.commit.end], [at(31), at(34)]);
    assert.deepEqual([a.stages.androidQa.state, a.stages.androidQa.start, a.stages.androidQa.end], ['running', at(41), null]);
    d.dispatchRuns = [];
    const done = rowOf(pipeline(APP, d), A);
    assert.deepEqual([done.stages.qa.start, done.stages.qa.end], [at(34), at(36)]);
  });

  test('shows the 3 newest versions, and those in qa and prod however old', () => {
    const D = 'd'.repeat(40);
    const E = 'e'.repeat(40);
    const F = 'f'.repeat(40);
    const d = data();
    d.commits = [commit(F, 60), commit(E, 50), commit(D, 40), ...d.commits];
    const p = pipeline(APP, d);
    assert.deepEqual(p.rows.map((r) => r.short[0]), ['f', 'e', 'd', 'a', 'b', 'c'], 'A in qa, B android qa, C prod');
    d.deployments['android-qa'].unshift(deployment(23, A, 45, ['success']));
    assert.deepEqual(pipeline(APP, d).rows.map((r) => r.short[0]), ['f', 'e', 'd', 'a', 'c']);
    d.live = { qa: E, prod: E };
    d.deployments['android-qa'][0] = deployment(23, E, 55, ['success']);
    d.deployments['android-prod'].unshift(deployment(42, E, 56, ['success']));
    assert.deepEqual(pipeline(APP, d).rows.map((r) => r.short[0]), ['f', 'e', 'd']);
  });

  test('a version tested on Android stays promotable after a newer one is tested', () => {
    const d = data();
    d.deployments['android-qa'].unshift(deployment(23, A, 45, ['success'], { version_code: 460000 }));
    d.deployments['android-qa'][1].statuses.unshift({ state: 'inactive' });
    assert.equal(rowOf(pipeline(APP, d), B).actions.promote.enabled, true);
  });

  test('a version deployed to qa by Deliver before deployments were recorded passed acceptance', () => {
    const d = data();
    d.deployments.qa = d.deployments.qa.filter((x) => x.sha !== A);
    const a = rowOf(pipeline(APP, d), A);
    assert.equal(a.stages.qa.state, 'success');
    d.deployments['android-qa'].unshift(deployment(23, A, 45, ['success']));
    assert.equal(rowOf(pipeline(APP, d), A).actions.promote.enabled, true);
  });
});
