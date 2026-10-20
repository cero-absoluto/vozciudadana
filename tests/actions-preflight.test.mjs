// Preflight A de Actions (#37, encargo 2) — pruebas OFFLINE de la lógica y del workflow candidato.
// Dobles de red/proceso; sin token, sin modelo, sin Codex. NO demuestran el comportamiento en un runner real:
// eso es lo que mide la ejecución manual (ver automation/preflight/PLAN.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as pf from '../automation/preflight/preflight.mjs';

const { PASS, FAIL, NP } = pf;
const policy = pf.loadPolicy();
const REPO = policy.repository;
const by = (rep, id) => rep.checks.find((c) => c.id === id);
const st = (rep, id) => by(rep, id)?.status;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
const root = new URL('..', import.meta.url).pathname;

// ── permisos ────────────────────────────────────────────────────────────────────────────────────────────
const permApi = (writeStatus, readStatus = 200) => async (method) => ({ status: method === 'GET' ? readStatus : writeStatus, json: [] });
test('PE1 permisos: lecturas 200 y escrituras 403 → PASS; 404/422/2xx en una escritura → FAIL (parece permitida); error/5xx → NO_PROBADO', async () => {
  let r = await pf.cmdPermissions({ api: permApi(403), repository: REPO, pr: 38 });
  for (const id of ['read.contents', 'read.issues', 'read.pull_requests', 'write_denied.contents', 'write_denied.issues', 'write_denied.pull_requests']) assert.equal(st(r, id), PASS, id);
  for (const code of [404, 422, 200, 201]) { r = await pf.cmdPermissions({ api: permApi(code), repository: REPO, pr: 38 }); assert.equal(st(r, 'write_denied.contents'), FAIL, String(code)); }
  r = await pf.cmdPermissions({ api: permApi(502), repository: REPO, pr: 38 }); assert.equal(st(r, 'write_denied.issues'), NP);
  r = await pf.cmdPermissions({ api: permApi(403, 403), repository: REPO, pr: 38 }); assert.equal(st(r, 'read.contents'), FAIL);
  r = await pf.cmdPermissions({ api: async () => { throw new Error('red'); }, repository: REPO, pr: 38 }); assert.equal(st(r, 'write_denied.contents'), NP);
  assert.equal(st(r, 'permission.token_as_model_credential'), NP, 'GITHUB_TOKEN no certifica permisos del modelo');
});
test('PE2 las sondas de escritura no pueden tener efecto: recursos inexistentes, sha nulo, sin force', async () => {
  const seen = []; await pf.cmdPermissions({ api: async (m, p, b) => { seen.push([m, p, b]); return { status: 403, json: [] }; }, repository: REPO, pr: 38 });
  const writes = seen.filter(([m]) => m !== 'GET'); assert.equal(writes.length, 3);
  assert.ok(writes.some(([m, p, b]) => m === 'PATCH' && /git\/refs\/heads\/preflight-no-existe$/.test(p) && b.sha === '0'.repeat(40) && b.force === false));
  assert.ok(writes.some(([m, p]) => m === 'POST' && /issues\/2147483647\/comments$/.test(p))); assert.ok(writes.some(([m, p]) => m === 'POST' && /pulls\/2147483647\/comments$/.test(p)));
  assert.ok(writes.every(([, p]) => !/\/pulls\/38|\/issues\/38/.test(p)), 'ninguna escritura apunta a un PR real');
});

// ── identidades de bot ──────────────────────────────────────────────────────────────────────────────────
const A = policy.auditor; const W = policy.stateWriter;
function idApi({ auditorId = A.id, auditorType = A.type, appId = A.appId, writerId = W.id, comments = [], reviews = [], status = 200, pagesStatus = 200 } = {}) {
  return async (method, p) => {
    if (p.startsWith('/users/')) { const login = decodeURIComponent(p.split('/')[2]); return login === A.login ? { status, json: { id: auditorId, type: auditorType } } : { status, json: { id: writerId, type: 'Bot' } }; }
    if (p.startsWith('/apps/')) return { status, json: { id: appId } };
    const page = Number(/[?&]page=(\d+)/.exec(p)?.[1] ?? 1); const list = p.includes('/comments') ? comments : reviews;
    return { status: pagesStatus, json: page === 1 ? list : [] };
  };
}
const codexComment = (extra = {}) => ({ user: { login: A.login, id: A.id, type: A.type }, body: '<!-- codex-review-receipt:v1 -->', performed_via_github_app: { id: A.appId }, created_at: 'a', updated_at: 'a', ...extra });
test('ID1 identidad: API y eventos reales coinciden → PASS; id/tipo/app distintos → FAIL; sin datos → NO_PROBADO; entrega bot→Codex siempre NO_PROBADO', async () => {
  let r = await pf.cmdIdentity({ api: idApi({ comments: [codexComment({ updated_at: 'b' })], reviews: [{ user: { login: A.login, id: A.id, type: A.type }, commit_id: 'a'.repeat(40) }] }), repository: REPO, pr: 38 });
  for (const id of ['api.auditor_user', 'api.state_writer_user', 'api.auditor_app_id', 'event.auditor_identity', 'event.auditor_receipt_app', 'event.auditor_review_commit_id', 'event.auditor_comment_edited']) assert.equal(st(r, id), PASS, id);
  assert.equal(st(r, 'event.state_writer_comment'), NP, 'sin comentarios de github-actions[bot] no se puede afirmar (exige issues: write)');
  r = await pf.cmdIdentity({ api: idApi({ auditorId: 1 }), repository: REPO, pr: 38 }); assert.equal(st(r, 'api.auditor_user'), FAIL);
  r = await pf.cmdIdentity({ api: idApi({ auditorType: 'User' }), repository: REPO, pr: 38 }); assert.equal(st(r, 'api.auditor_user'), FAIL);
  r = await pf.cmdIdentity({ api: idApi({ appId: 2 }), repository: REPO, pr: 38 }); assert.equal(st(r, 'api.auditor_app_id'), FAIL);
  r = await pf.cmdIdentity({ api: idApi({ writerId: 7 }), repository: REPO, pr: 38 }); assert.equal(st(r, 'api.state_writer_user'), FAIL, 'el id de github-actions[bot] de la política se contrasta con la API');
  r = await pf.cmdIdentity({ api: idApi({ comments: [codexComment({ user: { login: A.login, id: 99, type: 'Bot' } })] }), repository: REPO, pr: 38 }); assert.equal(st(r, 'event.auditor_identity'), FAIL);
  r = await pf.cmdIdentity({ api: idApi({ comments: [codexComment({ performed_via_github_app: { id: 5 } })] }), repository: REPO, pr: 38 }); assert.equal(st(r, 'event.auditor_receipt_app'), FAIL);
  r = await pf.cmdIdentity({ api: idApi({ comments: [codexComment({ user: { login: 'otro', id: 1, type: 'User' } })] }), repository: REPO, pr: 38 }); assert.equal(st(r, 'event.auditor_activity_present'), NP);
  r = await pf.cmdIdentity({ api: idApi({ status: 403, pagesStatus: 404 }), repository: REPO, pr: 38 }); assert.equal(st(r, 'api.auditor_user'), NP); assert.equal(st(r, 'event.real_pr'), NP);
  for (const x of [r, await pf.cmdIdentity({ api: idApi(), repository: REPO, pr: 38 })]) { assert.equal(st(x, 'delivery.bot_to_codex'), NP); assert.equal(st(x, 'delivery.codex_event_to_workflow'), NP); }
});

// ── fijación de acciones ────────────────────────────────────────────────────────────────────────────────
test('PI1 pins: parsePins; ls-remote que coincide → PASS; SHA distinto → FAIL; sin comentario de versión → FAIL; ls-remote vacío → NO_PROBADO', () => {
  const sha = 'a'.repeat(40); const yml = `- uses: x/y@${sha} # v1.2.3\n- uses: p/q@${'b'.repeat(40)}\n`;
  assert.deepEqual(pf.parsePins(yml).map((p) => [p.repo, p.tag]), [['x', 'y'].join('/'), 'v1.2.3'].length ? [['x/y', 'v1.2.3'], ['p/q', null]] : []);
  const f = tmp(); const file = path.join(f, 'w.yml'); fs.writeFileSync(file, `- uses: x/y@${sha} # v1.2.3\n`);
  const pins = path.join(f, 'pins.json'); fs.writeFileSync(pins, JSON.stringify({ 'claude-code-action': { repo: 'c/a', tag: 'v9', sha: 'c'.repeat(40) } }));
  const spawnWith = (out) => () => ({ status: out === null ? 1 : 0, stdout: out ?? '' });
  const run = (out) => pf.cmdPins({ files: [file], spawn: spawnWith(out), pinsFile: pins });
  assert.equal(st(run(`${sha}\trefs/tags/v1.2.3\n`), 'pin.x/y'), PASS); assert.equal(st(run(`${'d'.repeat(40)}\trefs/tags/v1.2.3\n`), 'pin.x/y'), FAIL);
  assert.equal(st(run(`${'e'.repeat(40)}\trefs/tags/v1.2.3\n${sha}\trefs/tags/v1.2.3^{}\n`), 'pin.x/y'), PASS, 'etiqueta anotada: vale el SHA pelado');
  assert.equal(st(run(''), 'pin.x/y'), NP); assert.equal(st(run(null), 'pin.x/y'), NP);
  fs.writeFileSync(file, `- uses: x/y@${sha}\n`); assert.equal(st(run(`${sha}\trefs/tags/v1\n`), 'pin.x/y'), FAIL);
  fs.writeFileSync(file, 'sin pins\n'); assert.equal(st(pf.cmdPins({ files: [file], spawn: spawnWith(''), pinsFile: pins }), 'pins.found'), FAIL, 'sin acciones fijadas');
});

// ── CLI sin inferencia ──────────────────────────────────────────────────────────────────────────────────
function cliSpawn({ sha = '6c690188da61cf16ee7debb28383ba67f02abb4c', version = '2.1.290', help = pf.CLI_FLAGS.join(' ') + ' --max-turns', npmOk = true } = {}) {
  const calls = [];
  const fn = (cmd, args, opts) => { calls.push([cmd, args, opts]);
    if (cmd === 'git') return { status: 0, stdout: `${sha}\n` }; if (cmd === 'npm') return { status: npmOk ? 0 : 1, stdout: '', stderr: npmOk ? '' : 'npm error boom\nmás' };
    if (args[0] === '--version') return { status: 0, stdout: `${version} (Claude Code)\n` }; if (args[0] === '--help') return { status: 0, stdout: help }; return { status: 1 }; };
  fn.calls = calls; return fn;
}
function actionTree(version = '2.1.290') { const d = tmp(); fs.mkdirSync(`${d}/base-action`); fs.writeFileSync(`${d}/base-action/action.yml`, `x\n          CLAUDE_CODE_VERSION="${version}"\n`); return d; }
test('CL1 CLI: versión del pin de la acción, flags y NO_PROBADO de todo lo que exige inferencia; solo --version/--help; entorno sin credenciales', () => {
  const d = actionTree(); const sp = cliSpawn(); const env = { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: '', HTTPS_PROXY: 'http://u:p@proxy' };
  const r = pf.cmdCli({ env, actionDir: d, installDir: `${tmp()}/cli`, spawn: sp });
  for (const id of ['action.sha', 'action.cli_version_pin', 'job.no_model_credentials', 'cli.install', 'cli.version', ...pf.CLI_FLAGS.map((x) => `cli.flag${x}`), 'cli.flag--max-turns']) assert.equal(st(r, id), PASS, id);
  for (const id of ['cli.hooks_mcp_not_loaded', 'cli.edit_rules_effective', 'cli.subprocess_env_scrub', 'cli.network_isolation']) assert.equal(st(r, id), NP, id);
  const exec = sp.calls.filter(([c]) => c !== 'git' && c !== 'npm'); assert.deepEqual(exec.map(([, a]) => a), [['--version'], ['--help']], 'el CLI solo se invoca con --version y --help (sin -p, sin prompt)');
  const npm = sp.calls.find(([c]) => c === 'npm'); assert.ok(!('CLAUDE_CODE_OAUTH_TOKEN' in npm[2].env) && !('ANTHROPIC_API_KEY' in npm[2].env) && !('GITHUB_TOKEN' in npm[2].env));
  assert.equal(JSON.stringify(r).includes('u:p@proxy'), false, 'el proxy (red) no se imprime');
});
test('CL2 CLI: SHA de acción distinto, versión distinta, flag ausente, credencial presente → FAIL; npm caído → NO_PROBADO; sin pin → FAIL', () => {
  const run = (o, env = { PATH: '/x' }, ver) => pf.cmdCli({ env, actionDir: actionTree(ver), installDir: `${tmp()}/c`, spawn: cliSpawn(o) });
  assert.equal(st(run({ sha: 'f'.repeat(40) }), 'action.sha'), FAIL); assert.equal(st(run({ version: '2.1.999' }), 'cli.version'), FAIL);
  assert.equal(st(run({ help: '--allowedTools' }), 'cli.flag--strict-mcp-config'), FAIL);
  assert.equal(st(run({}, { PATH: '/x', ANTHROPIC_API_KEY: 'sk-ant-real-looking-value' }), 'job.no_model_credentials'), FAIL);
  assert.equal(st(run({ npmOk: false }), 'cli.install'), NP); assert.match(by(run({ npmOk: false }), 'cli.install').detail, /boom/);
  assert.equal(st(run({ help: pf.CLI_FLAGS.join(' ') }), 'cli.flag--max-turns'), NP);
  assert.equal(st(run({}, { PATH: '/x' }, 'no-version'), 'action.cli_version_pin'), FAIL);
});

// ── contexto, entorno e integridad ──────────────────────────────────────────────────────────────────────
function ctxSpawn({ head = 'a'.repeat(40), dirty = '', cred = '' } = {}) { return (cmd, args) => (args[0] === 'rev-parse' ? { status: 0, stdout: head } : args[0] === 'status' ? { status: 0, stdout: dirty } : { status: cred ? 0 : 1, stdout: cred }); }
function ctxEnv(sender = { id: 280877387, login: 'cero-absoluto', type: 'User' }) {
  const d = tmp(); fs.writeFileSync(`${d}/ev.json`, JSON.stringify({ sender, ref: 'refs/heads/main', repository: { default_branch: 'main' } }));
  return { RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', GITHUB_SHA: 'a'.repeat(40), GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: REPO, GITHUB_EVENT_PATH: `${d}/ev.json` };
}
test('CX1 contexto: checkout, evento manual y actor Owner → PASS; HEAD distinto, sucio, credencial persistida, actor ajeno o repo ajeno → FAIL', () => {
  let r = pf.cmdContext({ env: ctxEnv(), spawn: ctxSpawn() });
  for (const id of ['runner.hosted', 'checkout.sha', 'checkout.clean', 'checkout.no_persisted_credentials', 'event.name', 'repo.identity', 'event.actor_is_owner']) assert.equal(st(r, id), PASS, id);
  assert.equal(st(r, 'runner.node'), /^v22\./.test(process.version) ? PASS : FAIL);
  assert.equal(st(pf.cmdContext({ env: ctxEnv(), spawn: ctxSpawn({ head: 'b'.repeat(40) }) }), 'checkout.sha'), FAIL);
  assert.equal(st(pf.cmdContext({ env: ctxEnv(), spawn: ctxSpawn({ dirty: ' M x' }) }), 'checkout.clean'), FAIL);
  assert.equal(st(pf.cmdContext({ env: ctxEnv(), spawn: ctxSpawn({ cred: 'AUTHORIZATION: basic x' }) }), 'checkout.no_persisted_credentials'), FAIL);
  assert.equal(st(pf.cmdContext({ env: ctxEnv({ id: 1, login: 'cero-absoluto', type: 'User' }), spawn: ctxSpawn() }), 'event.actor_is_owner'), FAIL, 'mismo login con otro id');
  assert.equal(st(pf.cmdContext({ env: { ...ctxEnv(), GITHUB_REPOSITORY: 'evil/x' }, spawn: ctxSpawn() }), 'repo.identity'), FAIL);
  assert.equal(st(pf.cmdContext({ env: { ...ctxEnv(), GITHUB_EVENT_NAME: 'push' }, spawn: ctxSpawn() }), 'event.name'), FAIL);
  assert.equal(st(pf.cmdContext({ env: { ...ctxEnv(), GITHUB_EVENT_PATH: '/no/existe' }, spawn: ctxSpawn() }), 'event.actor_is_owner'), NP);
});
test('EN1 aislamiento de entorno de un paso: A ve la credencial FICTICIA y el hijo la hereda; B (paso siguiente) no; ninguna certifica al modelo', () => {
  const k = 'CLAUDE_CODE_OAUTH_TOKEN'; const saved = process.env[k]; process.env[k] = 'FICTICIO-NO-ES-UN-TOKEN-preflight';
  try { const a = pf.cmdEnvA({ env: process.env }); assert.equal(st(a, 'env.fake_present_in_step'), PASS); assert.equal(st(a, 'env.child_inherits_by_default'), PASS); } finally { if (saved === undefined) delete process.env[k]; else process.env[k] = saved; }
  assert.equal(st(pf.cmdEnvB({ env: {} }), 'env.not_in_next_step'), PASS); assert.equal(st(pf.cmdEnvB({ env: { [k]: 'x' } }), 'env.not_in_next_step'), FAIL);
  assert.equal(st(pf.cmdEnvB({ env: {} }), 'env.fake_is_not_a_real_credential'), NP);
});
test('IN1 integridad: mismos bytes → PASS; fichero alterado, ausente o huella inválida → FAIL; sustitución válida y manipulación detectadas', () => {
  const d = tmp(); const p = pf.cmdIntegrityProduce({ outDir: d }); assert.equal(st(p.report, 'fixture.patch_valid'), PASS); assert.match(p.sha256, /^[0-9a-f]{64}$/);
  const r = pf.cmdIntegrityConsume({ dir: d, expected: p.sha256 }); for (const id of ['artifact.same_bytes_across_jobs', 'integrity.detects_tamper', 'integrity.detects_valid_substitution']) assert.equal(st(r, id), PASS, id);
  fs.writeFileSync(`${d}/handoff.patch`, fs.readFileSync(`${root}automation/preflight/fixtures/patch-b.patch`)); assert.equal(st(pf.cmdIntegrityConsume({ dir: d, expected: p.sha256 }), 'artifact.same_bytes_across_jobs'), FAIL, 'el segundo parche válido NO pasa con la huella del primero');
  assert.equal(st(pf.cmdIntegrityConsume({ dir: d, expected: 'zz' }), 'artifact.same_bytes_across_jobs'), FAIL); assert.equal(st(pf.cmdIntegrityConsume({ dir: tmp(), expected: p.sha256 }), 'artifact.same_bytes_across_jobs'), FAIL);
});
test('CO1 controlador con fixtures: decisiones, parada, interruptor real; escribe action/round para las puertas `if:`', () => {
  const d = tmp(); const out = `${d}/o`; fs.writeFileSync(out, '');
  const r = pf.cmdController({ env: { GITHUB_OUTPUT: out, AGENT_HANDOFF_ENABLED: '' } });
  for (const c of r.checks) assert.equal(c.status, PASS, c.id); assert.equal(fs.readFileSync(out, 'utf8'), 'action=run_claude\nround=1\n');
  assert.match(by(r, 'controller.with_actual_switch').detail, /ausente\/vacío → none/);
  assert.match(by(pf.cmdController({ env: { AGENT_HANDOFF_ENABLED: 'true' } }), 'controller.with_actual_switch').detail, /= true → run_claude/);
});

// ── resumen, interruptor, redacción ─────────────────────────────────────────────────────────────────────
test('SU1 resumen: puertas `if:` y vars por job; FAIL → código 1; NO_PROBADO no falla', () => {
  const d = tmp(); fs.writeFileSync(`${d}/a.json`, JSON.stringify({ name: 'a', checks: [{ id: 'x', status: PASS, detail: 'ok' }, { id: 'y', status: NP, detail: 'n' }] }));
  const run = (env) => pf.cmdSummary({ dir: d, env: { GATE_RUN_RESULT: 'success', GATE_SKIP_RESULT: 'skipped', SWITCH_1: 'true', SWITCH_2: 'false', SWITCH_WAIT: '60', ARTIFACT_DIGEST: `sha256:${'a'.repeat(64)}`, ...env } });
  let s = run({}); assert.equal(s.fail, 0); assert.equal(st(s.report, 'vars.evaluated_per_job'), PASS); assert.equal(st(s.report, 'gate.skip_when_action_differs'), PASS); assert.match(s.markdown, /PASS 5 · FAIL 0 · NO_PROBADO 1/);
  s = run({ SWITCH_2: 'true' }); assert.equal(st(s.report, 'vars.evaluated_per_job'), NP); assert.equal(s.fail, 0);
  s = run({ SWITCH_WAIT: '0', SWITCH_2: 'true' }); assert.match(by(s.report, 'vars.evaluated_per_job').detail, /no se intentó/);
  s = run({ GATE_SKIP_RESULT: 'success' }); assert.equal(s.fail, 1); s = run({ GATE_RUN_RESULT: 'skipped' }); assert.equal(s.fail, 1);
  fs.writeFileSync(`${d}/b.json`, JSON.stringify({ name: 'b', checks: [{ id: 'z', status: FAIL, detail: 'mal' }] })); assert.equal(run({}).fail, 1);
});
test('SW1 vars: valores enumerados (true/false/otro/ausente); nunca el texto libre', () => {
  for (const [v, e] of [['true', 'true'], ['false', 'false'], ['loquesea-secreto', 'otro'], ['', 'ausente'], [undefined, 'ausente']]) { const x = pf.cmdSwitch({ env: { SWITCH_VALUE: v }, which: 1 }); assert.equal(x.value, e); assert.ok(!JSON.stringify(x.report).includes('loquesea')); }
});
test('RE1 redacción: valor de un token presente en el entorno, o con forma de secreto, bloquea la escritura del informe; el CLI sale con 2 y no lo imprime', () => {
  const tok = 'ghs_' + 'A'.repeat(36); const d = tmp();
  assert.throws(() => pf.assertNoSecrets(`algo ${tok} algo`, {}), /secret_like/); assert.throws(() => pf.assertNoSecrets('xx valor-secreto-123456 xx', { GITHUB_TOKEN: 'valor-secreto-123456' }), /secret_leak_blocked:GITHUB_TOKEN/);
  assert.doesNotThrow(() => pf.assertNoSecrets('texto normal con FICTICIO-NO-ES-UN-TOKEN-preflight', {}));
  assert.throws(() => pf.assertNoSecrets('FICTICIO-NO-ES-UN-TOKEN-preflight', { CLAUDE_CODE_OAUTH_TOKEN: 'FICTICIO-NO-ES-UN-TOKEN-preflight' }), /secret_leak_blocked/, 'si la variable está en el entorno, su valor nunca sale (ni siquiera el ficticio)');
  assert.throws(() => pf.writeReport({ name: 'x', checks: [{ id: 'a', status: PASS, detail: tok }] }, d, {}));
  assert.equal(fs.existsSync(`${d}/x.json`), false, 'no se escribe el informe con un secreto');
  const reports = tmp(); fs.writeFileSync(`${reports}/r.json`, JSON.stringify({ name: 'r', checks: [{ id: 'a', status: PASS, detail: tok }] }));
  const r = spawnSync(process.execPath, [`${root}automation/preflight/preflight.mjs`, 'summary'], { env: { PATH: process.env.PATH, REPORT_DIR: reports }, encoding: 'utf8' });
  assert.equal(r.status, 2); assert.ok(!r.stdout.includes(tok) && !r.stderr.includes(tok), 'el valor no sale por stdout ni stderr');
});
test('RE2 el CLI no vuelca el entorno: ejecutar `controller` con un entorno lleno de valores no los imprime ni los guarda', () => {
  const d = tmp(); const env = { PATH: process.env.PATH, REPORT_DIR: d, GITHUB_TOKEN: 'valor-secreto-GT-98765432', CLAUDE_CODE_OAUTH_TOKEN: 'valor-secreto-CC-98765432', AGENT_HANDOFF_ENABLED: 'true' };
  const r = spawnSync(process.execPath, [`${root}automation/preflight/preflight.mjs`, 'controller'], { env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  const all = r.stdout + r.stderr + fs.readFileSync(`${d}/controller.json`, 'utf8'); assert.ok(!all.includes('valor-secreto'));
});

// ── workflow candidato y alcance ────────────────────────────────────────────────────────────────────────
const wfPath = `${root}automation/preflight/candidate/actions-preflight.yml`;
const wf = fs.readFileSync(wfPath, 'utf8'); const code = wf.replace(/^[ \t]*#.*$/gm, '').replace(/[ \t]+#.*$/gm, '');
const jobsOf = (c) => Object.fromEntries([...c.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|(?![\s\S]))/gm)].filter((m) => !/^(workflow_dispatch|inputs|pr_number|switch_wait_seconds)$/.test(m[1])).map((m) => [m[1], m[2]]));
test('WF1 candidato inerte, manual y de solo lectura: fuera de .github/workflows; solo workflow_dispatch; sin escrituras, secretos, id-token ni acción de Claude', () => {
  assert.deepEqual(fs.readdirSync(`${root}.github/workflows`), ['deploy.yml']); assert.ok(!fs.existsSync(`${root}.github/workflows/actions-preflight.yml`));
  assert.match(code, /^on:\n  workflow_dispatch:\n/m); assert.doesNotMatch(code, /\n  (push|pull_request\w*|issue_comment|schedule|workflow_run):/);
  assert.match(code, /^permissions: \{\}$/m); assert.doesNotMatch(code, /(contents|issues|pull-requests|actions|checks|statuses|packages|id-token|deployments): write|write-all/); assert.doesNotMatch(code, /id-token/);
  assert.doesNotMatch(code, /secrets\./); assert.doesNotMatch(code, /anthropics\/claude-code-action@|claude_code_oauth_token|anthropic_api_key|ANTHROPIC_API_KEY/);
  assert.doesNotMatch(code, /git push|git commit|gh (pr|api|issue)|curl|wget|\| ?bash|npm (install|ci)|@codex/);
  assert.doesNotMatch(code, /\bprintenv\b|\benv\b *$|set -x|ACTIONS_STEP_DEBUG|ACTIONS_RUNNER_DEBUG|echo \$\{\{|toJSON\(/m, 'ningún paso vuelca entorno ni contextos');
  for (const [name, body] of Object.entries(jobsOf(code))) { assert.match(body, /timeout-minutes: \d+/, name); assert.match(body, /runs-on: ubuntu-latest/, name); }
  assert.equal(Object.keys(jobsOf(code)).length, 8); assert.match(code, /group: actions-preflight\n\s+cancel-in-progress: false/);
});
test('WF2 acciones fijadas a SHA con versión; la acción del modelo solo se CLONA (checkout) en el SHA de pins.json; pins.json coherente', () => {
  const uses = [...code.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]); for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, u);
  assert.deepEqual([...new Set(uses.map((u) => u.split('@')[0]))].sort(), ['actions/checkout', 'actions/download-artifact', 'actions/setup-node', 'actions/upload-artifact']);
  assert.equal([...wf.matchAll(/uses:\s*\S+@[0-9a-f]{40}\s*# v\d/g)].length, uses.length, 'cada uses lleva su versión en un comentario');
  const pin = JSON.parse(fs.readFileSync(`${root}automation/preflight/pins.json`, 'utf8'))['claude-code-action'];
  assert.match(wf, new RegExp(`repository: anthropics/claude-code-action\\n\\s+ref: ${pin.sha}`)); assert.match(pin.sha, /^[0-9a-f]{40}$/);
});
test('WF3 permisos por job: solo lectura; solo `runner` lee issues/pull-requests; la credencial ficticia solo en el paso env-a; GITHUB_TOKEN solo en permissions e identity', () => {
  const jobs = jobsOf(code);
  for (const [n, b] of Object.entries(jobs)) { assert.doesNotMatch(b, /: write/, n); if (n !== 'runner') assert.doesNotMatch(b, /issues: read|pull-requests: read/, n); }
  assert.deepEqual(jobs.runner.match(/CLAUDE_CODE_OAUTH_TOKEN: .*/g), ['CLAUDE_CODE_OAUTH_TOKEN: FICTICIO-NO-ES-UN-TOKEN-preflight']); assert.equal((code.match(/CLAUDE_CODE_OAUTH_TOKEN/g) ?? []).length, 1);
  const steps = jobs.runner.split(/\n      - /); const withToken = steps.filter((x) => /GITHUB_TOKEN/.test(x)).map((x) => /preflight\.mjs (\w+)/.exec(x)?.[1]); assert.deepEqual(withToken, ['permissions', 'identity']);
  assert.equal((code.match(/github\.token/g) ?? []).length, 2);
  assert.match(jobs['gate-run'], /permissions: \{\}/); assert.match(jobs['gate-skip'], /permissions: \{\}/);
});
test('WF4 las puertas leen la salida del controlador y el orden de comprobaciones es el previsto (sin pasos sobre modelo/Codex)', () => {
  assert.match(code, /if: needs\.runner\.outputs\.action == 'run_claude'/); assert.match(code, /if: needs\.runner\.outputs\.action == 'none'/); assert.match(code, /action: \$\{\{ steps\.controller\.outputs\.action \}\}/);
  const order = [...code.matchAll(/preflight\.mjs (context|permissions|identity|pins|cli|env-a|env-b|controller)\b/g)].map((m) => m[1]); assert.deepEqual(order, ['context', 'permissions', 'identity', 'pins', 'cli', 'env-a', 'env-b', 'controller']);
  assert.match(code, /switch 1\n[\s\S]*preflight\.mjs wait[\s\S]*switch 2/);
});
test('WF5 actionlint (si está instalado) no encuentra problemas en el candidato', (t) => {
  const v = spawnSync('actionlint', ['-version']); if (v.status !== 0) return t.skip('actionlint no instalado');
  const r = spawnSync('actionlint', [wfPath], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stdout + r.stderr);
});
test('DP1 un push a main con estos ficheros no activa despliegues: deploy.yml filtra por rutas y ninguna del PR coincide; todo vive bajo automation/ y tests/', () => {
  const deploy = fs.readFileSync(`${root}.github/workflows/deploy.yml`, 'utf8');
  const paths = [...(/^    paths:\n((?:      - .*\n)+)/m.exec(deploy)?.[1] ?? '').matchAll(/- '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(paths.sort(), ['.github/workflows/deploy.yml', 'apps/web/**', 'package.json']); assert.match(deploy, /branches: \[main\]/);
  const re = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
  const railway = ['/apps/api/**']; // watchPatterns de Railway: ajuste de cuenta, no está en el repositorio (no verificable aquí)
  const changed = new Set(['automation/preflight/preflight.mjs', 'automation/preflight/PLAN.md', 'automation/preflight/pins.json', 'automation/preflight/candidate/actions-preflight.yml', 'automation/preflight/fixtures/patch-a.patch', 'automation/preflight/fixtures/patch-b.patch', 'automation/coordination/controller.mjs', 'automation/coordination/policy.json', 'tests/actions-preflight.test.mjs']);
  const base = process.env.PREFLIGHT_BASE ?? 'origin/main'; const diff = spawnSync('git', ['-C', root, 'diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' });
  if (diff.status === 0) for (const f of diff.stdout.split('\n').filter(Boolean)) changed.add(f);
  for (const f of changed) { assert.ok(/^(automation|tests)\//.test(f), `${f} fuera de automation/ y tests/`); assert.ok(!paths.some((g) => re(g).test(f)), `${f} activaría deploy.yml`); assert.ok(!railway.some((g) => re(g.replace(/^\//, '')).test(f)), `${f} activaría el despliegue de la API`); }
  for (const f of ['.github/workflows/actions-preflight.yml']) { assert.ok(!paths.some((g) => re(g).test(f)), `${f} (ubicación futura del workflow, tras autorización) tampoco activa deploy.yml`); }
  assert.ok(re('apps/web/**').test('apps/web/src/x.js') && re('package.json').test('package.json') && !re('package.json').test('automation/package.json'), 'el comprobador de rutas detecta lo que debe');
});
test('VE1 las piezas reutilizadas de #38 son idénticas byte a byte (hash de blob git del commit 642b9ab)', () => {
  const h = (f) => spawnSync('git', ['hash-object', `${root}${f}`], { encoding: 'utf8' }).stdout.trim();
  assert.equal(h('automation/coordination/controller.mjs'), '7d0282870a683262e9fb11ef441581d09eb4a23c'); assert.equal(h('automation/coordination/policy.json'), '56714bd08189fa7e2c1ba246cf406617dd323bbd');
});
