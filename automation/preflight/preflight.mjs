// Preflight A de Actions (#37, encargo 2). MANUAL, SIN INFERENCIA: no usa token ni modelo de Claude ni lanza revisión de Codex.
// Cada comando devuelve comprobaciones PASS | FAIL | NO_PROBADO y las guarda como fragmento JSON; `summary` las une.
//  • PASS / FAIL: observado por el propio comando (en el runner, o con dobles en las pruebas offline).
//  • NO_PROBADO: requiere inferencia, un permiso adicional o una ejecución que esta fase no hace (se dice cuál).
// NUNCA se imprime ni guarda un valor de entorno o de secreto: solo booleanos y datos públicos (ids, versiones).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decide, ownerStopped, mayPublish, validatePatch, encodeState, STATUS } from '../coordination/controller.mjs';

export const PASS = 'PASS'; export const FAIL = 'FAIL'; export const NP = 'NO_PROBADO';
const here = path.dirname(fileURLToPath(import.meta.url));
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const loadPolicy = () => JSON.parse(fs.readFileSync(path.join(here, '../coordination/policy.json'), 'utf8'));
const H = (c) => c.repeat(40);

/** Nombres de variables cuyo VALOR no puede aparecer jamás en la salida. */
export const SENSITIVE_ENV = ['GITHUB_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
/** Inventario OBLIGATORIO por informe: si falta un informe o una comprobación, `summary` FALLA (nunca PASS por ausencia). */
export const REQUIRED = {
  context: ['runner.node', 'runner.hosted', 'checkout.sha', 'checkout.clean', 'checkout.no_persisted_credentials', 'event.name', 'repo.identity', 'event.actor_is_owner', 'event.ref'],
  permissions: ['read.contents', 'read.issues', 'read.pull_requests', 'write_denied.contents', 'write_denied.issues', 'write_denied.pull_requests', 'permission.token_as_model_credential'],
  identity: ['api.auditor_user', 'api.state_writer_user', 'api.auditor_app_id', 'event.auditor_activity_present', 'event.auditor_identity', 'event.auditor_receipt_app', 'event.auditor_review_commit_id', 'event.auditor_comment_edited', 'event.state_writer_comment', 'delivery.bot_to_codex', 'delivery.codex_event_to_workflow'],
  pins: ['pins.found', 'pins.unpinned', 'pin.actions/checkout', 'pin.actions/setup-node', 'pin.actions/upload-artifact', 'pin.actions/download-artifact', 'pin.anthropics/claude-code-action'],
  cli: ['action.sha', 'action.cli_version_pin', 'job.no_model_credentials', 'cli.install', 'cli.version', 'cli.flag--allowedTools', 'cli.flag--disallowedTools', 'cli.flag--setting-sources', 'cli.flag--strict-mcp-config', 'cli.flag--disable-slash-commands', 'cli.flag--permission-mode', 'cli.flag--max-turns', 'cli.hooks_mcp_not_loaded', 'cli.edit_rules_effective', 'cli.subprocess_env_scrub', 'cli.network_isolation'],
  'env-a': ['env.fake_present_in_step', 'env.child_inherits_by_default'],
  'env-b': ['env.not_in_next_step', 'env.fake_is_not_a_real_credential'],
  controller: ['controller.finding_runs_claude', 'controller.stale_sha_ignored', 'controller.switch_off', 'controller.stop_blocks_publish', 'controller.stop_by_impostor_ignored', 'controller.with_actual_switch'],
  'integrity-produce': ['fixture.patch_valid'],
  'integrity-consume': ['artifact.same_bytes_across_jobs', 'integrity.detects_tamper', 'integrity.detects_valid_substitution'],
  'switch-1': ['switch.1'], wait: ['wait.done'], 'switch-2': ['switch.2'],
};
/** Marca de error de infraestructura (red, API, instalación): un NO_PROBADO con esta marca NO es un límite previsto y `summary` lo cuenta como FAIL. */
const INFRA = { infra: true };
export class Report {
  constructor(name) { this.name = name; this.checks = []; }
  add(id, status, detail = '', data = undefined) { this.checks.push({ id, status, detail, ...(data === undefined ? {} : { data }) }); return this; }
}
/** Toda comprobación obligatoria que un retorno temprano no llegó a emitir queda como NO_PROBADO de infraestructura (→ FAIL en el resumen). */
export function ensure(r) { for (const id of REQUIRED[r.name] ?? []) if (!r.checks.some((c) => c.id === id)) r.add(id, NP, 'comprobación no ejecutada (ejecución interrumpida)', INFRA); return r; }
/** Falla si el texto contiene el valor de alguna variable sensible presente en `env` (o un token con aspecto de secreto). */
export function assertNoSecrets(text, env = process.env) {
  for (const k of SENSITIVE_ENV) {
    const v = env[k];
    if (v && String(v).length >= 8 && text.includes(String(v))) throw new Error(`secret_leak_blocked:${k}`);
  }
  if (/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{20,})\b/.test(text)) throw new Error('secret_like_value_blocked');
}
export function writeReport(report, dir, env = process.env) {
  const text = JSON.stringify(report, null, 2);
  assertNoSecrets(text, env);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${report.name}.json`), text);
  return text;
}

// ── API de solo lectura (más tres sondas de escritura SIN efecto) ─────────────────────────────────────────
export const makeFetchApi = ({ token, fetchImpl = globalThis.fetch, base = 'https://api.github.com' }) => async (method, p, body) => {
  const res = await fetchImpl(`${base}${p}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json };
};

// ── comandos ──────────────────────────────────────────────────────────────────────────────────────────────
const sh = (spawn, cmd, args, opts = {}) => { const r = spawn(cmd, args, { encoding: 'utf8', ...opts }); return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }; };

/** Contexto del runner, del checkout y del evento. Sin volcar entorno. */
export function cmdContext({ env, spawn = spawnSync, fs: f = fs, policy = loadPolicy() }) {
  const r = new Report('context');
  r.add('runner.node', /^v22\./.test(process.version) ? PASS : FAIL, `node ${process.version}`);
  r.add('runner.hosted', env.RUNNER_ENVIRONMENT === 'github-hosted' ? PASS : FAIL, `RUNNER_ENVIRONMENT=${env.RUNNER_ENVIRONMENT ?? 'ausente'}; ${env.RUNNER_OS ?? '?'}/${env.RUNNER_ARCH ?? '?'}; imagen ${env.ImageVersion ?? '?'}`);
  const head = sh(spawn, 'git', ['rev-parse', 'HEAD']); const dirty = sh(spawn, 'git', ['status', '--porcelain']);
  r.add('checkout.sha', head.ok && head.out === env.GITHUB_SHA ? PASS : FAIL, `HEAD == GITHUB_SHA: ${head.out === env.GITHUB_SHA}`);
  r.add('checkout.clean', dirty.ok && dirty.out === '' ? PASS : FAIL, dirty.out ? 'árbol con cambios' : 'árbol limpio');
  const cred = sh(spawn, 'git', ['config', '--get-all', 'http.https://github.com/.extraheader']);
  r.add('checkout.no_persisted_credentials', cred.out === '' ? PASS : FAIL, 'persist-credentials:false efectivo (sin extraheader en .git/config)');
  r.add('event.name', env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? PASS : FAIL, `evento ${env.GITHUB_EVENT_NAME ?? 'ausente'}`);
  r.add('repo.identity', env.GITHUB_REPOSITORY === policy.repository ? PASS : FAIL, `repositorio == política: ${env.GITHUB_REPOSITORY === policy.repository}`);
  let ev = null; try { ev = JSON.parse(f.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')); } catch { /* sin evento */ }
  const s = ev?.sender;
  const owner = policy.owners.some((o) => o.id === s?.id && o.login === s?.login && o.type === s?.type);
  r.add('event.actor_is_owner', s ? (owner ? PASS : FAIL) : NP, s ? `actor id=${s.id} tipo=${s.type} login=${s.login}; coincide con el Owner de la política: ${owner}` : 'sin payload de evento', s ? { id: s.id, type: s.type, login: s.login } : INFRA);
  r.add('event.ref', ev ? PASS : NP, `ref=${ev?.ref ?? '?'} default_branch=${ev?.repository?.default_branch ?? '?'}`, ev ? undefined : INFRA);
  return ensure(r);
}

/** Permisos efectivos del GITHUB_TOKEN: lecturas esperadas OK; escrituras esperadas DENEGADAS (403), con sondas que no pueden tener efecto. */
export async function cmdPermissions({ api, repository, pr }) {
  const r = new Report('permissions');
  const reads = [['contents', `/repos/${repository}`], ['issues', `/repos/${repository}/issues/${pr}/comments?per_page=1`], ['pull_requests', `/repos/${repository}/pulls/${pr}`]];
  for (const [scope, p] of reads) {
    try { const x = await api('GET', p); r.add(`read.${scope}`, x.status === 200 ? PASS : FAIL, `GET → ${x.status}`); } catch (e) { r.add(`read.${scope}`, NP, `error de red: ${e.message}`, INFRA); }
  }
  // Sondas sin efecto posible: el recurso NO existe. Con permiso de escritura GitHub contesta 404/422; sin él, 403.
  const writes = [
    ['contents', 'PATCH', `/repos/${repository}/git/refs/heads/preflight-no-existe`, { sha: H('0'), force: false }],
    ['issues', 'POST', `/repos/${repository}/issues/2147483647/comments`, { body: 'preflight' }],
    ['pull_requests', 'POST', `/repos/${repository}/pulls/2147483647/comments`, { body: 'preflight' }],
  ];
  for (const [scope, m, p, b] of writes) {
    try {
      const x = await api(m, p, b);
      r.add(`write_denied.${scope}`, x.status === 403 ? PASS : (x.status === 404 || x.status === 422 || (x.status >= 200 && x.status < 300)) ? FAIL : NP,
        x.status === 403 ? 'escritura denegada (403): permisos de solo lectura efectivos' : `respuesta ${x.status}: la escritura parece permitida o la denegación es ambigua`, (x.status === 403 || x.status === 404 || x.status === 422 || (x.status >= 200 && x.status < 300)) ? undefined : INFRA);
    } catch (e) { r.add(`write_denied.${scope}`, NP, `error de red: ${e.message}`, INFRA); }
  }
  r.add('permission.token_as_model_credential', NP, 'GITHUB_TOKEN no certifica permisos del modelo autenticado (credencial de Claude): requiere inferencia');
  return ensure(r);
}

const botPath = (login) => `/users/${encodeURIComponent(login)}`;
const RECEIPT = 'codex-review-receipt:v1';
/** Identidades de bot: (1) API pública; (2) eventos REALES ya existentes en un PR (solo lectura). */
export async function cmdIdentity({ api, repository, pr, policy = loadPolicy() }) {
  const r = new Report('identity');
  const user = async (id, login, type, expectedId) => {
    try { const x = await api('GET', botPath(login)); r.add(id, x.status === 200 ? (x.json?.id === expectedId && x.json?.type === type ? PASS : FAIL) : NP, x.status === 200 ? `API: id=${x.json?.id} tipo=${x.json?.type}; política: id=${expectedId} tipo=${type}` : `GET → ${x.status}`, x.status === 200 ? undefined : INFRA); }
    catch (e) { r.add(id, NP, `error de red: ${e.message}`, INFRA); }
  };
  await user('api.auditor_user', policy.auditor.login, policy.auditor.type, policy.auditor.id);
  await user('api.state_writer_user', policy.stateWriter.login, policy.stateWriter.type, policy.stateWriter.id);
  try { const x = await api('GET', `/apps/${encodeURIComponent(policy.auditor.login.replace(/\[bot\]$/, ''))}`); r.add('api.auditor_app_id', x.status === 200 ? (x.json?.id === policy.auditor.appId ? PASS : FAIL) : NP, x.status === 200 ? `API: app id=${x.json?.id}; política: ${policy.auditor.appId}` : `GET /apps/<slug> → ${x.status}`, x.status === 200 || x.status === 404 ? undefined : INFRA); } catch (e) { r.add('api.auditor_app_id', NP, `error de red: ${e.message}`, INFRA); }
  // Eventos reales ya publicados en el PR indicado (no se crea ninguno).
  try {
    const pages = async (p) => { const out = []; for (let i = 1; i <= 5; i++) { const x = await api('GET', `${p}${p.includes('?') ? '&' : '?'}per_page=100&page=${i}`); if (x.status !== 200) throw new Error(`GET → ${x.status}`); out.push(...x.json); if (x.json.length < 100) break; } return out; };
    const comments = await pages(`/repos/${repository}/issues/${pr}/comments`); const reviews = await pages(`/repos/${repository}/pulls/${pr}/reviews`);
    const byAuditor = [...comments, ...reviews].filter((c) => c.user?.login === policy.auditor.login);
    r.add('event.auditor_activity_present', byAuditor.length ? PASS : NP, byAuditor.length ? `${byAuditor.length} comentarios/reseñas del auditor en el PR #${pr}` : `sin actividad del auditor en el PR #${pr}`);
    r.add('event.auditor_identity', byAuditor.length ? (byAuditor.every((c) => c.user.id === policy.auditor.id && c.user.type === policy.auditor.type) ? PASS : FAIL) : NP, byAuditor.length ? 'id y tipo del autor de TODAS sus piezas coinciden con la política' : 'sin piezas del auditor en este PR');
    const receipts = comments.filter((c) => c.user?.login === policy.auditor.login && (c.body ?? '').includes(RECEIPT));
    r.add('event.auditor_receipt_app', receipts.length ? (receipts.every((c) => c.performed_via_github_app?.id === policy.auditor.appId) ? PASS : FAIL) : NP, receipts.length ? `${receipts.length} recibos; app id coincide con la política en todos` : 'sin recibo del auditor en este PR');
    const revs = reviews.filter((x) => x.user?.login === policy.auditor.login);
    r.add('event.auditor_review_commit_id', revs.length ? (revs.every((x) => /^[0-9a-f]{40}$/.test(x.commit_id ?? '')) ? PASS : FAIL) : NP, revs.length ? `${revs.length} reseñas con commit_id de 40 hex` : 'sin reseñas del auditor');
    const edited = comments.filter((c) => c.user?.login === policy.auditor.login && c.updated_at && c.created_at && c.updated_at !== c.created_at);
    r.add('event.auditor_comment_edited', edited.length ? PASS : NP, edited.length ? 'hay comentarios del auditor editados tras crearse (evidencia de ediciones)' : 'sin ediciones observadas; la ENTREGA del evento `edited` a un workflow no se prueba aquí');
    const actions = comments.filter((c) => c.user?.login === policy.stateWriter.login);
    r.add('event.state_writer_comment', actions.length ? (actions.every((c) => c.user.id === policy.stateWriter.id) ? PASS : FAIL) : NP, actions.length ? 'comentarios de github-actions[bot] con el id de la política' : 'ningún comentario creado con GITHUB_TOKEN en este PR: comprobarlo exige crear uno (issues: write, permiso adicional)');
  } catch (e) { r.add('event.real_pr', NP, `no se pudo leer el PR #${pr}: ${e.message}`, INFRA); }
  r.add('delivery.bot_to_codex', NP, 'FASE B (PR sintética): un comentario de bot no se prueba aquí; requiere permiso de comentario y consume cuota de Codex');
  r.add('delivery.codex_event_to_workflow', NP, 'la entrega de eventos issue_comment de Codex a un workflow requiere un workflow activo (no autorizado)');
  return ensure(r);
}

/** Cada `uses: owner/repo@SHA # vX` del workflow debe resolver (git ls-remote) a ese SHA. */
export function parsePins(text) {
  const pins = []; let m; const re = /^\s*-?\s*uses:\s*([\w.-]+\/[\w.-]+)@([0-9a-f]{40})(?:\s*#\s*(\S+))?/gm;
  while ((m = re.exec(text))) pins.push({ repo: m[1], sha: m[2], tag: m[3] ?? null });
  return pins;
}
/** TODOS los `uses:` del workflow que no sean locales (./): los que no fijan un SHA de 40 caracteres se devuelven para fallar (no se omiten). */
export function unpinnedUses(text) {
  const bad = []; let m; const re = /^[ \t]*(?:-[ \t]*)?uses:[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s#][^\n#]*?))[ \t]*(?:#.*)?$/gm;
  while ((m = re.exec(text))) {
    const ref = (m[1] ?? m[2] ?? m[3]).trim(); if (ref.startsWith('./')) continue;
    if (!/^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/.test(ref)) bad.push(ref);
  }
  return bad;
}
export function cmdPins({ files, spawn = spawnSync, fs: f = fs, pinsFile = path.join(here, 'pins.json') }) {
  const r = new Report('pins'); const seen = new Map();
  for (const file of files) { if (!f.existsSync(file)) continue; for (const p of parsePins(f.readFileSync(file, 'utf8'))) seen.set(`${p.repo}@${p.sha}`, { ...p, file }); }
  const present = files.filter((x) => f.existsSync(x));
  const unpinned = []; for (const file of present) for (const u of unpinnedUses(f.readFileSync(file, 'utf8'))) unpinned.push(`${file}: ${u}`);
  r.add('pins.unpinned', unpinned.length ? FAIL : PASS, unpinned.length ? `referencias sin SHA de 40 caracteres: ${unpinned.join('; ')}` : 'todo `uses:` externo está fijado a un SHA de 40 caracteres');
  r.add('pins.found', seen.size ? PASS : FAIL, `${seen.size} acciones fijadas por SHA en ${present.length} fichero(s) candidato(s)`);
  const ca = JSON.parse(f.readFileSync(pinsFile, 'utf8'))['claude-code-action'];
  seen.set(`${ca.repo}@${ca.sha}`, { ...ca, file: 'pins.json' }); // la acción del modelo se fija por `ref:` en el checkout de solo lectura
  for (const p of seen.values()) {
    if (!p.tag) { r.add(`pin.${p.repo}`, FAIL, 'sin comentario de versión (# vX)'); continue; }
    const x = sh(spawn, 'git', ['ls-remote', `https://github.com/${p.repo}.git`, `refs/tags/${p.tag}`, `refs/tags/${p.tag}^{}`]);
    if (!x.ok || !x.out) { r.add(`pin.${p.repo}`, NP, `ls-remote sin resultado para ${p.tag}`, INFRA); continue; }
    const shas = x.out.split('\n').map((l) => l.split('\t')[0]);
    r.add(`pin.${p.repo}`, shas.includes(p.sha) ? PASS : FAIL, `${p.tag} → ${shas.map((s) => s.slice(0, 7)).join(', ')}; fijado ${p.sha.slice(0, 7)}`);
  }
  return ensure(r);
}

export const CLI_FLAGS = ['--allowedTools', '--disallowedTools', '--setting-sources', '--strict-mcp-config', '--disable-slash-commands', '--permission-mode'];
/** Versión de CLI que instalaría la acción fijada, y CLI real instalado SIN invocar inferencia (solo --version y --help). */
export function cmdCli({ env, actionDir, installDir, pinsFile = path.join(here, 'pins.json'), spawn = spawnSync, fs: f = fs }) {
  const r = new Report('cli'); const pins = JSON.parse(f.readFileSync(pinsFile, 'utf8'))['claude-code-action'];
  const head = sh(spawn, 'git', ['-C', actionDir, 'rev-parse', 'HEAD']);
  r.add('action.sha', head.ok && head.out === pins.sha ? PASS : FAIL, `checkout de la acción == SHA fijado (${pins.tag}): ${head.out === pins.sha}`);
  const yml = f.existsSync(path.join(actionDir, 'base-action/action.yml')) ? f.readFileSync(path.join(actionDir, 'base-action/action.yml'), 'utf8') : '';
  const v = /CLAUDE_CODE_VERSION="(\d+\.\d+\.\d+)"/.exec(yml)?.[1];
  r.add('action.cli_version_pin', v ? PASS : FAIL, v ? `la acción instala el CLI ${v}` : 'no se encontró CLAUDE_CODE_VERSION en base-action/action.yml');
  f.mkdirSync(installDir, { recursive: true });
  const clean = { PATH: env.PATH, HOME: installDir, npm_config_cache: path.join(installDir, '.npm'), npm_config_update_notifier: 'false' }; // entorno SIN credenciales de modelo
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'npm_config_cafile']) if (env[k]) clean[k] = env[k]; // solo red (vacío en runners hospedados); nunca se imprime
  r.add('job.no_model_credentials', SENSITIVE_ENV.filter((k) => k !== 'GITHUB_TOKEN' && k !== 'ACTIONS_RUNTIME_TOKEN' && k !== 'ACTIONS_ID_TOKEN_REQUEST_TOKEN').every((k) => !env[k]) ? PASS : FAIL, 'sin credencial de modelo en el entorno de este job');
  if (!v) return ensure(r);
  const inst = sh(spawn, 'npm', ['install', '--prefix', installDir, '--no-audit', '--no-fund', `@anthropic-ai/claude-code@${v}`], { env: clean });
  r.add('cli.install', inst.ok ? PASS : NP, inst.ok ? `npm @anthropic-ai/claude-code@${v} (la acción usa el instalador de claude.ai: mismo número de versión, NO se prueba que el binario sea idéntico)` : `npm install falló: ${inst.err.split('\n')[0].slice(0, 160)}`, inst.ok ? undefined : INFRA);
  if (!inst.ok) return ensure(r);
  const bin = path.join(installDir, 'node_modules/.bin/claude');
  const ver = sh(spawn, bin, ['--version'], { env: clean }); r.add('cli.version', ver.ok && ver.out.startsWith(v) ? PASS : FAIL, `claude --version → ${ver.out.split('\n')[0]}`);
  const help = sh(spawn, bin, ['--help'], { env: clean });
  for (const fl of CLI_FLAGS) r.add(`cli.flag${fl}`, help.out.includes(fl) ? PASS : FAIL, `${fl} ${help.out.includes(fl) ? 'listado en --help' : 'NO listado'}`);
  r.add('cli.flag--max-turns', help.out.includes('--max-turns') ? PASS : NP, help.out.includes('--max-turns') ? 'listado' : 'no aparece en --help (puede ser opción oculta); su efecto requiere inferencia');
  for (const [id, why] of [['cli.hooks_mcp_not_loaded', 'hooks y MCP de .claude/.mcp.json del PR con los flags del workflow (requiere inferencia para los hooks de prompt)'], ['cli.edit_rules_effective', 'reglas Edit(ruta) y Bash denegado (requiere inferencia)'], ['cli.subprocess_env_scrub', 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB (requiere inferencia y herramientas)'], ['cli.network_isolation', 'aislamiento de red del proceso del modelo (no probable sin inferencia ni runner con filtro de salida)']]) r.add(id, NP, why);
  return ensure(r);
}

/** Aislamiento del entorno de un paso: A recibe una credencial FICTICIA; B (paso siguiente) no debe verla. Solo booleanos. */
export function cmdEnvA({ env, spawn = spawnSync }) {
  const r = new Report('env-a'); const k = 'CLAUDE_CODE_OAUTH_TOKEN';
  const child = spawn(process.execPath, ['-e', `process.exit(process.env.${k} ? 0 : 1)`], { env: process.env });
  r.add('env.fake_present_in_step', env[k] ? PASS : FAIL, 'la credencial ficticia está en el paso que la declara (sanidad)');
  r.add('env.child_inherits_by_default', child.status === 0 ? PASS : NP, `un proceso hijo ${child.status === 0 ? 'HEREDA' : 'no hereda'} la variable sin depuración (por eso importa CLAUDE_CODE_SUBPROCESS_ENV_SCRUB; su efecto NO se prueba aquí)`, child.status === 0 ? undefined : INFRA);
  return ensure(r);
}
export function cmdEnvB({ env }) {
  const r = new Report('env-b'); const k = 'CLAUDE_CODE_OAUTH_TOKEN';
  r.add('env.not_in_next_step', !env[k] ? PASS : FAIL, 'un paso posterior del mismo job NO ve la variable declarada solo en el paso anterior');
  r.add('env.fake_is_not_a_real_credential', NP, 'la credencial ficticia no certifica permisos ni autenticación del modelo');
  return ensure(r);
}

// ── integridad del parche entre jobs y salida del controlador ───────────────────────────────────────────
export function cmdIntegrityProduce({ outDir, policy = loadPolicy(), fs: f = fs }) {
  const r = new Report('integrity-produce'); f.mkdirSync(outDir, { recursive: true });
  const buf = f.readFileSync(path.join(here, 'fixtures/patch-a.patch')); f.writeFileSync(path.join(outDir, 'handoff.patch'), buf);
  const v = validatePatch(buf.toString('utf8'), policy);
  r.add('fixture.patch_valid', v.ok ? PASS : FAIL, `validatePatch(fixture) → ${v.ok ? 'ok' : v.reason}`);
  return { report: r, sha256: sha256(buf), bytes: buf.length };
}
export function cmdIntegrityConsume({ dir, expected, policy = loadPolicy(), fs: f = fs }) {
  const r = new Report('integrity-consume'); const file = path.join(dir, 'handoff.patch');
  const got = f.existsSync(file) ? f.readFileSync(file) : null;
  r.add('artifact.same_bytes_across_jobs', got && /^[0-9a-f]{64}$/.test(expected ?? '') && sha256(got) === expected ? PASS : FAIL, 'sha256 del artefacto descargado == salida del job que lo produjo');
  if (!got) return ensure(r);
  const tampered = Buffer.from(got); tampered[tampered.length - 2] ^= 1;
  r.add('integrity.detects_tamper', sha256(tampered) !== expected ? PASS : FAIL, 'un byte alterado cambia la huella');
  const b = f.readFileSync(path.join(here, 'fixtures/patch-b.patch'));
  r.add('integrity.detects_valid_substitution', validatePatch(b.toString('utf8'), policy).ok && sha256(b) !== expected ? PASS : FAIL, 'un segundo parche VÁLIDO por rutas se distingue solo por la huella');
  return ensure(r);
}

const baseFacts = (over = {}) => {
  const policy = loadPolicy(); const head = H('a');
  const state = { v: 1, pr: 7, status: STATUS.AWAITING_REVIEW, head, rounds: 0, maxRounds: policy.maxRounds, handled: [] };
  return { repository: policy.repository, switch: { enabled: true }, actorPermission: null, ownerCommands: [],
    event: { name: 'issue_comment', action: 'edited', isPullRequest: true, actor: { login: policy.auditor.login, id: policy.auditor.id, type: policy.auditor.type }, body: '' },
    pr: { number: 7, state: 'open', merged: false, draft: true, headSha: head, headRef: 'feature/x', headRepo: policy.repository, baseRepo: policy.repository, baseRef: 'main', isFork: false },
    stateComments: [{ id: 1, authorId: policy.stateWriter.id, authorType: policy.stateWriter.type, authorLogin: policy.stateWriter.login, body: encodeState(state) }],
    auditor: { reviews: [{ id: 5, userId: policy.auditor.id, userType: policy.auditor.type, userLogin: policy.auditor.login, commitId: head, findingCount: 1, findings: [{ path: 'apps/web/src/a.js', line: 1, text: 'fixture' }] }], receipts: [] }, ...over };
};
/** Controlador con fixtures: decisiones, parada, interruptor y la salida GITHUB_OUTPUT que consumen los `if:` de otros jobs. */
export function cmdController({ env, policy = loadPolicy(), fs: f = fs }) {
  const r = new Report('controller'); const base = baseFacts();
  const run = decide(base, policy);
  r.add('controller.finding_runs_claude', run.action.type === 'run_claude' && run.action.round === 1 ? PASS : FAIL, `hallazgo en el HEAD actual → ${run.action.type} ronda ${run.action.round}`);
  const stale = baseFacts({ auditor: { reviews: [{ ...base.auditor.reviews[0], commitId: H('b') }], receipts: [] } });
  r.add('controller.stale_sha_ignored', decide(stale, policy).action.type === 'none' ? PASS : FAIL, 'reseña de SHA antiguo → none');
  r.add('controller.switch_off', decide(baseFacts({ switch: { enabled: false } }), policy).action.reason === 'global_switch_off' ? PASS : FAIL, 'interruptor apagado → global_switch_off');
  const owner = policy.owners[0];
  const stopFacts = baseFacts({ ownerCommands: [{ id: 9, cmd: 'stop', author: owner }] });
  const mp = mayPublish({ ...JSON.parse(JSON.stringify({ status: STATUS.CORRECTING, rounds: 1, head: H('a') })) }, stopFacts, policy, 1);
  r.add('controller.stop_blocks_publish', ownerStopped(stopFacts, policy) && mp === false ? PASS : FAIL, 'stop del Owner posterior → mayPublish=false');
  r.add('controller.stop_by_impostor_ignored', !ownerStopped(baseFacts({ ownerCommands: [{ id: 9, cmd: 'stop', author: { ...owner, id: 1 } }] }), policy) ? PASS : FAIL, 'stop con otro id → ignorado');
  const real = decide(baseFacts({ switch: { enabled: env.AGENT_HANDOFF_ENABLED === 'true' } }), policy);
  r.add('controller.with_actual_switch', PASS, `interruptor real del repositorio (vars) = ${env.AGENT_HANDOFF_ENABLED === 'true' ? 'true' : env.AGENT_HANDOFF_ENABLED ? 'otro valor' : 'ausente/vacío'} → ${real.action.type}`);
  if (env.GITHUB_OUTPUT) f.appendFileSync(env.GITHUB_OUTPUT, `action=${run.action.type}\nround=${run.action.round}\n`);
  return ensure(r);
}

// ── interruptor `vars` por job, puertas `if:` y resumen ───────────────────────────────────────────────────
const enumSwitch = (v) => (v === 'true' ? 'true' : v === 'false' ? 'false' : v ? 'otro' : 'ausente');
export function cmdSwitch({ env, which }) { return { report: new Report(`switch-${which}`).add(`switch.${which}`, PASS, `vars.AGENT_HANDOFF_ENABLED = ${enumSwitch(env.SWITCH_VALUE)}`), value: enumSwitch(env.SWITCH_VALUE) }; }
/** `upload-artifact` (v7.0.2, SHA fijado) publica `artifact-digest` como el sha256 en hexadecimal SIN prefijo (src/shared/upload-artifact.ts → digest del flujo subido; el prefijo `sha256:` solo va a su API). Se acepta ese formato (y, por tolerancia, con prefijo). */
export const parseArtifactDigest = (v) => { const m = /^(?:sha256:)?([0-9a-f]{64})$/.exec(String(v ?? '')); return m ? m[1] : null; };
export const JOB_EXPECTED = { runner: 'success', produce: 'success', consume: 'success', 'gate-run': 'success', 'gate-skip': 'skipped', 'switch-1': 'success', 'switch-2': 'success' };
const envKey = (job) => `RESULT_${job.toUpperCase().replace(/-/g, '_')}`;
/**
 * Resumen. Una ejecución INCOMPLETA nunca da PASS: faltan informes/comprobaciones obligatorias, resultado de job distinto del
 * esperado, estado desconocido o NO_PROBADO de infraestructura → FAIL. NO_PROBADO solo vale para los límites previstos.
 */
export function cmdSummary({ dir, env, fs: f = fs }) {
  const r = new Report('summary'); const rows = [];
  for (const [name, ids] of Object.entries(REQUIRED)) {
    let rep = null; try { rep = JSON.parse(f.readFileSync(path.join(dir, `${name}.json`), 'utf8')); } catch { /* ausente o ilegible */ }
    if (!rep || rep.name !== name || !Array.isArray(rep.checks)) { r.add(`inventory.report.${name}`, FAIL, 'informe ausente, ilegible o con otro nombre: ejecución incompleta'); continue; }
    for (const c of rep.checks) {
      if (![PASS, FAIL, NP].includes(c?.status)) rows.push({ id: String(c?.id), status: FAIL, detail: `estado desconocido: ${String(c?.status)}` });
      else if (c.status === NP && c.data?.infra) rows.push({ ...c, status: FAIL, detail: `error de infraestructura (no es un límite previsto): ${c.detail}` });
      else rows.push(c);
    }
    for (const id of ids) if (!rep.checks.some((c) => c?.id === id)) r.add(`inventory.check.${name}.${id}`, FAIL, 'comprobación obligatoria ausente');
  }
  for (const [job, want] of Object.entries(JOB_EXPECTED)) { const got = env[envKey(job)]; r.add(`job.${job}.result`, got === want ? PASS : FAIL, `resultado del job: ${got ?? 'ausente'} (esperado ${want})`); }
  r.add('gate.run_when_action_matches', env.RESULT_GATE_RUN === 'success' ? PASS : FAIL, 'la puerta `if:` con la salida del controlador (run_claude) se ejecutó');
  r.add('gate.skip_when_action_differs', env.RESULT_GATE_SKIP === 'skipped' ? PASS : FAIL, 'la puerta `if:` con otro valor se omitió');
  const a = env.SWITCH_1; const b = env.SWITCH_2; const wait = Number(env.SWITCH_WAIT ?? 0);
  r.add('vars.evaluated_per_job', a && b && a !== b ? PASS : NP, a !== b ? `job 1 vio ${a}, job 2 vio ${b}: \`vars\` se resuelve por job` : wait > 0 ? `sin cambio durante la espera de ${wait}s (${a}): el Owner no lo modificó, no concluyente` : 'espera 0: no se intentó');
  const dg = parseArtifactDigest(env.ARTIFACT_DIGEST);
  r.add('artifact.digest_reported', dg ? PASS : FAIL, dg ? 'upload-artifact informó el digest (sha256 hex de 64 caracteres, sin prefijo); download-artifact lo verifica por defecto (digest-mismatch: error)' : 'upload-artifact no informó un digest válido (hex de 64 caracteres)');
  const all = [...rows, ...r.checks];
  const count = (st) => all.filter((c) => c.status === st).length;
  const md = ['| Comprobación | Estado | Detalle |', '|---|---|---|', ...all.map((c) => `| ${c.id} | ${c.status} | ${String(c.detail).replace(/\|/g, '/')} |`), '', `PASS ${count(PASS)} · FAIL ${count(FAIL)} · NO_PROBADO ${count(NP)}`].join('\n');
  return { report: r, rows: all, markdown: md, fail: count(FAIL) };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────────
async function main(argv, env) {
  const [cmd, ...rest] = argv; const out = env.REPORT_DIR ?? 'preflight-report'; const repository = env.GITHUB_REPOSITORY;
  const pr = Number(env.PR_NUMBER); if (['permissions', 'identity'].includes(cmd) && !(Number.isInteger(pr) && pr > 0 && pr < 1e7)) throw new Error('PR_NUMBER inválido');
  const api = makeFetchApi({ token: env.GITHUB_TOKEN });
  const gho = (kv) => env.GITHUB_OUTPUT && fs.appendFileSync(env.GITHUB_OUTPUT, Object.entries(kv).map(([k, v]) => `${k}=${v}\n`).join(''));
  let rep;
  switch (cmd) {
    case 'context': rep = cmdContext({ env }); break;
    case 'permissions': rep = await cmdPermissions({ api, repository, pr }); break;
    case 'identity': rep = await cmdIdentity({ api, repository, pr }); break;
    case 'pins': rep = cmdPins({ files: ['automation/preflight/candidate/actions-preflight.yml', '.github/workflows/actions-preflight.yml', 'automation/coordination/candidate/agent-handoff.yml'] }); break;
    case 'cli': rep = cmdCli({ env, actionDir: env.ACTION_DIR, installDir: env.INSTALL_DIR }); break;
    case 'env-a': rep = cmdEnvA({ env }); break;
    case 'env-b': rep = cmdEnvB({ env }); break;
    case 'controller': rep = cmdController({ env }); break;
    case 'integrity-produce': { const x = cmdIntegrityProduce({ outDir: env.OUT_DIR }); rep = x.report; gho({ sha256: x.sha256, bytes: x.bytes }); break; }
    case 'integrity-consume': rep = cmdIntegrityConsume({ dir: env.IN_DIR, expected: env.EXPECTED_SHA256 }); break;
    case 'wait': { const n = Number(env.WAIT ?? 0); if (!(Number.isInteger(n) && n >= 0 && n <= 300)) throw new Error('WAIT inválido (0..300)'); await new Promise((ok) => setTimeout(ok, n * 1000)); rep = new Report('wait').add('wait.done', PASS, `espera de ${n}s`); break; }
    case 'switch': { const x = cmdSwitch({ env, which: rest[0] }); rep = x.report; gho({ value: x.value }); break; }
    case 'summary': {
      const x = cmdSummary({ dir: out, env }); const text = writeReport({ name: 'summary', checks: x.rows }, out, env);
      assertNoSecrets(x.markdown, env); console.log(x.markdown); if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${x.markdown}\n`);
      void text; return x.fail ? 1 : 0;
    }
    default: throw new Error(`comando desconocido: ${cmd}`);
  }
  const text = writeReport(rep, out, env); assertNoSecrets(text, env);
  for (const c of rep.checks) console.log(`${c.status.padEnd(11)} ${c.id} — ${c.detail}`);
  return 0; // un FAIL queda en el informe; `summary` decide el resultado global (así todos los fragmentos se suben)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code), (e) => { console.error(`preflight: ${e.message}`); process.exit(2); });
}
