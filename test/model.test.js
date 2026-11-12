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
    assert.equal(a.actions.deployQa.enabled, false, 'already in qa');
    assert.equal(a.actions.testAndroid.enabled, true);
    assert.equal(a.actions.promote.enabled, false);
    assert.match(a.actions.promote.reason, /pas été testée sur Android/);
    const b = rowOf(p, B);
    assert.equal(b.actions.deployQa.enabled, true, 'back to an earlier version in qa');
    assert.equal(b.actions.testAndroid.enabled, false, 'testers already have it');
    assert.equal(b.actions.promote.enabled, true);
    const c = rowOf(p, C);
    assert.equal(c.actions.promote.enabled, false);
    assert.match(c.actions.promote.reason, /déjà en prod/);
  });

  test('without Android, prod only needs the acceptance stage', () => {
    const p = pipeline({ android: false }, data());
    assert.equal(rowOf(p, A).actions.promote.enabled, true);
    assert.equal(rowOf(p, A).actions.testAndroid.enabled, false);
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
    assert.equal(a.actions.testAndroid.enabled, false);
  });

  test('a version refused by its acceptance tests runs in qa but goes no further', () => {
    const d = data();
    d.deployments.qa[0] = deployment(13, A, 32, ['failure', 'in_progress']);
    d.jobs[3][2] = job('deploy-qa / deploy', 'failure');
    const p = pipeline(APP, d);
    const a = rowOf(p, A);
    assert.equal(a.stages.qa.state, 'failure');
    assert.deepEqual(a.here, ['qa'], 'the app says it runs A');
    assert.equal(a.actions.testAndroid.enabled, false);
  });

  test('without the app answering, qa is the newest deployment that succeeded', () => {
    const d = data({ live: { qa: null, prod: null } });
    d.deployments.qa[0] = deployment(13, A, 32, ['failure']);
    const p = pipeline(APP, d);
    assert.equal(p.where.qa, B);
    assert.equal(p.where.prod, C);
  });

  test('a run started by hand shows until its deployment exists, then a refusal shows', () => {
    const running = pipeline(APP, data({ dispatchRuns: [dispatch('Test on Android', A, 40, 'in_progress', null)] }));
    assert.equal(rowOf(running, A).stages.androidQa.state, 'running');
    assert.equal(rowOf(running, A).actions.testAndroid.enabled, false);
    assert.equal(running.busy, true);

    const refused = pipeline(APP, data({ dispatchRuns: [dispatch('Promote to prod', A, 40, 'completed', 'failure')] }));
    assert.equal(rowOf(refused, A).stages.prod.state, 'failure');
    assert.equal(rowOf(refused, A).stages.prod.link, 'dispatch/Promote to prod/40');
    assert.equal(rowOf(refused, B).stages.prod.state, 'none', 'another version is not concerned');
  });

  test('the newest event wins: a redeploy to qa after an older success', () => {
    const d = data({ dispatchRuns: [dispatch('Deploy to qa', B, 50, 'in_progress', null)] });
    const b = rowOf(pipeline(APP, d), B);
    assert.equal(b.stages.qa.state, 'running');
    assert.equal(b.actions.deployQa.enabled, false);
    d.deployments.qa.unshift(deployment(14, B, 51, ['in_progress']));
    d.dispatchRuns[0] = dispatch('Deploy to qa', B, 50, 'completed', 'success');
    assert.equal(rowOf(pipeline(APP, d), B).stages.qa.state, 'running', 'the deployment is newer than its run');
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
    assert.equal(a.actions.testAndroid.enabled, true);
  });
});
