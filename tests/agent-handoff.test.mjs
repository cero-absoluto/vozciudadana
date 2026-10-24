import { requestReview } from '../automation/coordination/request-review.mjs';
// #37 — Pruebas OFFLINE del relevo Claude ⇄ Codex. Sin red, sin modelos, sin secretos, sin Railway, sin SMS.
// Un GitHub falso en memoria + repositorios git temporales. No demuestra integración real (ver README: Límites).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkPaths, decide, decideAfterClaude, mayPublish, ownerStopped, pickState, validatePatch, encodeState, decodeState, precheck, STATUS } from '../automation/coordination/controller.mjs';
import { collectFacts, main as gatherMain, loadPolicy } from '../automation/coordination/gather.mjs';
import crypto from 'node:crypto';
import { makeApi } from '../automation/coordination/github.mjs';
import { publishRound as realPublishRound, applyPatchAndPush, buildPatchFromTree, sha256 } from '../automation/coordination/publish.mjs';
// Por defecto las pruebas simulan un job `patch` y un job `verify` correctos sobre ESE parche; cada prueba puede sobrescribirlo.
const publishRound = (o) => realPublishRound({ patchStatus: { ok: true }, verifyResult: 'success', expectedPatchSha256: sha256(o.patch), ...o });

const policy = loadPolicy();
const REPO = policy.repository;
const OWNER = { login: 'cero-absoluto', id: 280877387, type: 'User' };
const CODEX = { login: policy.auditor.login, id: policy.auditor.id, type: 'Bot' };
const WRITER = { login: policy.stateWriter.login, id: policy.stateWriter.id, type: 'Bot' };
const H = (c) => c.repeat(40);
const [H0, H1, H2] = [H('a'), H('b'), H('c')];

// ── GitHub falso ────────────────────────────────────────────────────────────────────────────────────────
function fakeGithub({ head = H0, headRef = 'feature/x', merged = false, state = 'open', fork = false, baseRef = 'main', permissions = { 'cero-absoluto': 'admin' } } = {}) {
  const g = { calls: [], comments: [], reviews: [], nextId: 1000,
    pr: { number: 7, state, merged, draft: true, head: { sha: head, ref: headRef, repo: { full_name: fork ? 'evil/vozciudadana' : REPO, fork } }, base: { ref: baseRef, repo: { full_name: REPO } } } };
  const mk = (user, body, extra = {}) => { const c = { id: g.nextId++, user, body, ...extra }; g.comments.push(c); return c; };
  g.addComment = mk;
  g.addReview = (user, commitId, inline = []) => { const r = { id: g.nextId++, user, commit_id: commitId, state: 'COMMENTED', comments: inline }; g.reviews.push(r); return r; };
  const finding = (p, line, text) => ({ user: CODEX, path: p, line, body: `**P1** ${text}\n<!-- codex-code-review-finding:v1 -->` });
  g.finding = finding;
  g.receiptClean = (sha) => mk(CODEX, `<!-- codex-review-receipt:v1 -->\n\nCodex Review: Didn't find any major issues. Swish!\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\``, { performed_via_github_app: { id: policy.auditor.appId } });
  const api = {
    request: async (method, p, body) => {
      g.calls.push(`${method} ${p}`);
      let m;
      if (method === 'GET' && p === `/repos/${REPO}/pulls/7`) return g.pr;
      if (method === 'GET' && (m = /collaborators\/([^/]+)\/permission$/.exec(p))) return { permission: permissions[decodeURIComponent(m[1])] ?? 'read' };
      if (method === 'POST' && p === `/repos/${REPO}/issues/7/comments`) return mk(WRITER, body.body);
      if (method === 'PATCH' && (m = /issues\/comments\/(\d+)$/.exec(p))) { g.comments.find((c) => c.id === Number(m[1])).body = body.body; return {}; }
      throw new Error(`unexpected ${method} ${p}`);
    },
    paginate: async (p) => {
      g.calls.push(`GET ${p}`);
      let m;
      if (p === `/repos/${REPO}/issues/7/comments`) return g.comments;
      if (p === `/repos/${REPO}/pulls/7/reviews`) return g.reviews;
      if ((m = /reviews\/(\d+)\/comments$/.exec(p))) return g.reviews.find((r) => r.id === Number(m[1])).comments;
      throw new Error(`unexpected GET ${p}`);
    },
  };
  g.api = api;
  return g;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
async function step(g, event, { enabled = 'true' } = {}) {
  const d = tmp(); const ev = path.join(d, 'event.json'); const out = path.join(d, 'out');
  fs.writeFileSync(ev, JSON.stringify({ action: 'created', issue: { number: 7, pull_request: {} }, ...event })); fs.writeFileSync(out, '');
  const r = await gatherMain({ GITHUB_EVENT_PATH: ev, GITHUB_OUTPUT: out, GITHUB_REPOSITORY: REPO, AGENT_HANDOFF_ENABLED: enabled, FINDINGS_PATH: path.join(d, 'findings.json') }, { api: g.api, policy });
  return { ...r, outputs: Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2))), findingsPath: path.join(d, 'findings.json') };
}
const cmdEvent = (user, body = '/handoff enable') => ({ comment: { user, body } });
const codexEvent = (action = 'edited') => ({ action, comment: { user: CODEX, body: '<!-- codex-pull-request-review-summary -->' } });
const stateOf = (g) => pickState(g.comments.map((c) => ({ id: c.id, authorId: c.user.id, authorType: c.user.type, authorLogin: c.user.login, body: c.body })), policy).state;

const startImplementation = (g, task = 'Implementa el criterio acordado y añade pruebas.') =>
  step(g, { comment: g.addComment(OWNER, `/handoff implement\n\n${task}`) });

test('C1 Owner task → Claude implementation → verified push → current Codex clean → OWNER_REVIEW, zero corrections', async () => {
  const local = gitRepo(), g = fakeGithub({ head: local.head });
  const started = await startImplementation(g);
  assert.equal(started.outputs.action, 'run_claude');
  assert.equal(started.outputs.round, '0');
  assert.equal(stateOf(g).status, STATUS.IMPLEMENTING);
  const payload = JSON.parse(fs.readFileSync(started.findingsPath));
  assert.equal(payload.mode, 'implementation');
  assert.match(payload.task, /criterio acordado/);
  assert.deepEqual(payload.findings, []);
  g.receiptClean(local.head);
  assert.equal((await step(g, codexEvent())).outputs.reason, 'implementation_in_progress');
  const patch = 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;\n';
  const published = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 0,
    claudeResult: 'success', patch, repoDir: `${local.dir}/work`, switchEnabled: 'true', requestReview: false });
  assert.equal(published.outcome, 'pushed');
  assert.equal(published.next.action.type, 'request_review');
  const head = published.next.state.head;
  assert.notEqual(head, local.head);
  assert.equal(stateOf(g).implementationHead, head);
  assert.equal(stateOf(g).rounds, 0);
  assert.match(local.sh(`${local.dir}/work`, 'log', '-1', '--format=%s'), /initial Claude implementation/);
  g.pr.head.sha = head;
  assert.notEqual((await step(g, codexEvent())).result.state.status, STATUS.OWNER_REVIEW, 'old review cannot approve implementation');
  g.receiptClean(head);
  await step(g, codexEvent());
  assert.equal(stateOf(g).status, STATUS.OWNER_REVIEW);
  assert.equal(stateOf(g).rounds, 0);
});

test('C2 initial implementation preserves both correction rounds and missing verdict never approves', async () => {
  const g = fakeGithub(); await startImplementation(g);
  const next = decideAfterClaude(stateOf(g), { round: 0, outcome: 'pushed', newHead: H1 }, policy);
  g.comments.find(c => c.body.includes('agent-handoff-state:v1')).body = encodeState(next.state);
  g.pr.head.sha = H1;
  for (let i = 0; i < 3; i++) assert.equal((await step(g, codexEvent())).result.state.status, STATUS.AWAITING_REVIEW);
  for (const [head, newHead, round] of [[H1, H2, 1], [H2, H0, 2]]) {
    g.addReview(CODEX, head, [g.finding('apps/web/src/a.js', 1, 'Fix the current issue')]);
    const result = await step(g, codexEvent());
    assert.equal(result.outputs.round, String(round));
    assert.equal(JSON.parse(fs.readFileSync(result.findingsPath)).mode, 'correction');
    const after = decideAfterClaude(stateOf(g), { round, outcome: 'pushed', newHead }, policy);
    g.comments.find(c => c.body.includes('agent-handoff-state:v1')).body = encodeState(after.state);
    g.pr.head.sha = newHead;
  }
  g.addReview(CODEX, H0, [g.finding('apps/web/src/a.js', 1, 'Still broken')]);
  await step(g, codexEvent());
  assert.equal(stateOf(g).status, STATUS.BLOCKED);
  assert.equal(stateOf(g).rounds, 2);
});

test('C3 initial task requires exact Owner command, created comment, payload and unused PR', async () => {
  for (const mode of ['impostor', 'edited', 'empty', 'large', 'switch', 'no-id', 'fork', 'closed']) {
    const g = fakeGithub({ fork: mode === 'fork', state: mode === 'closed' ? 'closed' : 'open' });
    const comment = g.addComment(mode === 'impostor' ? { ...OWNER, id: 9 } : OWNER,
      `/handoff implement\n${mode === 'empty' ? '' : mode === 'large' ? 'x'.repeat(8001) : 'Small task'}`);
    if (mode === 'no-id') delete comment.id;
    const result = await step(g, { action: mode === 'edited' ? 'edited' : 'created', comment }, { enabled: mode === 'switch' ? 'false' : 'true' });
    assert.equal(result.outputs.action, 'none', mode);
    assert.equal(stateOf(g), null, mode);
  }
  const g = fakeGithub(); const first = await startImplementation(g);
  assert.equal((await step(g, { comment: g.comments[0] })).outputs.reason, 'implementation_requires_new_pr');
  assert.equal((await startImplementation(g, 'Another task')).outputs.action, 'none');
  assert.equal(stateOf(g).rounds, first.result.state.rounds);
});

test('C4 initial model/verification/empty patch errors block without approval or correction round consumption', async () => {
  for (const [claudeResult, verifyResult, patchStatus, expected] of [
    ['failure', 'success', { ok: true }, 'failure'],
    ['cancelled', 'success', { ok: true }, 'timeout'],
    ['success', 'failure', { ok: true }, 'verification_failed'],
    ['success', 'success', { ok: false, reason: 'empty_patch' }, 'no_changes'],
    ['success', 'success', { ok: false, reason: 'denied_path' }, 'rejected_patch'],
  ]) {
    const g = fakeGithub(); await startImplementation(g);
    const r = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 0,
      claudeResult, verifyResult, patchStatus, patch: '', repoDir: '/nonexistent', switchEnabled: 'true' });
    assert.equal(r.outcome, expected);
    assert.equal(stateOf(g).status, STATUS.BLOCKED);
    assert.equal(stateOf(g).rounds, 0);
    assert.equal((await step(g, cmdEvent(OWNER))).outputs.reason, 'implementation_not_published');
    assert.equal((await startImplementation(g)).outputs.action, 'none');
  }
});

test('C5 stop and global switch prevent publishing the initial implementation', async () => {
  for (const mode of ['stop', 'switch', 'queued-stop']) {
    const g = fakeGithub(); await startImplementation(g);
    if (mode === 'stop') await step(g, { comment: g.addComment(OWNER, '/handoff stop') });
    if (mode === 'queued-stop') g.addComment(OWNER, '/handoff stop');
    const result = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 0,
      claudeResult: 'success', patch: '', repoDir: '/nonexistent', switchEnabled: mode === 'switch' ? 'false' : 'true' });
    assert.notEqual(result.outcome, 'pushed');
    assert.equal(stateOf(g).status, STATUS.STOPPED);
    assert.equal((await step(g, cmdEvent(OWNER))).outputs.reason, 'implementation_not_published');
  }
});

test('C6 workflow routes structured tasks to Claude and requires build after tests in credential-free verify', () => {
  const workflow = fs.readFileSync('.github/workflows/agent-handoff.yml', 'utf8');
  assert.match(workflow, /Si mode es implementation/);
  assert.match(workflow, /Si mode es correction/);
  const verify = workflow.split('\n  verify:')[1].split('\n  publish:')[0];
  assert.ok(verify.indexOf('node --experimental-test-module-mocks --test') < verify.indexOf('npm run build --workspace=apps/web'));
  assert.doesNotMatch(verify, /secrets\./);
});

test('C7 rejected second implementation never clears an Owner stop queued behind the running workflow', async () => {
  const g = fakeGithub(); await startImplementation(g);
  g.addComment(OWNER, '/handoff stop'); // Not processed yet: publisher must read the queued stop.
  const second = g.addComment(OWNER, '/handoff implement\nAnother task');
  const rejected = await step(g, { comment: second });
  assert.equal(rejected.outputs.reason, 'implementation_requires_new_pr');
  assert.equal(stateOf(g).status, STATUS.IMPLEMENTING);
  assert.equal(ownerStopped(rejected.facts, policy), true);
  assert.equal(mayPublish(stateOf(g), rejected.facts, policy, 0), false);
  const result = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 0,
    claudeResult: 'success', patch: '', repoDir: '/nonexistent', switchEnabled: 'true' });
  assert.equal(result.outcome, 'stopped');
  assert.equal(stateOf(g).status, STATUS.STOPPED);
});

// ── Flujos completos con estado persistente ─────────────────────────────────────────────────────────────
test('F1 hallazgo actual → corrección (parche validado, push real a un remoto local) → nueva revisión limpia → OWNER_REVIEW', async () => {
  const dir = tmp();
  const sh = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  sh(dir, 'init', '-q', '--bare', 'origin.git');
  fs.mkdirSync(`${dir}/work`); sh(`${dir}/work`, 'init', '-q', '-b', 'feature/x');
  sh(`${dir}/work`, 'remote', 'add', 'origin', `${dir}/origin.git`);
  fs.mkdirSync(`${dir}/work/apps/web/src`, { recursive: true }); fs.writeFileSync(`${dir}/work/apps/web/src/a.js`, 'export const a = 1;\n');
  sh(`${dir}/work`, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'); sh(`${dir}/work`, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
  const head0 = sh(`${dir}/work`, 'rev-parse', 'HEAD'); sh(`${dir}/work`, 'push', '-q', 'origin', 'feature/x');

  const g = fakeGithub({ head: head0 });
  let r = await step(g, cmdEvent(OWNER));
  assert.equal(r.result.state.status, STATUS.AWAITING_REVIEW); assert.equal(stateOf(g).rounds, 0);
  g.addReview(CODEX, head0, [g.finding('apps/web/src/a.js', 1, 'a debe valer 2')]);
  r = await step(g, codexEvent());
  assert.equal(r.outputs.action, 'run_claude'); assert.equal(r.outputs.round, '1'); assert.equal(stateOf(g).status, STATUS.CORRECTING);
  const findings = JSON.parse(fs.readFileSync(r.findingsPath, 'utf8')); assert.equal(findings.findings[0].path, 'apps/web/src/a.js'); assert.ok(!/<!--/.test(findings.findings[0].text));
  assert.equal((await step(g, codexEvent())).outputs.action, 'none', 'evento duplicado mientras corrige: no lanza otra ejecución');
  assert.equal(stateOf(g).rounds, 1);

  const patch = 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;\n';
  const pub = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', patch, repoDir: `${dir}/work`, switchEnabled: 'true' });
  assert.equal(pub.outcome, 'pushed'); const head1 = sh(`${dir}/work`, 'rev-parse', 'HEAD');
  assert.equal(sh(dir, '--git-dir=origin.git', 'rev-parse', 'refs/heads/feature/x'), head1, 'push real a la rama del PR');
  assert.notEqual(head1, head0); assert.equal(stateOf(g).status, STATUS.AWAITING_REVIEW); assert.equal(stateOf(g).head, head1);
  assert.ok(g.comments.some((c) => c.body === '@codex review'));
  g.pr.head.sha = head1;

  assert.equal((await step(g, codexEvent())).outputs.action, 'none', 'sin señal nueva sobre el HEAD nuevo no pasa nada');
  g.receiptClean(head1);
  r = await step(g, { action: 'created', comment: { user: CODEX, body: 'x' } });
  assert.equal(stateOf(g).status, STATUS.OWNER_REVIEW); assert.equal(stateOf(g).rounds, 1);
  assert.ok(g.comments.some((c) => c.body.startsWith('OWNER_REVIEW')));
  const n = g.comments.length;
  assert.equal((await step(g, codexEvent())).outputs.action, 'none'); assert.equal(g.comments.length, n, 'terminal: sin ruido ni nuevas ejecuciones');
});

test('F2 sin hallazgos desde el principio → OWNER_REVIEW (no se inventa ningún defecto)', async () => {
  const g = fakeGithub();
  await step(g, cmdEvent(OWNER)); g.receiptClean(H0);
  const r = await step(g, codexEvent());
  assert.equal(stateOf(g).status, STATUS.OWNER_REVIEW); assert.equal(stateOf(g).rounds, 0); assert.equal(r.outputs.action, 'notify');
  assert.equal(g.comments.filter((c) => c.body === '@codex review').length, 0);
});

test('F3 dos rondas agotadas con hallazgos → BLOCKED, sin tercera ejecución', async () => {
  const g = fakeGithub();
  await step(g, cmdEvent(OWNER));
  for (const [round, head] of [[1, H0], [2, H1]]) {
    g.pr.head.sha = head; if (round === 2) { const s = stateOf(g); s.head = head; s.status = STATUS.AWAITING_REVIEW; fs.writeFileSync(path.join(tmp(), 'x'), ''); g.comments.find((c) => c.body.includes('agent-handoff-state')).body = encodeState(s); }
    g.addReview(CODEX, head, [g.finding('apps/web/src/a.js', 1, `fallo ${round}`)]);
    const r = await step(g, codexEvent()); assert.equal(r.outputs.action, 'run_claude'); assert.equal(r.outputs.round, String(round));
  }
  const s = stateOf(g); s.status = STATUS.AWAITING_REVIEW; s.head = H2; g.pr.head.sha = H2; g.comments.find((c) => c.body.includes('agent-handoff-state')).body = encodeState(s);
  g.addReview(CODEX, H2, [g.finding('apps/web/src/a.js', 1, 'sigue fallando')]);
  const r = await step(g, codexEvent());
  assert.equal(r.outputs.action, 'blocked'); assert.equal(stateOf(g).status, STATUS.BLOCKED); assert.equal(stateOf(g).rounds, 2);
  assert.ok(g.comments.some((c) => c.body.startsWith('BLOCKED: rounds_exhausted_with_findings')));
  assert.equal((await step(g, codexEvent())).outputs.action, 'none');
});

test('F4 errores del modelo / parche rechazado / push rechazado → BLOCKED con razón; resultado de ronda antigua se ignora', async () => {
  for (const [claudeResult, patch, reason] of [['failure', '', 'failure'], ['cancelled', '', 'timeout'], ['success', '', 'no_changes'],
    ['success', 'diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml\n--- a/.github/workflows/x.yml\n+++ b/.github/workflows/x.yml\n@@ -1 +1 @@\n-a\n+b\n', 'rejected_patch']]) {
    const g = fakeGithub(); await step(g, cmdEvent(OWNER)); g.addReview(CODEX, H0, [g.finding('apps/web/src/a.js', 1, 'x')]); await step(g, codexEvent());
    const r = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult, patch, repoDir: '/nonexistent', switchEnabled: 'true' });
    assert.equal(r.outcome, reason); assert.equal(stateOf(g).status, STATUS.BLOCKED); assert.equal(stateOf(g).reason, reason);
  }
  const g = fakeGithub(); await step(g, cmdEvent(OWNER)); g.addReview(CODEX, H0, [g.finding('apps/web/src/a.js', 1, 'x')]); await step(g, codexEvent());
  const r = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 9, claudeResult: 'failure', patch: '', repoDir: '/nonexistent', switchEnabled: 'true' });
  assert.equal(r.outcome, 'stale'); assert.equal(stateOf(g).status, STATUS.CORRECTING, 'resultado de otra ronda no altera el estado');
});

test('F5 push rechazado (la rama avanzó) → BLOCKED; no se fuerza', () => {
  const dir = tmp(); const sh = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  sh(dir, 'init', '-q', '--bare', 'origin.git'); fs.mkdirSync(`${dir}/w`); sh(`${dir}/w`, 'init', '-q', '-b', 'f'); sh(`${dir}/w`, 'remote', 'add', 'origin', `${dir}/origin.git`);
  fs.mkdirSync(`${dir}/w/tests`); fs.writeFileSync(`${dir}/w/tests/a.js`, '1\n'); const c = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
  sh(`${dir}/w`, ...c, 'add', '.'); sh(`${dir}/w`, ...c, 'commit', '-q', '-m', 'b'); const head = sh(`${dir}/w`, 'rev-parse', 'HEAD'); sh(`${dir}/w`, 'push', '-q', 'origin', 'f');
  fs.writeFileSync(`${dir}/w/tests/b.js`, '2\n'); sh(`${dir}/w`, ...c, 'add', '.'); sh(`${dir}/w`, ...c, 'commit', '-q', '-m', 'other'); sh(`${dir}/w`, 'push', '-q', 'origin', 'f');
  const patch = 'diff --git a/tests/a.js b/tests/a.js\n--- a/tests/a.js\n+++ b/tests/a.js\n@@ -1 +1 @@\n-1\n+3\n';
  const r = applyPatchAndPush({ repoDir: `${dir}/w`, headSha: head, headRef: 'f', patch, round: 1, policy });
  assert.deepEqual([r.ok, r.reason], [false, 'push_rejected']);
});

// ── Parada ──────────────────────────────────────────────────────────────────────────────────────────────
test('S1 /handoff stop del Owner: ninguna ejecución nueva y el publicador ya no empuja aunque Claude haya corrido', async () => {
  const g = fakeGithub(); await step(g, cmdEvent(OWNER)); g.addReview(CODEX, H0, [g.finding('apps/web/src/a.js', 1, 'x')]);
  assert.equal((await step(g, codexEvent())).outputs.action, 'run_claude');
  await step(g, cmdEvent(OWNER, '/handoff stop'));
  assert.equal(stateOf(g).status, STATUS.STOPPED);
  const r = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', patch: 'diff --git a/tests/a.js b/tests/a.js\n--- a/tests/a.js\n+++ b/tests/a.js\n@@ -1 +1 @@\n-a\n+b\n', repoDir: '/nonexistent', switchEnabled: 'true' });
  assert.equal(r.outcome, 'stale'); assert.equal(stateOf(g).status, STATUS.STOPPED);
  g.addReview(CODEX, H0, [g.finding('apps/web/src/a.js', 2, 'otro')]);
  assert.equal((await step(g, codexEvent())).outputs.action, 'none');
});
test('S2 interruptor global (variable AGENT_HANDOFF_ENABLED≠true): nada, ni siquiera órdenes; el publicador tampoco', async () => {
  const g = fakeGithub(); const r = await step(g, cmdEvent(OWNER), { enabled: 'false' });
  assert.equal(r.outputs.action, 'none'); assert.equal(g.comments.length, 0);
  assert.equal(mayPublish({ status: STATUS.CORRECTING, rounds: 1, head: H0 }, { repository: REPO, switch: { enabled: false }, pr: { state: 'open', merged: false, baseRepo: REPO, headRepo: REPO, isFork: false, headSha: H0, headRef: 'f', baseRef: 'main' } }, policy, 1), false);
});

// ── Identidad, forks y referencias ──────────────────────────────────────────────────────────────────────
test('I1 habilitar: solo el Owner real (id, login, tipo y permiso); impostores y órdenes mal formadas se rechazan', async () => {
  const impostors = [
    [{ login: 'cero-absoluto', id: 1, type: 'User' }, 'admin'], [{ login: 'cero-absoIuto', id: 280877387, type: 'User' }, 'admin'],
    [{ login: 'cero-absoluto', id: 280877387, type: 'Bot' }, 'admin'], [OWNER, 'read'], [{ login: 'random', id: 5, type: 'User' }, 'write'],
  ];
  for (const [u, perm] of impostors) { const g = fakeGithub({ permissions: { [u.login]: perm } }); const r = await step(g, cmdEvent(u)); assert.equal(stateOf(g), null, JSON.stringify(u)); assert.equal(r.outputs.action, 'none'); }
  for (const body of ['hola\n/handoff enable', '/handoff enable now', '/handoff  enable', 'please /handoff enable']) { const g = fakeGithub(); await step(g, cmdEvent(OWNER, body)); assert.equal(stateOf(g), null, body); }
  const g = fakeGithub(); await step(g, cmdEvent(OWNER)); assert.equal(stateOf(g).status, STATUS.AWAITING_REVIEW);
});
test('I2 señales de impostor: login parecido, mismo login con otro id, id correcto con tipo User, recibo de otra app, comentario de usuario con el texto del recibo', async () => {
  const g = fakeGithub(); await step(g, cmdEvent(OWNER));
  const fakeUsers = [{ ...CODEX, id: 42 }, { ...CODEX, type: 'User' }, { ...CODEX, login: 'chatgpt-codex-connector-bot' }, OWNER, { login: 'x', id: 9, type: 'User' }];
  for (const u of fakeUsers) {
    g.addReview(u, H0, [g.finding('apps/web/src/a.js', 1, 'x')]);
    g.addComment(u, `<!-- codex-review-receipt:v1 -->\nCodex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${H0.slice(0, 10)}\``, { performed_via_github_app: { id: policy.auditor.appId } });
  }
  g.addComment(CODEX, `<!-- codex-review-receipt:v1 -->\nDidn't find any major issues.\n\n**Reviewed commit:** \`${H0.slice(0, 10)}\``, { performed_via_github_app: { id: 99 } });
  const r = await step(g, codexEvent());
  assert.equal(r.outputs.action, 'none'); assert.equal(stateOf(g).status, STATUS.AWAITING_REVIEW); assert.equal(stateOf(g).rounds, 0);
});
test('I3 estado falsificado: un comentario con el marcador de estado de otro autor se ignora; uno corrupto del escritor real bloquea', async () => {
  const g = fakeGithub(); g.addComment(OWNER, encodeState({ v: 1, pr: 7, status: STATUS.OWNER_REVIEW, head: H0, rounds: 0, maxRounds: 2, handled: [] }));
  g.addComment(CODEX, encodeState({ v: 1, pr: 7, status: STATUS.AWAITING_REVIEW, head: H0, rounds: 0, maxRounds: 2, handled: [] }));
  assert.equal(stateOf(g), null);
  const g2 = fakeGithub(); g2.addComment(WRITER, '<!-- agent-handoff-state:v1 {"v":1,"status":"NOPE"} -->'); g2.addReview(CODEX, H0, []); const r = await step(g2, cmdEvent(OWNER));
  assert.equal(r.outputs.action, 'blocked'); assert.equal(r.outputs.reason, 'state_comment_corrupt');
});
test('I4 forks, PR cerrada/fusionada, base distinta de la rama por defecto y referencias ambiguas → rechazadas, sin escribir nada', async () => {
  const cases = [[{ fork: true }, 'fork_or_foreign_head'], [{ state: 'closed' }, 'pr_not_open'], [{ merged: true, state: 'closed' }, 'pr_not_open'], [{ baseRef: 'release' }, 'base_is_not_default_branch'],
    [{ headRef: '--upload-pack=evil' }, 'ambiguous_head_ref'], [{ headRef: 'a..b' }, 'ambiguous_head_ref'], [{ headRef: 'x/' }, 'ambiguous_head_ref'], [{ headRef: 'refs/heads/x y' }, 'ambiguous_head_ref'], [{ head: 'abc123' }, 'ambiguous_head_sha'], [{ head: H0.toUpperCase() }, 'ambiguous_head_sha']];
  for (const [opts, reason] of cases) { const g = fakeGithub(opts); const r = await step(g, cmdEvent(OWNER)); assert.equal(r.outputs.reason, reason, JSON.stringify(opts)); assert.equal(g.comments.length, 0); }
  const wrongRepo = precheck({ repository: 'evil/vozciudadana', pr: { state: 'open' } }, policy); assert.equal(wrongRepo, 'wrong_repository');
});

// ── Obsolescencia, duplicados, otras señales ───────────────────────────────────────────────────────────
test('D1 reseña/recibo de un SHA antiguo, HEAD distinto del estado, emoji aislado y eventos irrelevantes: ignorados sin consumir rondas ni llamar a la API', async () => {
  const g = fakeGithub({ head: H1 }); await step(g, cmdEvent(OWNER)); // estado con head H1
  g.addReview(CODEX, H0, [g.finding('apps/web/src/a.js', 1, 'viejo')]); g.receiptClean(H0);
  let r = await step(g, codexEvent()); assert.equal(r.outputs.action, 'none'); assert.equal(stateOf(g).rounds, 0);
  g.pr.head.sha = H2; // alguien empujó fuera del controlador
  g.addReview(CODEX, H2, [g.finding('apps/web/src/a.js', 1, 'nuevo')]);
  r = await step(g, codexEvent()); assert.equal(r.outputs.reason, 'head_differs_from_controller_state'); assert.equal(stateOf(g).rounds, 0);
  const before = g.calls.length;
  r = await step(g, { action: 'created', comment: { user: { login: 'random', id: 3, type: 'User' }, body: '👍' } });
  assert.equal(r.outputs.action, 'none'); assert.equal(g.calls.length, before, 'comentario irrelevante: cero llamadas a la API');
  r = await step(g, { action: 'created', issue: { number: 7 }, comment: { user: CODEX, body: 'x' } }); // no es un PR
  assert.equal(r.outputs.action, 'none'); assert.equal(g.calls.length, before);
  r = await step(g, cmdEvent(OWNER)); assert.equal(r.outputs.action, 'notify', 're-habilitar con HEAD distinto lo reajusta (rebaselined), no reinicia rondas'); assert.equal(stateOf(g).head, H2); assert.equal(stateOf(g).rounds, 0);
});
test('D2 idempotencia: aplicar de nuevo la misma decisión sobre el estado resultante no repite acciones ni consume rondas', async () => {
  const g = fakeGithub(); await step(g, cmdEvent(OWNER)); g.addReview(CODEX, H0, [g.finding('apps/web/src/a.js', 1, 'x')]);
  const facts1 = await collectFacts({ api: g.api, policy, repository: REPO, event: { issue: { number: 7, pull_request: {} }, comment: { user: CODEX, body: '' } }, switchEnabled: 'true' });
  const d1 = decide(facts1, policy); assert.equal(d1.action.type, 'run_claude');
  for (let i = 0; i < 3; i++) { await step(g, codexEvent()); }
  assert.equal(stateOf(g).rounds, 1); assert.equal(stateOf(g).status, STATUS.CORRECTING);
  // tras la ronda y nuevo HEAD, la misma reseña vieja (otro SHA) no cuenta
  const s = stateOf(g); const after = decideAfterClaude(s, { round: 1, outcome: 'pushed', newHead: H1 }, policy);
  assert.equal(after.action.type, 'request_review'); assert.equal(decideAfterClaude(after.state, { round: 1, outcome: 'pushed', newHead: H2 }, policy).action.reason, 'stale_result');
});
test('D3 el hallazgo y el recibo limpio del mismo HEAD: gana el hallazgo; recibo sin veredicto conocido no aprueba', async () => {
  const g = fakeGithub(); await step(g, cmdEvent(OWNER)); g.addReview(CODEX, H0, [g.finding('apps/web/src/a.js', 1, 'x')]); g.receiptClean(H0);
  assert.equal((await step(g, codexEvent())).outputs.action, 'run_claude');
  const g2 = fakeGithub(); await step(g2, cmdEvent(OWNER));
  g2.addComment(CODEX, `<!-- codex-review-receipt:v1 -->\nTexto desconocido\n\n**Reviewed commit:** \`${H0.slice(0, 10)}\``, { performed_via_github_app: { id: policy.auditor.appId } });
  const r = await step(g2, codexEvent()); assert.equal(r.outputs.action, 'none'); assert.equal(stateOf(g2).status, STATUS.AWAITING_REVIEW);
});

// ── Validación del parche del modelo ───────────────────────────────────────────────────────────────────
const mkPatch = (p, extra = '') => `diff --git a/${p} b/${p}\n${extra}--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-a\n+b\n`;
test('P1 parche: dentro de la lista permitida pasa; fuera, denegado, traversal, binario, symlink, ejecutable, renombrado, vacío o enorme → rechazo', () => {
  assert.equal(validatePatch(mkPatch('apps/web/src/lib/x.js'), policy).ok, true);
  assert.equal(validatePatch(mkPatch('tests/x.test.mjs'), policy).ok, true);
  const bad = [mkPatch('.github/workflows/deploy.yml'), mkPatch('automation/coordination/policy.json'), mkPatch('apps/api/src/server.js'), mkPatch('supabase/x.sql'), mkPatch('package.json'), mkPatch('apps/web/package.json'),
    mkPatch('README.md'), mkPatch('apps/web/src/../../.github/x'), mkPatch('/etc/passwd'), mkPatch('apps/web/src/x.js', 'new file mode 120000\n'), mkPatch('apps/web/src/x.js', 'new file mode 100755\n'),
    'diff --git a/apps/web/src/a.js b/apps/web/src/b.js\nrename from apps/web/src/a.js\nrename to apps/web/src/b.js\n', `${mkPatch('apps/web/src/x.js')}GIT binary patch\nliteral 3\n`, '', '   \n', 'no es un parche'];
  for (const p of bad) assert.equal(validatePatch(p, policy).ok, false, p.slice(0, 60));
  assert.equal(validatePatch(mkPatch('apps/web/src/x.js') + 'x'.repeat(policy.limits.maxPatchBytes), policy).reason, 'patch_too_large');
  const mixed = mkPatch('apps/web/src/x.js') + mkPatch('.github/workflows/deploy.yml'); assert.equal(validatePatch(mixed, policy).ok, false);
});

// ── Estado y política ──────────────────────────────────────────────────────────────────────────────────
test('E1 estado: ida y vuelta, validación estricta y límite de la lista de tratados', () => {
  const s = { v: 1, pr: 7, status: STATUS.CORRECTING, head: H0, rounds: 1, maxRounds: 2, handled: ['review:1'], reason: 'x' };
  assert.deepEqual(decodeState(encodeState(s)), s);
  for (const bad of [{ ...s, v: 2 }, { ...s, status: 'X' }, { ...s, head: 'abc' }, { ...s, rounds: -1 }, { ...s, handled: [1] }]) assert.equal(decodeState(encodeState(bad)), null);
  assert.equal(decodeState('sin marcador'), null); assert.equal(decodeState(undefined), null);
});
test('E2 política coherente: dos rondas, ids reales del auditor y del Owner, rutas permitidas disjuntas de las denegadas', () => {
  assert.equal(policy.maxRounds, 2); assert.equal(policy.auditor.id, 199175422); assert.equal(policy.auditor.appId, 1144995); assert.equal(policy.owners[0].id, 280877387);
  for (const a of policy.allowPaths) for (const d of policy.denyPaths) assert.ok(!a.startsWith(d) && !d.startsWith(a), `${a} vs ${d}`);
});

// ── El workflow candidato (análisis estático; no se ejecuta aquí) ──────────────────────────────────────
const wf = fs.readFileSync(new URL('../automation/coordination/candidate/agent-handoff.yml', import.meta.url), 'utf8');
const code = wf.replace(/^[ \t]*#.*$/gm, '').replace(/[ \t]+#.*$/gm, '');
test('W1 installed handoff equals the candidate; existing workflows remain present', () => {
  const dir = fs.readdirSync(new URL('../.github/workflows/', import.meta.url));
  assert.deepEqual(dir.sort(), ['actions-preflight.yml', 'agent-handoff.yml', 'deploy.yml']);
  assert.equal(fs.readFileSync(new URL('../.github/workflows/agent-handoff.yml', import.meta.url), 'utf8'), wf);
});
test('W2 workflow: sin pull_request_target ni pull_request_review ni schedule; solo issue_comment; sin comodines de bots ni usuarios sin escritura', () => {
  assert.doesNotMatch(code, /pull_request_target|pull_request_review|workflow_run|schedule:|workflow_dispatch/);
  assert.match(code, /on:\s*\n\s+issue_comment:\s*\n\s+types: \[created, edited\]/);
  assert.doesNotMatch(code, /allowed_bots:\s*['"]?\*/); assert.doesNotMatch(code, /allowed_non_write_users/);
  assert.match(code, /allowed_bots: 'chatgpt-codex-connector'\n/);
  assert.doesNotMatch(code, /show_full_output|--dangerously|bypassPermissions/);
});
test('W3 todas las acciones externas fijadas a SHA completo; sin tags móviles', () => {
  const uses = [...code.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]); assert.ok(uses.length >= 7);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, u);
  assert.deepEqual([...new Set(uses.map((u) => u.split('@')[0]))].sort(), ['actions/checkout', 'actions/download-artifact', 'actions/setup-node', 'actions/upload-artifact', 'anthropics/claude-code-action']);
});
test('W4 permisos mínimos: workflow {} y por job; el job del modelo sin escritura; solo el publicador escribe contenido', () => {
  assert.match(code, /^permissions: \{\}$/m);
  const jobs = Object.fromEntries([...code.matchAll(/^  (decide|claude|patch|verify|publish|review):\n([\s\S]*?)(?=^  \w+:\n|(?![\s\S]))/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(jobs).sort(), ['claude', 'decide', 'patch', 'publish', 'review', 'verify']);
  assert.doesNotMatch(jobs.claude, /write/); assert.doesNotMatch(jobs.verify, /write/); assert.doesNotMatch(jobs.patch, /write/); assert.doesNotMatch(jobs.verify, /secrets\./); assert.doesNotMatch(jobs.decide, /contents: write/); assert.match(jobs.publish, /contents: write/);
  for (const j of Object.values(jobs)) assert.match(j, /timeout-minutes: \d+/);
  assert.doesNotMatch(code, /id-token/);
});
test('W5 aislamiento de credenciales: el secreto del modelo aparece una vez, en el paso de la acción; ni job env ni secretos de producción', () => {
  assert.equal((code.match(/secrets\.CLAUDE_CODE_OAUTH_TOKEN/g) ?? []).length, 1);
  assert.equal((code.match(/secrets\.ANTHROPIC_API_KEY/g) ?? []).length, 0, 'la alternativa por API solo se documenta en comentarios (no activa)');
  const step = code.slice(code.indexOf('uses: anthropics/claude-code-action'));
  assert.ok(step.indexOf('secrets.CLAUDE_CODE_OAUTH_TOKEN') > 0 && step.indexOf('secrets.CLAUDE_CODE_OAUTH_TOKEN') < step.indexOf('claude_args'));
  assert.doesNotMatch(code, /secrets\.(?!GITHUB_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|CODEX_REVIEW_GITHUB_TOKEN)/);
  assert.doesNotMatch(code.replace(/^\s+env:\s*\n(\s+\w+: .*\n)+/gm, ''), /^env:/m);
  assert.ok((code.match(/persist-credentials: false/g) ?? []).length >= 4, 'ningún checkout deja credenciales en .git');
});
test('W6 confianza del controlador: decide y publish toman código de la rama por defecto; el PR solo se lee como datos; concurrencia 1 por PR sin cancelar', () => {
  assert.match(code, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/g);
  assert.match(code, /group: agent-handoff-pr-\$\{\{ github\.event\.issue\.number \}\}\n\s+cancel-in-progress: false/);
  assert.match(code, /github\.event\.comment\.user\.id == 199175422/); assert.equal(policy.auditor.id, 199175422);
  assert.match(code, /vars\.AGENT_HANDOFF_ENABLED == 'true'/);
  assert.deepEqual([...code.matchAll(/run: .*(npm|pnpm|yarn|npx).*/g)].map((m) => m[0]), ['run: npm ci --ignore-scripts --no-audit --no-fund', 'run: npm ci --ignore-scripts --no-audit --no-fund --prefix automation/preflight/tools', 'run: npm run build --workspace=apps/web'], 'solo verify instala con lockfile congelado y compila sin credenciales');
});

// ── Defensas redundantes (cada capa se prueba por separado) ─────────────────────────────────────────────
const baseFacts = (over = {}) => ({ repository: REPO, switch: { enabled: true }, actorPermission: null, event: { name: 'issue_comment', action: 'edited', isPullRequest: true, actor: CODEX, body: '' },
  pr: { number: 7, state: 'open', merged: false, draft: true, headSha: H0, headRef: 'feature/x', headRepo: REPO, baseRepo: REPO, baseRef: 'main', isFork: false },
  stateComments: [{ id: 1, authorId: WRITER.id, authorType: 'Bot', authorLogin: WRITER.login, body: encodeState({ v: 1, pr: 7, status: STATUS.AWAITING_REVIEW, head: H0, rounds: 0, maxRounds: 2, handled: ['review:5'] }) }],
  auditor: { reviews: [{ id: 5, userId: CODEX.id, userType: 'Bot', userLogin: CODEX.login, commitId: H0, findingCount: 1, findings: [{ path: 'apps/web/src/a.js', line: 1, text: 'x' }] }], receipts: [] }, ...over });
test('R1 una reseña ya tratada (id guardado en el estado) no vuelve a lanzar corrección aunque siga visible en la API', () => {
  const r = decide(baseFacts(), policy); assert.equal(r.action.type, 'none'); assert.equal(r.state.rounds, 0);
  const fresh = baseFacts({ auditor: { reviews: [{ ...baseFacts().auditor.reviews[0], id: 6 }], receipts: [] } });
  assert.equal(decide(fresh, policy).action.type, 'run_claude');
});
test('R2 el rechazo de forks no depende de una sola comprobación; la denegación de rutas no depende solo de la lista permitida', () => {
  assert.equal(precheck({ ...baseFacts(), pr: { ...baseFacts().pr, isFork: true } }, policy), 'fork_or_foreign_head');
  assert.equal(precheck({ ...baseFacts(), pr: { ...baseFacts().pr, headRepo: 'evil/x' } }, policy), 'fork_or_foreign_head');
  const wide = { ...policy, allowPaths: ['apps/'], denyPaths: ['apps/api/'] };
  assert.equal(validatePatch(mkPatch('apps/web/src/x.js'), wide).ok, true);
  assert.equal(validatePatch(mkPatch('apps/api/src/server.js'), wide).reason, 'denied_path');
});

// ── Ronda de corrección #1 de la auditoría de #38 ────────────────────────────────────────────────────────
function gitRepo() {
  const dir = tmp();
  const sh = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  sh(dir, 'init', '-q', '--bare', 'origin.git'); fs.mkdirSync(`${dir}/work`); sh(`${dir}/work`, 'init', '-q', '-b', 'feature/x'); sh(`${dir}/work`, 'remote', 'add', 'origin', `${dir}/origin.git`);
  fs.mkdirSync(`${dir}/work/apps/web/src`, { recursive: true }); fs.mkdirSync(`${dir}/work/.github`, { recursive: true });
  fs.writeFileSync(`${dir}/work/apps/web/src/a.js`, 'export const a = 1;\n'); fs.writeFileSync(`${dir}/work/.nvmrc`, '22\n'); fs.writeFileSync(`${dir}/work/.github/x.yml`, 'a: 1\n');
  sh(`${dir}/work`, 'add', '.'); sh(`${dir}/work`, 'commit', '-q', '-m', 'base'); sh(`${dir}/work`, 'push', '-q', 'origin', 'feature/x');
  return { dir, sh, head: sh(`${dir}/work`, 'rev-parse', 'HEAD') };
}
const copyTree = (from, to) => { fs.cpSync(from, to, { recursive: true, filter: (f) => !f.endsWith('/.git') && !f.includes('/.git/') }); };

test('B1 parche desde la copia de trabajo del modelo: incluye ficheros NUEVOS permitidos, borrados y cambios; ignora .git del modelo y modos', () => {
  const { dir, head } = gitRepo(); const tree = `${dir}/tree`; copyTree(`${dir}/work`, tree);
  fs.writeFileSync(`${tree}/apps/web/src/a.js`, 'export const a = 2;\n');
  fs.writeFileSync(`${tree}/apps/web/src/new.js`, 'export const n = 1;\n'); fs.mkdirSync(`${tree}/tests`, { recursive: true }); fs.writeFileSync(`${tree}/tests/new.test.mjs`, 'x\n');
  const r = buildPatchFromTree({ repoDir: `${dir}/work`, treeDir: tree, policy });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.paths, ['apps/web/src/a.js', 'apps/web/src/new.js', 'tests/new.test.mjs']);
  assert.match(r.patch, /new file mode 100644/);
  // el parche resultante se publica de verdad en un clon limpio y conserva el fichero nuevo en el commit final
  const clean = `${dir}/clean`; spawnSync('git', ['clone', '-q', '-b', 'feature/x', `${dir}/origin.git`, clean]);
  const out = applyPatchAndPush({ repoDir: clean, headSha: head, headRef: 'feature/x', patch: r.patch, round: 1, policy });
  assert.equal(out.ok, true); assert.equal(fs.readFileSync(`${clean}/apps/web/src/new.js`, 'utf8'), 'export const n = 1;\n');
  assert.match(spawnSync('git', ['-C', clean, 'show', '--stat', '--format=', 'HEAD'], { encoding: 'utf8' }).stdout, /new\.js/);
});
test('B2 ficheros nuevos/borrados/symlinks fuera de la lista, .github o automation, y symlinks en el árbol → rechazo', () => {
  for (const [rel, content] of [['.github/workflows/x.yml', 'on: push\n'], ['automation/new.mjs', 'x\n'], ['README.md', 'x\n'], ['apps/api/x.js', 'x\n'], ['.nvmrc', '18\n']]) {
    const { dir } = gitRepo(); const tree = `${dir}/tree`; copyTree(`${dir}/work`, tree); fs.mkdirSync(path.dirname(`${tree}/${rel}`), { recursive: true }); fs.writeFileSync(`${tree}/${rel}`, content);
    assert.equal(buildPatchFromTree({ repoDir: `${dir}/work`, treeDir: tree, policy }).ok, false, rel);
  }
  { const { dir } = gitRepo(); const tree = `${dir}/tree`; copyTree(`${dir}/work`, tree); fs.rmSync(`${tree}/.github/x.yml`);
    assert.equal(buildPatchFromTree({ repoDir: `${dir}/work`, treeDir: tree, policy }).reason, 'denied_path', 'borrar un fichero protegido también se rechaza'); }
  { const { dir } = gitRepo(); const tree = `${dir}/tree`; copyTree(`${dir}/work`, tree); fs.symlinkSync('/etc/passwd', `${tree}/apps/web/src/link.js`);
    assert.equal(buildPatchFromTree({ repoDir: `${dir}/work`, treeDir: tree, policy }).reason, 'symlink_or_special_in_tree'); }
  { const { dir } = gitRepo(); const tree = `${dir}/tree`; copyTree(`${dir}/work`, tree);
    assert.equal(buildPatchFromTree({ repoDir: `${dir}/work`, treeDir: tree, policy }).reason, 'empty_patch', 'sin cambios no hay parche'); }
});
test('B3 un .git/config o un .gitattributes malicioso del modelo no ejecuta nada al construir el parche', () => {
  const { dir } = gitRepo(); const tree = `${dir}/tree`; copyTree(`${dir}/work`, tree); fs.mkdirSync(`${tree}/.git`);
  const mark = `${dir}/PWNED`;
  fs.writeFileSync(`${tree}/.git/config`, `[core]\n\tfsmonitor = touch ${mark}\n[diff "x"]\n\ttextconv = touch ${mark}\n`);
  fs.writeFileSync(`${tree}/.gitattributes`, '* diff=x\n'); fs.writeFileSync(`${tree}/apps/web/src/a.js`, 'export const a = 3;\n');
  buildPatchFromTree({ repoDir: `${dir}/work`, treeDir: tree, policy });
  assert.equal(fs.existsSync(mark), false);
});
test('S3 parada del Owner publicada mientras la ronda corre (sin ejecutar otro gather): ningún push; apagado del interruptor tras empezar: tampoco', async () => {
  for (const mode of ['stop', 'switch']) {
    const { dir, sh, head } = gitRepo(); const g = fakeGithub({ head });
    await step(g, cmdEvent(OWNER)); g.addReview(CODEX, head, [g.finding('apps/web/src/a.js', 1, 'x')]);
    assert.equal((await step(g, codexEvent())).outputs.action, 'run_claude'); assert.equal(stateOf(g).status, STATUS.CORRECTING);
    if (mode === 'stop') g.addComment(OWNER, '/handoff stop'); // comentario real; su ejecución sigue en cola y NO se procesa
    const patch = 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;\n';
    const r = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', patch, repoDir: `${dir}/work`, switchEnabled: mode === 'switch' ? 'false' : 'true' });
    assert.equal(sh(dir, '--git-dir=origin.git', 'rev-parse', 'refs/heads/feature/x'), head, `${mode}: remoto intacto`);
    assert.equal(sh(`${dir}/work`, 'rev-parse', 'HEAD'), head);
    assert.ok(!g.comments.some((c) => c.body === '@codex review'));
    assert.equal(r.outcome, 'stopped'); assert.equal(stateOf(g).status, STATUS.STOPPED, `${mode}: estado terminal reanudable, no CORRECTING colgado`);
  }
  // enable posterior a un stop vuelve a valer; un stop de un impostor no cuenta
  const f = baseFacts({ ownerCommands: [{ id: 5, cmd: 'stop', author: OWNER }, { id: 6, cmd: 'enable', author: OWNER }] }); assert.equal(ownerStopped(f, policy), false);
  assert.equal(ownerStopped(baseFacts({ ownerCommands: [{ id: 7, cmd: 'stop', author: { login: 'cero-absoIuto', id: 1, type: 'User' } }] }), policy), false);
  assert.equal(ownerStopped(baseFacts({ ownerCommands: [{ id: 7, cmd: 'stop', author: OWNER }] }), policy), true);
});
test('V1 pruebas del job verify fallidas u omitidas → BLOCKED y sin push', async () => {
  for (const verifyResult of ['failure', 'skipped', 'cancelled', 'missing']) {
    const { dir, sh, head } = gitRepo(); const g = fakeGithub({ head });
    await step(g, cmdEvent(OWNER)); g.addReview(CODEX, head, [g.finding('apps/web/src/a.js', 1, 'x')]); await step(g, codexEvent());
    const patch = 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;\n';
    const r = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', verifyResult, patch, repoDir: `${dir}/work`, switchEnabled: 'true' });
    assert.equal(r.outcome, 'verification_failed'); assert.equal(stateOf(g).status, STATUS.BLOCKED); assert.equal(sh(dir, '--git-dir=origin.git', 'rev-parse', 'refs/heads/feature/x'), head);
  }
});
test('W7 el job del modelo no tiene shell, git ni red, ni carga config del PR; parche en job de confianza; pruebas en job sin credenciales ni subida; publish exige huella', () => {
  const sec = (n, next) => new RegExp(`^  ${n}:\\n([\\s\\S]*?)(?=^  ${next}:|(?![\\s\\S]))`, 'm').exec(code)[1];
  const claude = sec('claude', 'patch'); const patch = sec('patch', 'verify'); const verify = sec('verify', 'publish'); const publish = sec('publish', 'review');
  assert.doesNotMatch(claude.replace(/--disallowedTools "[^"]*"/, ''), /Bash|WebFetch|WebSearch/); assert.match(claude, /--disallowedTools "Bash,WebFetch,WebSearch/);
  const bootstrap = '        run: sudo apt-get update && sudo apt-get install -y --no-install-recommends bubblewrap';
  assert.equal(claude.split(bootstrap).length, 2, 'instalación fija de bubblewrap exactamente una vez');
  assert.ok(claude.indexOf(bootstrap) < claude.indexOf('uses: actions/checkout@'), 'bootstrap antes del código del PR');
  assert.doesNotMatch(claude.replace(bootstrap, ''), /^\s+run:/m, 'ningún otro run en el job del modelo');
  assert.match(claude, /CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1'/); assert.doesNotMatch(claude, /git diff|node --test/);
  assert.match(claude, /--allowedTools "Read,Glob,Grep,Edit\(apps\/web\/src\/\*\*\),Edit\(tests\/\*\*\)"/); assert.doesNotMatch(claude, /Write\(/, 'las reglas Write(ruta) no se evalúan: solo Edit(ruta)');
  assert.match(claude, /--setting-sources user --strict-mcp-config --disable-slash-commands/);
  assert.match(patch, /publish\.mjs build-patch/); assert.match(patch, /sha256: \$\{\{ steps\.build\.outputs\.sha256 \}\}/); assert.doesNotMatch(patch, /npm|node --test|secrets\./);
  assert.doesNotMatch(verify, /secrets\.|CLAUDE_CODE/); assert.doesNotMatch(verify, /upload-artifact/, 'verify (código del PR) no puede subir ni reemplazar artefactos');
  assert.match(verify, /publish\.mjs check-patch/); assert.match(verify, /EXPECTED_SHA256: \$\{\{ needs\.patch\.outputs\.sha256 \}\}/);
  assert.match(verify, /npm ci --ignore-scripts/); assert.doesNotMatch(verify, /npm install|npm i /); assert.match(verify, /node-version: 22/); assert.match(verify, /node --experimental-test-module-mocks --test/);
  assert.ok(verify.indexOf('check-patch') < verify.indexOf('npm ci') && verify.indexOf('npm ci') < verify.indexOf('git apply') && verify.indexOf('git apply') < verify.indexOf('--test'));
  assert.match(publish, /needs: \[decide, claude, patch, verify\]/); assert.match(publish, /VERIFY_RESULT: \$\{\{ needs\.verify\.result \}\}/);
  assert.match(publish, /EXPECTED_PATCH_SHA256: \$\{\{ needs\.patch\.outputs\.sha256 \}\}/);
  assert.match(publish, /if: always\(\) && needs\.decide\.outputs\.action == 'run_claude'\n/); assert.doesNotMatch(publish.split('runs-on')[0], /vars\./, 'publish corre aunque el interruptor se apague (para persistir STOPPED)');
  assert.match(publish, /AGENT_HANDOFF_ENABLED: \$\{\{ vars\.AGENT_HANDOFF_ENABLED \}\}/);
});
test('I5 integridad: si las pruebas del PR reemplazan el parche por OTRO cambio permitido, no se publica; sin huella o con huella inválida tampoco', async () => {
  const A = 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;\n';
  const B = A.replace('a = 2', 'a = 666');
  assert.equal(validatePatch(B, policy).ok, true, 'el parche sustituto es válido por rutas: solo la huella lo detiene');
  for (const [label, patch, expectedPatchSha256] of [['sustituido', B, sha256(A)], ['sin huella', A, null], ['huella corrupta', A, 'zz'], ['huella vacía', A, '']]) {
    const { dir, sh, head } = gitRepo(); const g = fakeGithub({ head });
    await step(g, cmdEvent(OWNER)); g.addReview(CODEX, head, [g.finding('apps/web/src/a.js', 1, 'x')]); await step(g, codexEvent());
    const r = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', patch, expectedPatchSha256, repoDir: `${dir}/work`, switchEnabled: 'true' });
    assert.equal(r.outcome, 'patch_integrity', label); assert.equal(stateOf(g).status, STATUS.BLOCKED);
    assert.equal(sh(dir, '--git-dir=origin.git', 'rev-parse', 'refs/heads/feature/x'), head, `${label}: remoto intacto`);
  }
  // patch job rechazó o no hubo cambios, y valores por defecto: fail-closed
  for (const [patchStatus, outcome] of [[{ ok: false, reason: 'empty_patch' }, 'no_changes'], [{ ok: false, reason: 'denied_path' }, 'rejected_patch'], [undefined, 'rejected_patch']]) {
    const { dir, head } = gitRepo(); const g = fakeGithub({ head }); await step(g, cmdEvent(OWNER)); g.addReview(CODEX, head, [g.finding('apps/web/src/a.js', 1, 'x')]); await step(g, codexEvent());
    const r = await realPublishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', verifyResult: 'success', patchStatus, expectedPatchSha256: sha256(A), patch: A, repoDir: `${dir}/work`, switchEnabled: 'true' });
    assert.equal(r.outcome, outcome);
  }
  const { dir, head } = gitRepo(); const g = fakeGithub({ head }); await step(g, cmdEvent(OWNER)); g.addReview(CODEX, head, [g.finding('apps/web/src/a.js', 1, 'x')]); await step(g, codexEvent());
  assert.equal((await realPublishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', patch: A, repoDir: `${dir}/work`, switchEnabled: 'true' })).outcome, 'rejected_patch', 'sin parámetros del job patch: fail-closed');
  // camino feliz de referencia: la huella coincide → se publica
  const ok = gitRepo(); const g2 = fakeGithub({ head: ok.head }); await step(g2, cmdEvent(OWNER)); g2.addReview(CODEX, ok.head, [g2.finding('apps/web/src/a.js', 1, 'x')]); await step(g2, codexEvent());
  assert.equal((await publishRound({ api: g2.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', patch: A, repoDir: `${ok.dir}/work`, switchEnabled: 'true' })).outcome, 'pushed');
});
test('X1 el CLI check-patch/build-patch: huella correcta pasa; fichero alterado o huella ajena fallan (proceso real)', () => {
  const dir = tmp(); const f = `${dir}/p.patch`; fs.writeFileSync(f, 'abc\n');
  const run = (sha) => spawnSync(process.execPath, ['automation/coordination/publish.mjs', 'check-patch'], { env: { ...process.env, PATCH_PATH: f, EXPECTED_SHA256: sha }, encoding: 'utf8' }).status;
  assert.equal(run(sha256('abc\n')), 0); assert.equal(run(sha256('abd\n')), 1); assert.equal(run(''), 1);
  fs.writeFileSync(f, 'abd\n'); assert.equal(run(sha256('abc\n')), 1);
});

// ── Ronda adicional (autorizada por el Owner): paginación completa e interruptor apagado ─────────────────
/** API cuya `paginate` es la REAL (makeApi) sobre un `fetch` falso que pagina de verdad a 100 por página. */
function pagedApi(g) {
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url); const method = init.method ?? 'GET'; const q = (k) => Number(u.searchParams.get(k));
    const rc = /reviews\/(\d+)\/comments$/.exec(u.pathname);
    const list = u.pathname.endsWith('/issues/7/comments') ? g.comments : u.pathname.endsWith('/pulls/7/reviews') ? g.reviews : rc ? g.reviews.find((r) => r.id === Number(rc[1])).comments : null;
    if (method === 'GET' && list) { g.calls.push(`GET ${u.pathname}?page=${q('page')}`); const page = list.slice((q('page') - 1) * q('per_page'), q('page') * q('per_page')); return { ok: true, status: 200, json: async () => page }; }
    const body = init.body ? JSON.parse(init.body) : undefined; const data = await g.api.request(method, u.pathname, body);
    return { ok: true, status: data === null ? 204 : 200, json: async () => data };
  };
  return makeApi({ token: 't', fetchImpl });
}
test('PG1 paginación: se leen TODAS las páginas; un stop tras >1000 comentarios impide el push', async () => {
  const { dir, sh, head } = gitRepo(); const g = fakeGithub({ head });
  await step(g, cmdEvent(OWNER)); g.addReview(CODEX, head, [g.finding('apps/web/src/a.js', 1, 'x')]); await step(g, codexEvent());
  for (let i = 0; i < 1249; i++) g.addComment({ login: 'ruido', id: 5000 + i, type: 'User' }, `c${i}`);
  g.addComment(OWNER, '/handoff stop'); assert.ok(g.comments.length > 1250);
  const A = 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;\n';
  g.calls.length = 0; const api = pagedApi(g);
  const r = await publishRound({ api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', patch: A, repoDir: `${dir}/work`, switchEnabled: 'true' });
  assert.equal(r.outcome, 'stopped'); assert.equal(sh(dir, '--git-dir=origin.git', 'rev-parse', 'refs/heads/feature/x'), head);
  assert.ok(g.calls.some((c) => c.endsWith('/comments?page=13')), 'llegó a la página 13 (1,2 mil+ comentarios)');
  assert.equal((await api.paginate(`/repos/${REPO}/issues/7/comments`)).length, g.comments.length);
});
test('PG2 paginación: página justa de 100, vacío, y un techo que NO trunca en silencio (error → el publicador no empuja)', async () => {
  const mk = (n) => ({ ok: true, status: 200, json: async () => Array.from({ length: n }, (_, i) => ({ i })) });
  const paged = (total) => makeApi({ token: 't', fetchImpl: async (url) => { const u = new URL(url); const page = Number(u.searchParams.get('page')); return mk(Math.max(0, Math.min(100, total - (page - 1) * 100))); } });
  assert.equal((await paged(0).paginate('/x')).length, 0); assert.equal((await paged(100).paginate('/x')).length, 100); assert.equal((await paged(1234).paginate('/x')).length, 1234);
  assert.equal((await paged(9999).paginate('/x')).length, 9999);
  await assert.rejects(() => paged(10001).paginate('/x'), /incompleto rechazado/);
  const { dir, sh, head } = gitRepo(); const g = fakeGithub({ head }); await step(g, cmdEvent(OWNER)); g.addReview(CODEX, head, [g.finding('apps/web/src/a.js', 1, 'x')]); await step(g, codexEvent());
  const broken = { request: g.api.request, paginate: async () => { throw new Error('incompleto rechazado'); } };
  const A = 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;\n';
  await assert.rejects(() => publishRound({ api: broken, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', patch: A, repoDir: `${dir}/work`, switchEnabled: 'true' }), /incompleto/);
  assert.equal(sh(dir, '--git-dir=origin.git', 'rev-parse', 'refs/heads/feature/x'), head, 'datos incompletos: nunca se empuja');
});
test('SW1 interruptor apagado tras empezar la ronda: sin push, estado STOPPED persistido (no CORRECTING colgado) y reanudable con /handoff enable', async () => {
  const { dir, sh, head } = gitRepo(); const g = fakeGithub({ head });
  await step(g, cmdEvent(OWNER)); g.addReview(CODEX, head, [g.finding('apps/web/src/a.js', 1, 'x')]);
  assert.equal((await step(g, codexEvent())).outputs.action, 'run_claude'); assert.equal(stateOf(g).rounds, 1);
  const A = 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js\n@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;\n';
  for (const sw of ['false', '', undefined]) { // variable apagada, vacía o ausente
    const gg = fakeGithub({ head }); await step(gg, cmdEvent(OWNER)); gg.addReview(CODEX, head, [gg.finding('apps/web/src/a.js', 1, 'x')]); await step(gg, codexEvent());
    const rr = await publishRound({ api: gg.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', patch: A, repoDir: `${dir}/work`, switchEnabled: sw });
    assert.equal(rr.outcome, 'stopped'); assert.equal(stateOf(gg).status, STATUS.STOPPED); assert.match(stateOf(gg).reason, /switch off/);
  }
  const r = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', patch: A, repoDir: `${dir}/work`, switchEnabled: 'false' });
  assert.equal(r.outcome, 'stopped'); assert.equal(stateOf(g).status, STATUS.STOPPED); assert.equal(stateOf(g).rounds, 1, 'la ronda gastada se conserva');
  assert.equal(sh(dir, '--git-dir=origin.git', 'rev-parse', 'refs/heads/feature/x'), head); assert.ok(!g.comments.some((c) => c.body === '@codex review'));
  assert.ok(g.comments.some((c) => /interruptor global se apagó/.test(c.body)));
  // se reactiva: /handoff enable reanuda; una reseña nueva con hallazgos lanza la ronda 2 (no queda ignorada como correction_in_progress)
  const re = await step(g, cmdEvent(OWNER)); assert.equal(stateOf(g).status, STATUS.AWAITING_REVIEW); assert.equal(re.outputs.action, 'notify');
  g.addReview(CODEX, head, [g.finding('apps/web/src/a.js', 2, 'otro')]);
  const nx = await step(g, codexEvent()); assert.equal(nx.outputs.action, 'run_claude'); assert.equal(nx.outputs.round, '2');
});

// ── Corrección del hallazgo compartido (#39/#38): rutas de cabecera entrecomilladas y decoys ─────────────────
function evilRepo() {
  const g = gitRepo(); fs.writeFileSync(`${g.dir}/work/.github/evil.yml`, 'on: push\n'); fs.mkdirSync(`${g.dir}/work/.github/workflows`, { recursive: true });
  fs.writeFileSync(`${g.dir}/work/.github/workflows/evil.yml`, 'on: push\n');
  g.sh(`${g.dir}/work`, 'add', '.'); g.sh(`${g.dir}/work`, 'commit', '-q', '-m', 'evil'); g.sh(`${g.dir}/work`, 'push', '-q', 'origin', 'feature/x');
  return { ...g, head: g.sh(`${g.dir}/work`, 'rev-parse', 'HEAD') };
}
const QUOTED = 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- "a/.github/workflows/evil.yml"\n+++ "b/.github/workflows/evil.yml"\n@@ -1 +1 @@\n-on: push\n+on: pull_request_target\n';
test('Q1 patch señuelo con ---/+++ entrecomillados: git apply REAL escribiría el fichero denegado; validatePatch lo rechaza (y la ruta que git toca es la que se valida)', () => {
  const { dir, sh, head } = evilRepo();
  // Demostración del ataque que se impide: sin nuestra validación, git aplica la cabecera entrecomillada y modifica el workflow.
  const scratch = `${dir}/scratch`; spawnSync('git', ['clone', '-q', '-b', 'feature/x', `${dir}/origin.git`, scratch]); fs.writeFileSync(`${dir}/q.patch`, QUOTED);
  assert.equal(spawnSync('git', ['-C', scratch, 'apply', `${dir}/q.patch`], { encoding: 'utf8' }).status, 0, 'git apply acepta el parche señuelo');
  assert.equal(fs.readFileSync(`${scratch}/.github/workflows/evil.yml`, 'utf8'), 'on: pull_request_target\n', 'y MODIFICA el fichero denegado');
  assert.equal(fs.readFileSync(`${scratch}/apps/web/src/a.js`, 'utf8'), 'export const a = 1;\n', 'mientras la ruta "aprobada" del diff --git queda intacta');
  const v = validatePatch(QUOTED, policy); assert.equal(v.ok, false); assert.match(v.reason, /header_path_mismatch/);
  // Con el publicador completo: nada se aplica ni se empuja.
  return (async () => {
    const g = fakeGithub({ head }); await step(g, cmdEvent(OWNER)); g.addReview(CODEX, head, [g.finding('apps/web/src/a.js', 1, 'x')]); await step(g, codexEvent());
    const r = await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'success', patch: QUOTED, repoDir: `${dir}/work`, switchEnabled: 'true' });
    assert.equal(r.outcome, 'rejected_patch'); assert.equal(sh(dir, '--git-dir=origin.git', 'rev-parse', 'refs/heads/feature/x'), head);
    assert.equal(fs.readFileSync(`${dir}/work/.github/workflows/evil.yml`, 'utf8'), 'on: push\n');
  })();
});
test('Q2 variantes de señuelo y basura: todas rechazadas con razón concreta', () => {
  const ok = 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js\n@@ -1 +1 @@\n-a\n+b\n';
  assert.equal(validatePatch(ok, policy).ok, true);
  const cases = {
    'sin entrecomillar, ruta distinta': ok.replace('--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js', '--- a/.github/workflows/x.yml\n+++ b/.github/workflows/x.yml'),
    'solo +++ distinto': ok.replace('+++ b/apps/web/src/a.js', '+++ b/.github/workflows/x.yml'),
    'diff --git entrecomillado': ok.replace('diff --git a/apps/web/src/a.js b/apps/web/src/a.js', 'diff --git "a/.github/x.yml" "b/.github/x.yml"').replace(/(---|\+\+\+) ([ab])\/apps\/web\/src\/a.js/g, '$1 "$2/.github/x.yml"'),
    'basura entre cabeceras': ok.replace('--- a/', 'garbage\n--- a/'),
    'basura antes del primer diff': `text libre\n${ok}`,
    'ruta con escape C': ok.replace(/apps\/web\/src\/a\.js/g, 'apps/web/src/\\303\\251.js'),
    'ruta con espacio': ok.replace(/apps\/web\/src\/a\.js/g, 'apps/web/src/a b.js'),
    'tabulador final en ---': ok.replace('--- a/apps/web/src/a.js', '--- a/apps/web/src/a.js\t'),
    'cabeceras duplicadas': ok.replace('--- a/apps/web/src/a.js\n', '--- a/apps/web/src/a.js\n--- a/.github/x\n'),
    'hunk con líneas de más': `${ok}-extra\n`, 'hunk con líneas de menos': ok.replace('@@ -1 +1 @@', '@@ -1,2 +1,2 @@'),
    'segundo bloque oculto tras el hunk': `${ok}diff --git a/.github/x b/.github/x\n--- a/.github/x\n+++ b/.github/x\n@@ -1 +1 @@\n-a\n+b\n`,
    'archivo sin hunks': 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js\n',
    'modo ejecutable nuevo': ok.replace('--- a/', 'new file mode 100755\n--- a/'), 'cambio de modo': ok.replace('--- a/', 'old mode 100644\nnew mode 100644\n--- a/'),
    'CR en el parche': ok.replace('-a\n', '-a\r\n'), 'byte nulo': ok.replace('+b', '+b\0'),
  };
  for (const [name, patch] of Object.entries(cases)) { const v = validatePatch(patch, policy); assert.equal(v.ok, false, name); assert.ok(v.reason, name); }
});
test('Q3 sin falsos positivos: líneas de CONTENIDO que parecen cabeceras dentro de un hunk no cuentan; creación y borrado reales de git pasan', () => {
  const content = 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js\n@@ -1,2 +1,3 @@\n--- a/.github/workflows/evil.yml\n-b\n++ b/.github/workflows/evil.yml\n+++ b/.github/workflows/evil.yml\n+ok\n';
  const v = validatePatch(content, policy); assert.equal(v.ok, true); assert.deepEqual(v.paths, ['apps/web/src/a.js']);
  const { dir } = gitRepo(); fs.writeFileSync(`${dir}/work/apps/web/src/del.js`, 'x\ny\n'); sh0(dir, 'add', '.'); sh0(dir, 'commit', '-q', '-m', 'd');
  fs.rmSync(`${dir}/work/apps/web/src/del.js`); fs.writeFileSync(`${dir}/work/apps/web/src/new.js`, 'n'); fs.writeFileSync(`${dir}/work/apps/web/src/a.js`, 'export const a = 1;\nmás\n');
  spawnSync('git', ['-C', `${dir}/work`, 'add', '-A']); const d = spawnSync('git', ['-C', `${dir}/work`, 'diff', '--cached', '--binary', '--no-renames', 'HEAD'], { encoding: 'utf8' }).stdout;
  const r = validatePatch(d, policy); assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.paths, ['apps/web/src/a.js', 'apps/web/src/del.js', 'apps/web/src/new.js']);
  function sh0(dd, ...a) { const x = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', `${dd}/work`, ...a], { encoding: 'utf8' }); assert.equal(x.status, 0, x.stderr); }
});
test('Q4 segunda capa: aunque un análisis aprobara un parche señuelo, las rutas que git modificó de verdad se comprueban; se deshace sin confirmar ni empujar', () => {
  const { dir, sh, head } = evilRepo(); const before = sh(dir, '--git-dir=origin.git', 'rev-parse', 'refs/heads/feature/x');
  const r = applyPatchAndPush({ repoDir: `${dir}/work`, headSha: head, headRef: 'feature/x', patch: QUOTED, round: 1, policy });
  assert.deepEqual([r.ok, r.reason], [false, 'applied_paths_outside_policy']);
  assert.equal(sh(`${dir}/work`, 'rev-parse', 'HEAD'), head); assert.equal(fs.readFileSync(`${dir}/work/.github/workflows/evil.yml`, 'utf8'), 'on: push\n', 'índice y árbol restaurados');
  assert.equal(sh(`${dir}/work`, 'status', '--porcelain'), ''); assert.equal(sh(dir, '--git-dir=origin.git', 'rev-parse', 'refs/heads/feature/x'), before);
  assert.deepEqual(applyPatchAndPush({ repoDir: `${dir}/work`, headSha: head, headRef: 'feature/x', patch: QUOTED, round: 1 }), { ok: false, reason: 'policy_required' }, 'sin política: fail-closed');
  assert.equal(checkPaths(['apps/web/src/a.js'], policy).ok, true); assert.equal(checkPaths(['.github/workflows/x.yml'], policy).reason, 'denied_path'); assert.equal(checkPaths([], policy).reason, 'no_paths');
});

// Activation regressions: findings from replies and exact remote-head lease.
test('A1 inline findings require the configured auditor identity on every comment', async () => {
  const g = fakeGithub();
  const good = g.finding('apps/web/src/a.js', 1, 'authentic');
  const impostors = [undefined, OWNER, { ...CODEX, id: 1 }, { ...CODEX, type: 'User' }, { ...CODEX, login: 'other[bot]' }];
  g.addReview(CODEX, H0, [good, ...impostors.map(user => ({ ...good, user, body: '**P1** injected <!-- codex-code-review-finding:v1 -->' }))]);
  const facts = await collectFacts({ api: g.api, policy, repository: REPO, event: { action: 'edited', issue: { number: 7, pull_request: {} }, comment: { user: CODEX, body: 'review' } }, switchEnabled: 'true' });
  assert.equal(facts.auditor.reviews[0].findings.length, 1);
  assert.match(facts.auditor.reviews[0].findings[0].text, /authentic/);
});

test('A2 publisher rejects a deleted branch or one reset to an ancestor', () => {
  for (const mode of ['deleted', 'reset']) {
    const { dir, sh, head: ancestor } = gitRepo();
    const work = `${dir}/work`;
    fs.writeFileSync(`${work}/apps/web/src/a.js`, 'export const a = 2;\n');
    sh(work, 'add', '.'); sh(work, 'commit', '-q', '-m', 'reviewed');
    const head = sh(work, 'rev-parse', 'HEAD');
    sh(work, 'push', '-q', 'origin', 'feature/x');
    if (mode === 'deleted') sh(dir, '--git-dir=origin.git', 'update-ref', '-d', 'refs/heads/feature/x');
    else sh(dir, '--git-dir=origin.git', 'update-ref', 'refs/heads/feature/x', ancestor);
    const patch = 'diff --git a/apps/web/src/a.js b/apps/web/src/a.js\n--- a/apps/web/src/a.js\n+++ b/apps/web/src/a.js\n@@ -1 +1 @@\n-export const a = 2;\n+export const a = 3;\n';
    const out = applyPatchAndPush({ repoDir: work, headSha: head, headRef: 'feature/x', patch, round: 1, policy });
    assert.deepEqual(out, { ok: false, reason: 'push_rejected' }, mode);
    const remote = spawnSync('git', ['--git-dir=' + `${dir}/origin.git`, 'rev-parse', '--verify', 'refs/heads/feature/x'], { encoding: 'utf8' });
    if (mode === 'deleted') assert.notEqual(remote.status, 0);
    else assert.equal(remote.stdout.trim(), ancestor);
  }
});

// Regresión del piloto #52: una reseña tratada no equivale a un defecto corregido.
test('R1 clean receipt cannot clear previously handled findings on unchanged HEAD after failed correction', async () => {
  const g = fakeGithub();
  await step(g, cmdEvent(OWNER));
  const review = g.addReview(CODEX, H0, [g.finding('tests/fixture.mjs', 1, 'count + 1 cambia el contador')]);
  await step(g, codexEvent());
  await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'failure', patch: '', repoDir: '/nonexistent', switchEnabled: 'true' });
  await step(g, cmdEvent(OWNER, '/handoff stop'));
  await step(g, cmdEvent(OWNER));
  g.receiptClean(H0);
  const r = await step(g, codexEvent());
  assert.equal(r.outputs.action, 'blocked');
  assert.equal(stateOf(g).status, STATUS.BLOCKED);
  assert.equal(stateOf(g).reason, 'clean_receipt_conflicts_with_findings');
  assert.equal(stateOf(g).rounds, 1);
  assert.ok(stateOf(g).handled.includes(`review:${review.id}`));
  assert.ok(!g.comments.some(c => c.body.startsWith('OWNER_REVIEW')));
});

test('R2 owner retry reuses authenticated handled findings, preserves history and consumes last round', async () => {
  const g = fakeGithub();
  await step(g, cmdEvent(OWNER));
  const review = g.addReview(CODEX, H0, [g.finding('tests/fixture.mjs', 1, 'keep count')]);
  await step(g, codexEvent());
  await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'failure', patch: '', repoDir: '/nonexistent', switchEnabled: 'true' });
  const retry = g.addComment(OWNER, '/handoff retry');
  const r = await step(g, { comment: retry });
  assert.equal(r.outputs.action, 'run_claude');
  assert.equal(r.outputs.round, '2');
  assert.equal(stateOf(g).maxRounds, 2);
  assert.ok(stateOf(g).handled.includes(`review:${review.id}`));
  assert.ok(stateOf(g).handled.includes(`retry-command:${retry.id}`));
  assert.equal(JSON.parse(fs.readFileSync(r.findingsPath)).findings[0].text, '**P1** keep count');
  assert.equal(ownerStopped(r.facts, policy), false);
  assert.equal((await step(g, { comment: retry })).outputs.action, 'none');
  await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 2, claudeResult: 'failure', patch: '', repoDir: '/nonexistent', switchEnabled: 'true' });
  assert.equal((await step(g, { comment: retry })).outputs.reason, 'retry_already_handled');
  assert.equal((await step(g, { comment: g.addComment(OWNER, '/handoff retry') })).outputs.reason, 'retry_round_limit');
  assert.equal(stateOf(g).rounds, 2);
});

test('R3 retry refuses untrusted actors, changed HEAD, absent payload, running round and switch off', async () => {
  for (const mode of ['actor', 'head', 'findings', 'running', 'switch']) {
    const g = fakeGithub(); await step(g, cmdEvent(OWNER));
    g.addReview(CODEX, H0, [g.finding('tests/fixture.mjs', 1, 'x')]); await step(g, codexEvent());
    if (mode !== 'running') await publishRound({ api: g.api, policy, repository: REPO, number: 7, round: 1, claudeResult: 'failure', patch: '', repoDir: '/nonexistent', switchEnabled: 'true' });
    if (mode === 'head') g.pr.head.sha = H1;
    if (mode === 'findings') g.reviews[0].comments = [];
    const retry = g.addComment(mode === 'actor' ? { ...OWNER, id: 999 } : OWNER, '/handoff retry');
    const r = await step(g, { comment: retry }, { enabled: mode === 'switch' ? 'false' : 'true' });
    assert.equal(r.outputs.action, 'none', mode); assert.equal(stateOf(g).rounds, 1, mode);
  }
});

test('R4 retry resumes a stop for publication; a later owner stop still wins', () => {
  const cmds = [{ id: 1, cmd: 'stop', author: OWNER }, { id: 2, cmd: 'retry', author: OWNER }];
  assert.equal(ownerStopped({ ownerCommands: cmds }, policy), false);
  assert.equal(ownerStopped({ ownerCommands: [...cmds, { id: 3, cmd: 'stop', author: OWNER }] }, policy), true);
  assert.equal(ownerStopped({ ownerCommands: [cmds[0], { ...cmds[1], author: { ...OWNER, id: 999 } }] }, policy), true);
});

const bootstrapEmptyPaths = ['.claude-pr/.gitmodules', '.env', '.env.development', '.env.development.local', '.env.local', '.env.production.local', '.env.production', '.env.test', '.env.test.local', '.gitmodules', '.npmrc', '.yarnrc', '.yarnrc.yml', 'bunfig.toml', 'pnpm-lock.yaml', 'yarn.lock'];
test('E1 observed empty bootstrap files are excluded only when new; real correction remains', () => {
  const { dir } = gitRepo(); const tree = `${dir}/tree`; copyTree(`${dir}/work`, tree);
  fs.writeFileSync(`${tree}/apps/web/src/a.js`, 'export const a = 2;\n');
  for (const rel of bootstrapEmptyPaths) { fs.mkdirSync(path.dirname(`${tree}/${rel}`), { recursive: true }); fs.writeFileSync(`${tree}/${rel}`, ''); }
  const r = buildPatchFromTree({ repoDir: `${dir}/work`, treeDir: tree, policy });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.paths, ['apps/web/src/a.js']);
  for (const rel of bootstrapEmptyPaths) assert.equal(fs.existsSync(`${dir}/work/${rel}`), false, rel);
});
test('E2 nonempty bootstrap paths, tracked placeholders and unknown empty paths remain rejected', () => {
  for (const [rel, tracked, value] of [['.npmrc', false, 'hook=x\n'], ['.gitmodules', true, ''], ['.claude-pr/unexpected', false, ''], ['unknown', false, ''], ['tests/new-empty.mjs', false, '']]) {
    const { dir, sh } = gitRepo();
    if (tracked) { fs.writeFileSync(`${dir}/work/${rel}`, 'original\n'); sh(`${dir}/work`, 'add', rel); sh(`${dir}/work`, 'commit', '-qm', 'tracked config'); }
    const tree = `${dir}/tree`; copyTree(`${dir}/work`, tree);
    fs.mkdirSync(path.dirname(`${tree}/${rel}`), { recursive: true }); fs.writeFileSync(`${tree}/${rel}`, value);
    fs.writeFileSync(`${tree}/apps/web/src/a.js`, 'export const a = 2;\n');
    assert.equal(buildPatchFromTree({ repoDir: `${dir}/work`, treeDir: tree, policy }).ok, false, rel);
  }
});

// Credencial de revisión: solo código confiable y sin PR, pruebas ni modelo en el job.
test('W8 el PAT de revisión queda confinado al paso de petición y el publicador exporta solo el SHA publicado', () => {
  const review = code.split('\n  review:\n')[1];
  assert.equal((code.match(/secrets\.CODEX_REVIEW_GITHUB_TOKEN/g) ?? []).length, 1);
  assert.doesNotMatch(code.split('\n  review:\n')[0], /CODEX_REVIEW_GITHUB_TOKEN/);
  assert.match(review, /pull-requests: read/);
  assert.match(review, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.doesNotMatch(review, /download-artifact|npm|CLAUDE_CODE|contents: write|ref:.*needs\./);
  assert.match(review, /run: node automation\/coordination\/request-review\.mjs/);
  assert.match(code, /review_head: \$\{\{ steps\.publish\.outputs\.review_head \}\}/);
});

test('R1 revisión con identidad Owner, deduplicación por SHA y recuperación sin consumir rondas', async () => {
  const g = fakeGithub(); await step(g, cmdEvent(OWNER));
  let posts = 0;
  const ownerApi = { request: async (method, p, body) => {
    if (method === 'GET' && p === '/user') return OWNER;
    assert.equal(method, 'POST'); assert.equal(p, `/repos/${REPO}/issues/7/comments`);
    posts++; return g.addComment(OWNER, body.body);
  } };
  const args = { api: g.api, ownerApi, policy, repository: REPO, number: 7, head: H0, switchEnabled: 'true' };
  assert.equal((await requestReview(args)).outcome, 'requested');
  assert.equal((await requestReview(args)).outcome, 'already_requested'); assert.equal(posts, 1);
  const r = await step(g, cmdEvent(OWNER, '/handoff review'));
  assert.equal(r.result.action.type, 'request_review'); assert.equal(stateOf(g).rounds, 0);
  const s = stateOf(g); s.rounds = 2; g.comments.find((c) => c.body.includes('agent-handoff-state:v1')).body = encodeState(s);
  assert.equal((await step(g, cmdEvent(OWNER, '/handoff review'))).result.action.type, 'request_review'); assert.equal(stateOf(g).rounds, 2);
});
test('R2 token ajeno, SHA obsoleto, stop, estado corrupto, apagado y cambio durante lectura no publican petición', async () => {
  for (const mode of ['identity', 'head', 'stop', 'corrupt', 'off', 'race']) {
    const g = fakeGithub(); await step(g, cmdEvent(OWNER)); let posts = 0;
    if (mode === 'stop') g.addComment(OWNER, '/handoff stop');
    if (mode === 'corrupt') g.comments.find((c) => c.body.includes('agent-handoff-state:v1')).body = '<!-- agent-handoff-state:v1 {} -->';
    const ownerApi = { request: async (method) => { if (method === 'POST') { posts++; return {}; } if (mode === 'race') g.pr.head.sha = H1; return mode === 'identity' ? CODEX : OWNER; } };
    await assert.rejects(requestReview({ api: g.api, ownerApi, policy, repository: REPO, number: 7, head: mode === 'head' ? H1 : H0, switchEnabled: mode === 'off' ? 'false' : 'true' }), /review_/);
    assert.equal(posts, 0, mode);
  }
});

// Formato auténtico observado en #59, comentario 6358008943 (sin recibo textual).
const summaryBody = (over = {}) => '<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ' + JSON.stringify({ code_review: { commit_sha: H0, status: 'completed', has_any_findings: false, has_unresolved_findings: false, ...over } }) + ' -->';
test('S1 resumen auténtico completo cierra y deduplica sin consumir rondas', async () => {
  const g = fakeGithub(); await step(g, cmdEvent(OWNER));
  g.addComment(CODEX, summaryBody(), { performed_via_github_app: { id: policy.auditor.appId } });
  const r = await step(g, codexEvent());
  assert.equal(r.result.state.status, STATUS.OWNER_REVIEW); assert.equal(r.result.state.rounds, 0);
  const count = g.comments.length; await step(g, codexEvent()); assert.equal(g.comments.length, count);
});
test('S2 resumen incompleto, no limpio, obsoleto o ambiguo nunca aprueba', async () => {
  for (const body of [summaryBody({status:'running'}), summaryBody({status:'failed'}), summaryBody({commit_sha:H1}), summaryBody({commit_sha:H0.slice(0,10)}), summaryBody({has_any_findings:null}), summaryBody({has_any_findings:true}), summaryBody({has_unresolved_findings:true}), '<!-- codex-review-state:v1 {bad} -->', summaryBody()+'\n'+summaryBody()]) {
    const g=fakeGithub(); await step(g,cmdEvent(OWNER));
    g.addComment(CODEX,body,{performed_via_github_app:{id:policy.auditor.appId}});
    const r=await step(g,codexEvent()); assert.equal(r.result.state.status,STATUS.AWAITING_REVIEW); assert.equal(r.result.state.rounds,0);
  }
});
test('S3 resumen requiere identidad exacta y aplicación auténtica', async () => {
  for (const [user,app] of [[OWNER,policy.auditor.appId],[{...CODEX,id:123},policy.auditor.appId],[{...CODEX,login:'fake'},policy.auditor.appId],[{...CODEX,type:'User'},policy.auditor.appId],[CODEX,99],[CODEX,null]]) {
    const g=fakeGithub(); await step(g,cmdEvent(OWNER)); g.addComment(user,summaryBody(),{performed_via_github_app:{id:app}});
    const r=await step(g,codexEvent()); assert.equal(r.result.state.status,STATUS.AWAITING_REVIEW);
  }
});
test('S4 resumen limpio no borra hallazgos auténticos del mismo SHA con 2/2 rondas', async () => {
  const g=fakeGithub(); await step(g,cmdEvent(OWNER));
  const sc=g.comments.find(c=>c.body.includes('agent-handoff-state:v1')); const state=decodeState(sc.body);
  const review=g.addReview(CODEX,H0,[g.finding('tests/a.js',1,'defecto')]);
  sc.body=encodeState({...state,rounds:2,handled:[`review:${review.id}`]});
  g.addComment(CODEX,summaryBody(),{performed_via_github_app:{id:policy.auditor.appId}});
  const r=await step(g,codexEvent()); assert.equal(r.result.state.status,STATUS.BLOCKED); assert.equal(r.result.state.rounds,2);
});
test('S5 recibo limpio no elude resumen actual running o con hallazgos', async () => {
  for(const over of [{status:'running'},{has_any_findings:true}]) {
    const g=fakeGithub(); await step(g,cmdEvent(OWNER)); g.receiptClean(H0);
    g.addComment(CODEX,summaryBody(over),{performed_via_github_app:{id:policy.auditor.appId}});
    const r=await step(g,codexEvent()); assert.equal(r.result.state.status,STATUS.AWAITING_REVIEW);
  }
});
