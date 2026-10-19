// Código de CONFIANZA del job `publish`: valida el parche del modelo, lo aplica sobre el HEAD esperado y empuja
// la rama del PR con un token que el modelo nunca recibe. No ejecuta código del PR (ni npm, ni tests, ni hooks).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decideAfterClaude, mayPublish, pickState, validatePatch } from './controller.mjs';
import { collectFacts, persistState, loadPolicy, blockedNotice } from './gather.mjs';
import { makeApi } from './github.mjs';

const git = (dir, args, env) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' } });

/** Aplica el parche sobre `headSha` y empuja a `headRef` sin forzar. Devuelve { ok, newHead } o { ok:false, reason }. */
export function applyPatchAndPush({ repoDir, headSha, headRef, patch, round, remote = 'origin', env = {} }) {
  const run = (...a) => git(repoDir, a, env);
  if (run('cat-file', '-e', `${headSha}^{commit}`).status !== 0) return { ok: false, reason: 'head_not_fetched' };
  if (run('checkout', '-q', '--detach', headSha).status !== 0) return { ok: false, reason: 'checkout_failed' };
  const patchFile = `${repoDir}/.handoff.patch`;
  fs.writeFileSync(patchFile, patch);
  try {
    if (run('apply', '--check', '--index', '--whitespace=nowarn', patchFile).status !== 0) return { ok: false, reason: 'patch_does_not_apply' };
    if (run('apply', '--index', '--whitespace=nowarn', patchFile).status !== 0) return { ok: false, reason: 'patch_apply_failed' };
  } finally { fs.rmSync(patchFile, { force: true }); }
  const msg = `agent-handoff: correction round ${round} of Codex findings\n\nApplied by the trusted publisher from a validated patch; no merge, no deployment.`;
  const c = run('-c', 'user.name=agent-handoff[bot]', '-c', 'user.email=agent-handoff@users.noreply.github.com', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', msg);
  if (c.status !== 0) return { ok: false, reason: 'commit_failed' };
  const newHead = run('rev-parse', 'HEAD').stdout.trim();
  const p = run('-c', 'core.hooksPath=/dev/null', 'push', '--no-verify', remote, `HEAD:refs/heads/${headRef}`);
  if (p.status !== 0) return { ok: false, reason: 'push_rejected' };
  return { ok: true, newHead };
}

export async function publishRound({ api, policy, repository, number, round, claudeResult, patch, repoDir, pushEnv = {}, requestReview = true, switchEnabled = process.env.AGENT_HANDOFF_ENABLED }) {
  const facts = await collectFacts({ api, policy, repository, event: { issue: { number, pull_request: {} } }, switchEnabled, force: true });
  const { state, commentId } = pickState(facts.stateComments, policy);
  let outcome; let newHead;
  if (!facts.pr || !mayPublish(state, facts, policy, round)) outcome = 'stale';
  else if (claudeResult !== 'success') outcome = claudeResult === 'cancelled' ? 'timeout' : 'failure';
  else {
    const v = validatePatch(patch ?? '', policy);
    if (!v.ok) outcome = v.reason === 'empty_patch' ? 'no_changes' : 'rejected_patch';
    else {
      const r = applyPatchAndPush({ repoDir, headSha: facts.pr.headSha, headRef: facts.pr.headRef, patch, round, env: pushEnv });
      if (r.ok) { outcome = 'pushed'; newHead = r.newHead; } else outcome = r.reason;
    }
  }
  const next = decideAfterClaude(state, { round, outcome, newHead }, policy);
  if (next.state) await persistState({ api, repository, number, commentId, state: next.state });
  if (next.action.type === 'blocked') await api.request('POST', `/repos/${repository}/issues/${number}/comments`, { body: blockedNotice(next.action.reason) });
  if (next.action.type === 'request_review' && requestReview) await api.request('POST', `/repos/${repository}/issues/${number}/comments`, { body: '@codex review' });
  return { outcome, next };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const e = process.env;
  const token = e.GITHUB_TOKEN;
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
  publishRound({
    api: makeApi({ token }), policy: loadPolicy(), repository: e.GITHUB_REPOSITORY, number: Number(e.PR_NUMBER), round: Number(e.ROUND),
    claudeResult: e.CLAUDE_RESULT, patch: fs.existsSync(e.PATCH_PATH ?? '') ? fs.readFileSync(e.PATCH_PATH, 'utf8') : '', repoDir: e.REPO_DIR,
    pushEnv: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${auth}` },
  }).then((r) => console.log(JSON.stringify({ outcome: r.outcome, action: r.next.action.type }))).catch((err) => { console.error(`publish: ${err.message}`); process.exit(1); });
}
