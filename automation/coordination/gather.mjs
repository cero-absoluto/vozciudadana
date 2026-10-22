// Código de CONFIANZA del job `decide` (se ejecuta desde la rama por defecto, nunca desde el PR).
// Recoge hechos de la API, llama al controlador puro, persiste el estado y escribe las salidas del job.
// No ejecuta nada procedente del PR, de comentarios ni de la salida del modelo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, encodeState, pickState, FINDING_MARKER, RECEIPT_MARKER, STATE_MARKER } from './controller.mjs';
import { makeApi } from './github.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const loadPolicy = () => JSON.parse(fs.readFileSync(path.join(here, 'policy.json'), 'utf8'));

const user = (u) => ({ login: u?.login ?? null, id: u?.id ?? null, type: u?.type ?? null });
const stripMarkup = (t) => String(t ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+\n/g, '\n').trim();

export async function collectFacts({ api, policy, repository, event, switchEnabled, force = false }) {
  const issue = event.issue ?? null;
  const number = event.issue?.number ?? event.pull_request?.number ?? null;
  const base = { repository, switch: { enabled: switchEnabled === 'true' }, event: null, pr: null, stateComments: [], auditor: { reviews: [], receipts: [] }, actorPermission: null };
  if (!number) return base;
  const comment = event.comment ?? null;
  base.event = {
    name: event.comment ? 'issue_comment' : 'other', action: event.action ?? null, isPullRequest: !!issue?.pull_request,
    actor: user(comment?.user), commentId: comment?.id ?? null, body: comment?.body ?? '',
  };
  // Filtro barato: solo órdenes del Owner o comentarios del auditor despiertan trabajo real.
  const looksCommand = Object.values(policy.commands).includes(String(base.event.body).split('\n')[0].trim());
  const fromAuditor = base.event.actor.id === policy.auditor.id;
  if (!force && (!base.event.isPullRequest || (!looksCommand && !fromAuditor))) return { ...base, pr: null, skipped: 'event_not_relevant' };

  const pr = await api.request('GET', `/repos/${repository}/pulls/${number}`);
  base.pr = {
    number, state: pr.state, draft: !!pr.draft, merged: !!pr.merged, headSha: pr.head?.sha, headRef: pr.head?.ref,
    headRepo: pr.head?.repo?.full_name ?? null, baseRepo: pr.base?.repo?.full_name ?? null, baseRef: pr.base?.ref, isFork: !!pr.head?.repo?.fork && pr.head.repo.full_name !== repository,
  };
  const comments = await api.paginate(`/repos/${repository}/issues/${number}/comments`);
  // Órdenes del Owner ya publicadas (incluidas las que aún esperan en la cola de concurrencia): solo identidad y orden exacta.
  const cmdOf = (c) => { const l = String(c.body ?? '').split('\n')[0].trim(); return l === policy.commands.stop ? 'stop' : l === policy.commands.enable ? 'enable' : null; };
  base.ownerCommands = comments.filter((c) => cmdOf(c) && policy.owners.some((o) => o.id === c.user?.id))
    .map((c) => ({ id: c.id, cmd: cmdOf(c), author: user(c.user) }));
  base.stateComments = comments.filter((c) => (c.body ?? '').includes(STATE_MARKER))
    .map((c) => ({ id: c.id, authorId: c.user?.id, authorType: c.user?.type, authorLogin: c.user?.login, body: c.body }));
  base.auditor.receipts = comments.filter((c) => (c.body ?? '').includes(RECEIPT_MARKER))
    .map((c) => ({ id: c.id, userId: c.user?.id, userType: c.user?.type, userLogin: c.user?.login, appId: c.performed_via_github_app?.id ?? null, body: c.body }));
  const reviews = await api.paginate(`/repos/${repository}/pulls/${number}/reviews`);
  for (const r of reviews) {
    if (r.user?.id !== policy.auditor.id) continue; // solo se leen comentarios inline de reseñas del auditor real
    const inline = await api.paginate(`/repos/${repository}/pulls/${number}/reviews/${r.id}/comments`);
    const findings = inline.filter((c) => (c.body ?? '').includes(FINDING_MARKER))
      .map((c) => ({ path: c.path, line: c.line ?? c.original_line ?? null, text: stripMarkup(c.body) }));
    base.auditor.reviews.push({ id: r.id, userId: r.user.id, userType: r.user.type, userLogin: r.user.login, commitId: r.commit_id, state: r.state, findingCount: findings.length, findings });
  }
  if (looksCommand) {
    const p = await api.request('GET', `/repos/${repository}/collaborators/${encodeURIComponent(base.event.actor.login)}/permission`).catch(() => null);
    base.actorPermission = p?.permission ?? null;
  }
  return base;
}

export async function persistState({ api, repository, number, commentId, state }) {
  const body = encodeState(state);
  if (commentId) await api.request('PATCH', `/repos/${repository}/issues/comments/${commentId}`, { body });
  else await api.request('POST', `/repos/${repository}/issues/${number}/comments`, { body });
}

export const NOTICE_SWITCH_OFF = 'Relevo automático detenido: el interruptor global se apagó durante la corrección. No se empuja ningún cambio; `/handoff enable` del Owner lo reanuda cuando el interruptor vuelva a estar activo.';
export const NOTICE_STOPPED = 'Relevo automático detenido por el Owner durante la corrección. No se empuja ningún cambio.';
const NOTICE = {
  enabled: 'Relevo automático habilitado para este PR por el Owner. Esperando revisión de Codex sobre el HEAD actual.',
  rebaselined: 'Relevo automático: HEAD reajustado por el Owner. Esperando revisión de Codex sobre el HEAD actual.',
  stopped: 'Relevo automático detenido por el Owner. No se lanzará ninguna ejecución nueva.',
  owner_review: 'OWNER_REVIEW: Codex no encontró hallazgos sobre el HEAD actual. Decide el Owner; no se fusiona ni se despliega nada automáticamente.',
};
export const blockedNotice = (reason) => `BLOCKED: ${reason}. El relevo se detiene; decide el Owner. No se fusiona ni se despliega nada automáticamente.`;

export async function main(env = process.env, deps = {}) {
  const policy = deps.policy ?? loadPolicy();
  const api = deps.api ?? makeApi({ token: env.GITHUB_TOKEN });
  const repository = env.GITHUB_REPOSITORY;
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const facts = await collectFacts({ api, policy, repository, event, switchEnabled: env.AGENT_HANDOFF_ENABLED });
  const result = facts.skipped ? { state: null, action: { type: 'none', reason: facts.skipped } } : decide(facts, policy);
  const { commentId } = pickState(facts.stateComments, policy);
  const before = pickState(facts.stateComments, policy).state;
  const changed = result.state && JSON.stringify(result.state) !== JSON.stringify(before === 'corrupt' ? null : before);
  if (changed) await persistState({ api, repository, number: facts.pr.number, commentId, state: result.state });
  const a = result.action;
  if (a.type === 'notify') await api.request('POST', `/repos/${repository}/issues/${facts.pr.number}/comments`, { body: NOTICE[a.kind] });
  if (a.type === 'blocked') await api.request('POST', `/repos/${repository}/issues/${facts.pr.number}/comments`, { body: blockedNotice(a.reason) });
  const out = { action: a.type, reason: a.reason ?? a.kind ?? '', round: a.round ?? '', head: a.head ?? '', pr: facts.pr?.number ?? '', head_ref: facts.pr?.headRef ?? '' };
  if (a.type === 'run_claude') fs.writeFileSync(env.FINDINGS_PATH ?? 'findings.json', JSON.stringify({ round: a.round, head: a.head, findings: a.findings }, null, 2));
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, Object.entries(out).map(([k, v]) => `${k}=${String(v).replace(/[\r\n]/g, ' ')}\n`).join(''));
  console.log(JSON.stringify({ decision: out }));
  return { facts, result, out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`gather: ${e.message}`); process.exit(1); });
}
