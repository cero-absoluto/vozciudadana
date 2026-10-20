// Fase B (#41): ¿llega un `@codex review` publicado por github-actions[bot] a Codex, y llega la respuesta de Codex a Actions como evento?
// PREPARACIÓN: este fichero no se ejecuta en ningún workflow activo. Sin token ni modelo de Claude, sin inferencia, sin red salvo la API de GitHub con GITHUB_TOKEN.
//  plan     — valida la PR sintética (solo lectura).           send    — revalida y publica UNA petición (único comando que escribe; sin reintentos).
//  receive  — receptor de eventos de Codex (solo lectura; trata el evento como DATOS; nunca ejecuta ni interpola texto de la PR).
//  observe  — lectura independiente por API de lo que Codex hizo (para distinguir «Codex respondió» de «el evento llegó a Actions»).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeFetchApi, loadPolicy, assertNoSecrets } from '../preflight/preflight.mjs';

export const SYNTH_FILE = 'automation/phaseb-synthetic/probe.txt';
export const SYNTH_BRANCH_PREFIX = 'phaseb/';
export const MAX_WAIT_MINUTES = 30; // una respuesta posterior a este margen no se correlaciona (parada, sin reintentos)
export const REQUEST_MARKER = 'phaseb-request:v1';
const REQUEST_RE = /<!-- phaseb-request:v1 sha=([0-9a-f]{40}) run=(\d+) attempt=1 -->/;
const RECEIPT_MARKER = 'codex-review-receipt:v1';
const COMMIT_RE = /\*\*Reviewed commit:\*\* `([0-9a-f]{7,40})`/;
const HEX40 = /^[0-9a-f]{40}$/;

const isUser = (u, who) => !!u && u.id === who.id && u.type === who.type && u.login === who.login;
export async function listAll(api, p, max = 5) { // paginación acotada (100 × max)
  const out = [];
  for (let page = 1; page <= max; page++) {
    const x = await api('GET', `${p}${p.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (x.status !== 200 || !Array.isArray(x.json)) throw new Error(`api_${x.status}:${p}`);
    out.push(...x.json); if (x.json.length < 100) break;
  }
  return out;
}
export const requestBody = (sha, runId) => `@codex review el commit exacto \`${sha}\`\n\n<!-- ${REQUEST_MARKER} sha=${sha} run=${runId} attempt=1 -->`;

/** Validación de la PR sintética (solo lectura). Devuelve todas las razones de rechazo. */
export async function plan({ api, repository, pr, expectedSha, env, policy = loadPolicy() }) {
  const reasons = []; const no = (id) => reasons.push(id);
  if (env.GITHUB_REF !== 'refs/heads/main') no('ref_not_main');
  if (env.GITHUB_RUN_ATTEMPT !== '1') no('rerun_not_allowed');
  if (!policy.owners.some((o) => String(o.id) === env.GITHUB_ACTOR_ID)) no('actor_not_owner');
  if (!HEX40.test(expectedSha ?? '')) no('bad_expected_sha');
  if (!(Number.isInteger(pr) && pr > 0 && pr < 1e7)) { no('bad_pr_number'); return { ok: false, reasons }; }
  const prRes = await api('GET', `/repos/${repository}/pulls/${pr}`); const P = prRes.json;
  if (prRes.status !== 200 || !P) { no('pr_unreadable'); return { ok: false, reasons }; }
  if (P.state !== 'open' || P.merged) no('pr_not_open');
  if (P.base?.ref !== policy.defaultBranch) no('base_not_main');
  if (P.head?.repo?.full_name !== repository || P.base?.repo?.full_name !== repository) no('fork_or_foreign_head');
  if (!String(P.head?.ref ?? '').startsWith(SYNTH_BRANCH_PREFIX)) no('head_branch_prefix');
  if (!policy.owners.some((o) => o.login === P.user?.login && o.id === P.user?.id)) no('pr_author_not_owner');
  if (P.head?.sha !== expectedSha) no('head_sha_mismatch');
  const files = await api('GET', `/repos/${repository}/pulls/${pr}/files?per_page=100`);
  const f = files.json;
  if (files.status !== 200 || !Array.isArray(f)) no('files_unreadable');
  else if (f.length !== 1 || f[0].filename !== SYNTH_FILE || f[0].status !== 'added' || f[0].previous_filename || (f[0].changes ?? 99) > 20) no('files_outside_synthetic_scope');
  const [comments, reviews, inline] = await Promise.all([listAll(api, `/repos/${repository}/issues/${pr}/comments`), listAll(api, `/repos/${repository}/pulls/${pr}/reviews`), listAll(api, `/repos/${repository}/pulls/${pr}/comments`)]);
  if (comments.some((c) => String(c.body ?? '').includes(REQUEST_MARKER))) no('request_already_exists');
  if (comments.some((c) => /@codex/i.test(String(c.body ?? '')))) no('codex_mention_present');
  if ([...comments, ...reviews, ...inline].some((x) => isUser(x.user, policy.auditor))) no('codex_activity_present');
  return { ok: reasons.length === 0, reasons, data: { head_sha: P.head?.sha, base_sha: P.base?.sha } };
}

/** Único comando que escribe: revalida y publica UNA petición. Sin reintentos: un 5xx o un fallo de red deja el estado «desconocido» para revisión manual. */
export async function send({ api, repository, pr, expectedSha, env, policy = loadPolicy() }) {
  const v = await plan({ api, repository, pr, expectedSha, env, policy });
  if (!v.ok) return { sent: false, state: 'refused', reasons: v.reasons };
  const runId = String(env.GITHUB_RUN_ID ?? ''); if (!/^\d+$/.test(runId)) return { sent: false, state: 'refused', reasons: ['bad_run_id'] };
  let res;
  try { res = await api('POST', `/repos/${repository}/issues/${pr}/comments`, { body: requestBody(expectedSha, runId) }); }
  catch (e) { return { sent: false, state: 'unknown', reasons: ['network_error_no_retry'], note: 'no se reintenta: comprobar a mano si el comentario existe' }; }
  if (res.status !== 201 || !res.json?.id) return { sent: false, state: res.status >= 500 ? 'unknown' : 'not_created', status: res.status, reasons: ['post_failed_no_retry'] };
  const rec = { sent: true, state: 'created', request_comment_id: res.json.id, request_node_id: res.json.node_id, request_created_at: res.json.created_at, head_sha: expectedSha, run_id: runId, pr };
  try { // identidad real del autor del comentario (el preflight dejó NO_PROBADO el comentario real de github-actions[bot])
    const g = await api('GET', `/repos/${repository}/issues/comments/${res.json.id}`);
    rec.author = g.json?.user ? { login: g.json.user.login, id: g.json.user.id, type: g.json.user.type } : null;
    rec.author_is_state_writer = isUser(g.json?.user, policy.stateWriter); rec.performed_via_github_app = g.json?.performed_via_github_app?.id ?? null;
  } catch { rec.author = null; rec.author_is_state_writer = null; }
  return rec;
}

/** Marca de la petición: exactamente un comentario válido de github-actions[bot] con el marcador. */
export function findRequest(comments, policy) {
  const cands = comments.filter((c) => String(c.body ?? '').includes(REQUEST_MARKER));
  const valid = cands.filter((c) => isUser(c.user, policy.stateWriter) && REQUEST_RE.test(c.body));
  if (cands.length === 0 || valid.length === 0) return { error: 'no_request_marker' };
  if (cands.length !== 1 || valid.length !== 1) return { error: 'ambiguous_request' };
  const m = REQUEST_RE.exec(valid[0].body); return { comment: valid[0], sha: m[1], run: m[2] };
}
const ts = (s) => Date.parse(s);
const kindOf = (name) => (name === 'issue_comment' ? 'comment' : name === 'pull_request_review' ? 'review' : null);

/** Filtro temprano y puro del evento (se repite aquí aunque el `if:` del workflow ya lo hace). */
export function filterEvent({ eventName, event, repository, activePr, policy = loadPolicy() }) {
  const k = kindOf(eventName); if (!k) return 'unsupported_event';
  if (event?.repository?.full_name !== repository) return 'wrong_repository';
  if (!/^\d+$/.test(String(activePr ?? ''))) return 'no_active_pilot';
  const num = k === 'comment' ? event.issue?.number : event.pull_request?.number;
  if (String(num) !== String(activePr)) return 'not_pilot_pr';
  if (k === 'comment' && !event.issue?.pull_request) return 'not_a_pull_request';
  const obj = k === 'comment' ? event.comment : event.review;
  if (!isUser(obj?.user, policy.auditor)) return 'wrong_actor';
  if (!isUser(event.sender, policy.auditor)) return 'wrong_sender';
  if (k === 'comment' && obj.performed_via_github_app && obj.performed_via_github_app.id !== policy.auditor.appId) return 'wrong_app';
  if (!['created', 'edited', 'submitted'].includes(event.action)) return 'unsupported_action';
  return null;
}
const codexCommentOk = (c, sha) => { const m = COMMIT_RE.exec(String(c.body ?? '')); return String(c.body ?? '').includes(RECEIPT_MARKER) && !!m && sha.startsWith(m[1]); };

/** Receptor. Solo lectura; el evento se trata como datos. Clasifica sin afirmar éxito salvo correlación completa. */
export async function receive({ api, eventName, event, repository, activePr, env, policy = loadPolicy() }) {
  const base = { event_name: eventName, action: event?.action ?? null, run_id: String(env.GITHUB_RUN_ID ?? '') };
  const early = filterEvent({ eventName, event, repository, activePr, policy }); if (early) return { ...base, classification: 'IGNORED', reason: early };
  const k = kindOf(eventName); const obj = k === 'comment' ? event.comment : event.review; const pr = Number(activePr);
  const eventTime = k === 'comment' ? obj.created_at : obj.submitted_at; const rec = { ...base, kind: k, event_id: obj.id, event_node_id: obj.node_id ?? null, event_time: eventTime, pr };
  const [prRes, files, comments, reviews] = await Promise.all([api('GET', `/repos/${repository}/pulls/${pr}`), api('GET', `/repos/${repository}/pulls/${pr}/files?per_page=100`), listAll(api, `/repos/${repository}/issues/${pr}/comments`), listAll(api, `/repos/${repository}/pulls/${pr}/reviews`)]);
  const un = (reason) => ({ ...rec, classification: 'UNCORRELATED', reason });
  if (prRes.status !== 200) throw new Error(`api_${prRes.status}:pr`);
  const f = files.json; if (files.status !== 200 || !Array.isArray(f) || f.length !== 1 || f[0].filename !== SYNTH_FILE) return un('unsafe_pr_content');
  const req = findRequest(comments, policy); if (req.error) return un(req.error);
  Object.assign(rec, { request_comment_id: req.comment.id, request_created_at: req.comment.created_at, head_sha: req.sha, request_run_id: req.run });
  if (prRes.json.head?.sha !== req.sha) return un('pr_changed');
  if (prRes.json.state !== 'open') return un('pr_closed');
  if (!(ts(eventTime) > ts(req.comment.created_at))) return un('preexisting_before_request');
  const delta = (ts(eventTime) - ts(req.comment.created_at)) / 1000; rec.seconds_after_request = delta;
  if (delta > MAX_WAIT_MINUTES * 60) return un('expired');
  if (k === 'review') { if (obj.commit_id !== req.sha) return un('wrong_commit'); }
  else { if (!String(obj.body ?? '').includes(RECEIPT_MARKER)) return un('not_a_receipt'); if (!COMMIT_RE.test(obj.body)) return un('no_commit_in_comment'); if (!codexCommentOk(obj, req.sha)) return un('wrong_commit'); }
  // deduplicación: solo el primer evento correlacionado cuenta como éxito
  const matches = [
    ...comments.filter((c) => isUser(c.user, policy.auditor) && codexCommentOk(c, req.sha) && ts(c.created_at) > ts(req.comment.created_at)).map((c) => ({ kind: 'comment', id: c.id, t: ts(c.created_at) })),
    ...reviews.filter((r) => isUser(r.user, policy.auditor) && r.commit_id === req.sha && ts(r.submitted_at) > ts(req.comment.created_at)).map((r) => ({ kind: 'review', id: r.id, t: ts(r.submitted_at) })),
  ].sort((a, b) => a.t - b.t || a.id - b.id);
  const first = matches[0]; rec.first_match = first ? { kind: first.kind, id: first.id } : null;
  if (!first || first.kind !== k || first.id !== obj.id) return { ...rec, classification: 'DUPLICATE', reason: 'not_first_correlated_event' };
  return { ...rec, classification: event.action === 'edited' ? 'RECEIVED_EDIT' : 'RECEIVED_OK', reason: null };
}

/** Lectura independiente: qué hizo Codex según la API, con o sin evento recibido. */
export async function observe({ api, repository, pr, policy = loadPolicy() }) {
  const [comments, reviews, inline, reactions] = await Promise.all([listAll(api, `/repos/${repository}/issues/${pr}/comments`), listAll(api, `/repos/${repository}/pulls/${pr}/reviews`), listAll(api, `/repos/${repository}/pulls/${pr}/comments`), listAll(api, `/repos/${repository}/issues/${pr}/reactions`)]);
  const req = findRequest(comments, policy); const out = { pr, request: req.error ? { error: req.error } : { comment_id: req.comment.id, created_at: req.comment.created_at, sha: req.sha, run: req.run }, codex: [] };
  if (req.error) return { ...out, api_visible_response: false, interpretation: 'sin petición válida: no hay nada que correlacionar' };
  const after = (t) => ts(t) > ts(req.comment.created_at);
  for (const c of comments) if (isUser(c.user, policy.auditor) && after(c.created_at)) out.codex.push({ kind: 'comment', id: c.id, at: c.created_at, commit: COMMIT_RE.exec(c.body ?? '')?.[1] ?? null, exact_commit: codexCommentOk(c, req.sha) });
  for (const r of reviews) if (isUser(r.user, policy.auditor) && after(r.submitted_at)) out.codex.push({ kind: 'review', id: r.id, at: r.submitted_at, commit: r.commit_id?.slice(0, 10) ?? null, exact_commit: r.commit_id === req.sha });
  for (const c of inline) if (isUser(c.user, policy.auditor) && after(c.created_at)) out.codex.push({ kind: 'inline', id: c.id, at: c.created_at, commit: c.commit_id?.slice(0, 10) ?? null, exact_commit: c.commit_id === req.sha });
  for (const x of reactions) if (isUser(x.user, policy.auditor) && after(x.created_at)) out.codex.push({ kind: 'reaction', id: x.id, at: x.created_at, content: x.content, exact_commit: null });
  const real = out.codex.filter((e) => e.kind !== 'reaction' && e.exact_commit);
  out.api_visible_response = real.length > 0; out.reaction_only = real.length === 0 && out.codex.some((e) => e.kind === 'reaction');
  out.interpretation = out.api_visible_response ? 'Codex respondió con el commit exacto (visible por API); comparar con los registros de receive para saber si el evento llegó a Actions'
    : out.reaction_only ? 'solo reacción de Codex (no genera evento de Actions): respuesta parcial, sin recibo ni review con el commit exacto'
    : 'sin respuesta de Codex tras la petición en la ventana observada: no demuestra que no vaya a llegar; no se infiere entrega';
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────
function writeJson(name, obj, env) {
  const dir = env.REPORT_DIR ?? 'phaseb-out'; const text = JSON.stringify(obj, null, 2); assertNoSecrets(text, env);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), text);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `### ${name}\n\n\`\`\`json\n${text}\n\`\`\`\n`);
  console.log(text);
}
async function main(argv, env) {
  const [cmd] = argv; const repository = env.GITHUB_REPOSITORY; const policy = loadPolicy(); const api = makeFetchApi({ token: env.GITHUB_TOKEN });
  if (repository !== policy.repository) throw new Error('repositorio distinto del de la política');
  if (cmd === 'plan' || cmd === 'send') {
    const args = { api, repository, pr: Number(env.PR_NUMBER), expectedSha: env.EXPECTED_HEAD_SHA, env, policy };
    if (cmd === 'plan') { const r = await plan(args); writeJson('phaseb-plan.json', r, env); return r.ok ? 0 : 1; }
    const r = await send(args); writeJson('phaseb-send.json', r, env); return r.sent ? 0 : 1;
  }
  if (cmd === 'receive') {
    const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    const r = await receive({ api, eventName: env.EVENT_NAME, event, repository, activePr: env.PHASEB_PR, env, policy });
    writeJson(`phaseb-receive-${r.event_id ?? 'ignored'}-${r.classification}.json`, r, env); return 0;
  }
  if (cmd === 'observe') {
    if (!policy.owners.some((o) => String(o.id) === env.GITHUB_ACTOR_ID)) throw new Error('observe solo para el Owner');
    const r = await observe({ api, repository, pr: Number(env.PR_NUMBER), policy }); writeJson('phaseb-observe.json', r, env); return 0;
  }
  throw new Error(`comando desconocido: ${cmd}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((c) => process.exit(c), (e) => { console.error(`phaseb: ${e.message}`); process.exit(2); });
}
