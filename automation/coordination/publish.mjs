// Código de CONFIANZA del job `publish`: valida el parche del modelo, lo aplica sobre el HEAD esperado y empuja
// la rama del PR con un token que el modelo nunca recibe. No ejecuta código del PR (ni npm, ni tests, ni hooks).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { decideAfterClaude, mayPublish, ownerStopped, pickState, validatePatch, checkPaths, STATUS } from './controller.mjs';
import { collectFacts, persistState, loadPolicy, blockedNotice, NOTICE_STOPPED, NOTICE_SWITCH_OFF } from './gather.mjs';
import { makeApi } from './github.mjs';

const git = (dir, args, env) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' } });

/** Aplica el parche sobre `headSha` y empuja a `headRef` sin forzar. Devuelve { ok, newHead } o { ok:false, reason }. */
export function applyPatchAndPush({ repoDir, headSha, headRef, patch, round, policy, remote = 'origin', env = {} }) {
  if (!policy) return { ok: false, reason: 'policy_required' }; // fail-closed: sin política no se aplica nada
  const run = (...a) => git(repoDir, a, env);
  if (run('cat-file', '-e', `${headSha}^{commit}`).status !== 0) return { ok: false, reason: 'head_not_fetched' };
  if (run('checkout', '-q', '--detach', headSha).status !== 0) return { ok: false, reason: 'checkout_failed' };
  const patchFile = `${repoDir}/.handoff.patch`;
  fs.writeFileSync(patchFile, patch);
  try {
    if (run('apply', '--check', '--index', '--whitespace=nowarn', patchFile).status !== 0) return { ok: false, reason: 'patch_does_not_apply' };
    if (run('apply', '--index', '--whitespace=nowarn', patchFile).status !== 0) return { ok: false, reason: 'patch_apply_failed' };
  } finally { fs.rmSync(patchFile, { force: true }); }
  // Segunda capa (verdad de terreno): las rutas que git ha modificado DE VERDAD en el índice deben cumplir la política, aunque el
  // analizador del parche hubiera aprobado otra cosa. Si no, se deshace y no se confirma ni empuja nada.
  const changed = run('diff', '--cached', '--name-only', '-z', '--no-renames', 'HEAD');
  const files = changed.status === 0 ? changed.stdout.split('\0').filter(Boolean) : [];
  const verdict = checkPaths(files, policy);
  if (!verdict.ok) { run('reset', '-q', '--hard', headSha); run('clean', '-fdq'); return { ok: false, reason: 'applied_paths_outside_policy' }; }
  const msg = `agent-handoff: correction round ${round} of Codex findings\n\nApplied by the trusted publisher from a validated patch; no merge, no deployment.`;
  const c = run('-c', 'user.name=agent-handoff[bot]', '-c', 'user.email=agent-handoff@users.noreply.github.com', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', msg);
  if (c.status !== 0) return { ok: false, reason: 'commit_failed' };
  const newHead = run('rev-parse', 'HEAD').stdout.trim();
  const p = run('-c', 'core.hooksPath=/dev/null', 'push', '--no-verify', remote, `HEAD:refs/heads/${headRef}`);
  if (p.status !== 0) return { ok: false, reason: 'push_rejected' };
  return { ok: true, newHead };
}

/** Recorre un árbol (sin seguir symlinks, sin `.git` en la raíz). Devuelve rutas relativas o null si hay symlinks/ficheros especiales. */
function walkTree(root) {
  const out = [];
  const rec = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!rel && e.name === '.git') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) return false;
      if (e.isDirectory()) { if (rec(path.join(dir, e.name), r) === false) return false; } else if (e.isFile()) out.push(r); else return false;
    }
    return true;
  };
  return rec(root, '') === false ? null : out;
}

/**
 * Construye el parche con CÓDIGO DE CONFIANZA a partir de la copia de trabajo que dejó el modelo (artefacto de datos),
 * sin ejecutar git dentro del directorio del modelo: se copia sobre un checkout limpio del HEAD y se hace `git add -A`
 * (incluye ficheros nuevos) con configuración neutra. Valida con las listas de rutas. Solo lee/escribe repoDir.
 */
export function buildPatchFromTree({ repoDir, treeDir, policy }) {
  const g = (...a) => spawnSync('git', ['-C', repoDir, '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fileMode=false', '-c', 'core.autocrlf=false', '-c', 'core.attributesFile=/dev/null', ...a],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' } });
  const files = walkTree(treeDir);
  if (!files) return { ok: false, reason: 'symlink_or_special_in_tree' };
  const wanted = new Set(files);
  const tracked = g('ls-files', '-z');
  if (tracked.status !== 0) return { ok: false, reason: 'ls_files_failed' };
  for (const f of tracked.stdout.split('\0').filter(Boolean)) if (!wanted.has(f)) fs.rmSync(path.join(repoDir, f), { force: true });
  for (const f of files) {
    const src = path.join(treeDir, f); const dst = path.join(repoDir, f);
    if (fs.existsSync(dst) && fs.lstatSync(dst).isFile() && fs.readFileSync(dst).equals(fs.readFileSync(src))) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst);
  }
  if (g('add', '-A').status !== 0) return { ok: false, reason: 'add_failed' };
  const d = g('diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', '--no-renames', 'HEAD');
  if (d.status !== 0) return { ok: false, reason: 'diff_failed' };
  const v = validatePatch(d.stdout, policy);
  return v.ok ? { ok: true, patch: d.stdout, paths: v.paths } : { ok: false, reason: v.reason, path: v.path };
}

export const sha256 = (text) => crypto.createHash('sha256').update(text ?? '').digest('hex');

/** Cierra con fail-closed: sin `patchStatus` ni huella esperada no se publica nada. */
export async function publishRound({ api, policy, repository, number, round, claudeResult, verifyResult = 'missing', patchStatus = { ok: false, reason: 'missing' }, expectedPatchSha256 = null, patch, repoDir, pushEnv = {}, requestReview = true, switchEnabled = process.env.AGENT_HANDOFF_ENABLED }) {
  const facts = await collectFacts({ api, policy, repository, event: { issue: { number, pull_request: {} } }, switchEnabled, force: true });
  const { state, commentId } = pickState(facts.stateComments, policy);
  let outcome; let newHead;
  // Parada del Owner publicada mientras la ronda corría (aunque su ejecución siga en cola), o interruptor global apagado
  // tras empezar: se respeta antes de cualquier push y se deja un estado terminal reanudable (STOPPED; `/handoff enable`
  // lo reactiva), nunca CORRECTING colgado.
  if (facts.pr && state && state !== 'corrupt' && state.status === STATUS.CORRECTING && state.rounds === round) {
    const byOwner = ownerStopped(facts, policy);
    if (byOwner || facts.switch.enabled !== true) {
      await persistState({ api, repository, number, commentId, state: { ...state, status: STATUS.STOPPED, reason: byOwner ? 'stopped by owner during correction' : 'aborted: global switch off during correction' } });
      await api.request('POST', `/repos/${repository}/issues/${number}/comments`, { body: byOwner ? NOTICE_STOPPED : NOTICE_SWITCH_OFF });
      return { outcome: 'stopped', next: { action: { type: 'none', reason: byOwner ? 'stopped_by_owner' : 'switch_off' } } };
    }
  }
  if (!facts.pr || !mayPublish(state, facts, policy, round)) outcome = 'stale';
  else if (claudeResult !== 'success') outcome = claudeResult === 'cancelled' ? 'timeout' : 'failure';
  else if (!patchStatus?.ok) outcome = patchStatus?.reason === 'empty_patch' ? 'no_changes' : 'rejected_patch';
  else if (verifyResult !== 'success') outcome = 'verification_failed';
  // Integridad: el parche que se publica debe ser EXACTAMENTE el que construyó el job de confianza (y que `verify` probó),
  // no uno que el código del PR haya podido reescribir mientras se ejecutaban sus pruebas.
  else if (!/^[0-9a-f]{64}$/.test(expectedPatchSha256 ?? '') || sha256(patch) !== expectedPatchSha256) outcome = 'patch_integrity';
  else {
    const v = validatePatch(patch ?? '', policy);
    if (!v.ok) outcome = v.reason === 'empty_patch' ? 'no_changes' : 'rejected_patch';
    else {
      const r = applyPatchAndPush({ repoDir, headSha: facts.pr.headSha, headRef: facts.pr.headRef, patch, round, policy, env: pushEnv });
      if (r.ok) { outcome = 'pushed'; newHead = r.newHead; } else outcome = r.reason;
    }
  }
  const next = decideAfterClaude(state, { round, outcome, newHead }, policy);
  if (next.state) await persistState({ api, repository, number, commentId, state: next.state });
  if (next.action.type === 'blocked') await api.request('POST', `/repos/${repository}/issues/${number}/comments`, { body: blockedNotice(next.action.reason) });
  if (next.action.type === 'request_review' && requestReview) await api.request('POST', `/repos/${repository}/issues/${number}/comments`, { body: '@codex review' });
  return { outcome, next };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv[2] === 'build-patch') {
  const e = process.env;
  const r = buildPatchFromTree({ repoDir: e.REPO_DIR, treeDir: e.TREE_DIR, policy: loadPolicy() });
  if (r.ok) fs.writeFileSync(e.PATCH_OUT, r.patch);
  const out = { ok: r.ok, reason: r.reason ?? '', sha256: r.ok ? sha256(r.patch) : '' };
  if (e.GITHUB_OUTPUT) fs.appendFileSync(e.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${String(v).replace(/[\r\n]/g, ' ')}\n`).join(''));
  console.log(JSON.stringify({ ...out, paths: r.paths ?? null }));
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv[2] === 'check-patch') {
  const e = process.env;
  const ok = fs.existsSync(e.PATCH_PATH ?? '') && sha256(fs.readFileSync(e.PATCH_PATH, 'utf8')) === e.EXPECTED_SHA256 && /^[0-9a-f]{64}$/.test(e.EXPECTED_SHA256 ?? '');
  console.log(JSON.stringify({ patch_integrity: ok })); process.exit(ok ? 0 : 1);
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const e = process.env;
  const token = e.GITHUB_TOKEN;
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
  publishRound({
    api: makeApi({ token }), policy: loadPolicy(), repository: e.GITHUB_REPOSITORY, number: Number(e.PR_NUMBER), round: Number(e.ROUND),
    claudeResult: e.CLAUDE_RESULT, verifyResult: e.VERIFY_RESULT ?? 'missing',
    patchStatus: { ok: e.PATCH_OK === 'true', reason: e.PATCH_REASON ?? '' }, expectedPatchSha256: e.EXPECTED_PATCH_SHA256 ?? null, patch: fs.existsSync(e.PATCH_PATH ?? '') ? fs.readFileSync(e.PATCH_PATH, 'utf8') : '', repoDir: e.REPO_DIR,
    pushEnv: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}` },
  }).then((r) => console.log(JSON.stringify({ outcome: r.outcome, action: r.next.action.type }))).catch((err) => { console.error(`publish: ${err.message}`); process.exit(1); });
}
