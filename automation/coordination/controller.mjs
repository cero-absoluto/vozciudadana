// Controlador PURO del relevo Claude ⇄ Codex (sin red, sin shell, sin git, sin modelos).
// Recibe HECHOS ya recogidos por código de confianza (gather.mjs) y la política (policy.json, de la rama por
// defecto) y devuelve el nuevo estado y UNA acción. Todo lo que viene de comentarios/PR/modelo es dato no fiable:
// aquí solo se compara con identidades y SHAs; nada se ejecuta ni se interpreta como orden.
//
// Estados: AWAITING_REVIEW → (hallazgos) CORRECTING → AWAITING_REVIEW …  → OWNER_REVIEW | BLOCKED | STOPPED.
// Reutiliza de la PR #23 (protocolo offline): revisión obsoleta rechazada, límite de dos correcciones, parada en
// OWNER_REVIEW, sin merge. Añade identidad real (id/tipo/app), SHA de HEAD, deduplicación y contador persistente.

export const STATUS = Object.freeze({
  AWAITING_REVIEW: 'AWAITING_REVIEW', CORRECTING: 'CORRECTING', OWNER_REVIEW: 'OWNER_REVIEW', BLOCKED: 'BLOCKED', STOPPED: 'STOPPED',
});
const TERMINAL = new Set([STATUS.OWNER_REVIEW, STATUS.BLOCKED]);
const SHA = /^[0-9a-f]{40}$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/;
export const STATE_MARKER = 'agent-handoff-state:v1';
export const FINDING_MARKER = 'codex-code-review-finding:v1';
export const RECEIPT_MARKER = 'codex-review-receipt:v1';

export const none = (reason, state) => ({ state, action: { type: 'none', reason } });

// ── estado persistente (comentario del PR escrito por github-actions[bot]) ───────────────────────────────
export function encodeState(s) {
  return `<!-- ${STATE_MARKER} ${JSON.stringify(s)} -->\nEstado del relevo automático: **${s.status}** · rondas de corrección usadas: ${s.rounds}/${s.maxRounds}${s.reason ? ` · ${s.reason}` : ''}`;
}
export function decodeState(body) {
  if (typeof body !== 'string') return null;
  const m = new RegExp(`<!-- ${STATE_MARKER} (\\{.*?\\}) -->`, 's').exec(body);
  if (!m) return null;
  let s;
  try { s = JSON.parse(m[1]); } catch { return null; }
  const ok = s && s.v === 1 && Object.values(STATUS).includes(s.status) && Number.isInteger(s.rounds) && s.rounds >= 0
    && Number.isInteger(s.maxRounds) && SHA.test(s.head ?? '') && Number.isInteger(s.pr) && Array.isArray(s.handled)
    && s.handled.every((x) => typeof x === 'string');
  return ok ? s : null;
}
/** Elige el estado AUTÉNTICO: comentario del escritor de estado de la política (id+tipo+login). Varios → el de menor id. */
export function pickState(stateComments, policy) {
  const w = policy.stateWriter;
  const authentic = (stateComments ?? []).filter((c) => c.authorId === w.id && c.authorType === w.type && c.authorLogin === w.login && typeof c.body === 'string' && c.body.includes(STATE_MARKER));
  authentic.sort((a, b) => a.id - b.id);
  if (!authentic.length) return { state: null, commentId: null };
  const state = decodeState(authentic[0].body);
  return state ? { state, commentId: authentic[0].id } : { state: 'corrupt', commentId: authentic[0].id };
}

const isOwner = (actor, perm, policy) => actor && actor.type === 'User'
  && policy.owners.some((o) => o.id === actor.id && o.login === actor.login && o.type === actor.type) && (perm === 'admin' || perm === 'write');
const isAuditor = (u, policy) => u && u.userId === policy.auditor.id && u.userType === policy.auditor.type && u.userLogin === policy.auditor.login;

/** Rechazos previos a cualquier decisión: repo, forks, PR cerrada, referencias ambiguas. */
export function precheck(facts, policy) {
  const { pr, repository } = facts;
  if (repository !== policy.repository) return 'wrong_repository';
  if (!pr || pr.state !== 'open' || pr.merged) return 'pr_not_open';
  if (pr.baseRepo !== policy.repository || pr.headRepo !== policy.repository || pr.isFork) return 'fork_or_foreign_head';
  if (!SHA.test(pr.headSha ?? '')) return 'ambiguous_head_sha';
  if (typeof pr.headRef !== 'string' || !SAFE_REF.test(pr.headRef) || pr.headRef.includes('..') || pr.headRef.endsWith('/') || pr.headRef.endsWith('.lock')) return 'ambiguous_head_ref';
  if (pr.baseRef !== policy.defaultBranch) return 'base_is_not_default_branch';
  return null;
}

const withHandled = (s, ids, policy) => ({ ...s, handled: [...s.handled, ...ids].slice(-policy.limits.maxHandled) });
const newState = (facts, policy, over = {}) => ({ v: 1, pr: facts.pr.number, status: STATUS.AWAITING_REVIEW, head: facts.pr.headSha, rounds: 0, maxRounds: policy.maxRounds, handled: [], ...over });

/** Decisión principal. facts: ver gather.mjs. Devuelve { state, action } sin efectos secundarios. */
export function decide(facts, policy) {
  let { state } = pickState(facts.stateComments, policy);
  const reject = precheck(facts, policy);
  if (reject) return none(reject, state === 'corrupt' ? null : state);
  if (facts.switch?.enabled !== true) return none('global_switch_off', state === 'corrupt' ? null : state);
  if (state === 'corrupt') return { state: null, action: { type: 'blocked', reason: 'state_comment_corrupt' } };

  const ev = facts.event ?? {};
  // 1. Órdenes del Owner (solo issue_comment de PR, creado, texto exacto)
  if (ev.name === 'issue_comment' && ev.action === 'created' && ev.isPullRequest) {
    const line = String(ev.body ?? '').split('\n')[0].trim();
    const cmd = line === policy.commands.enable ? 'enable' : line === policy.commands.stop ? 'stop' : line === policy.commands.retry ? 'retry' : null;
    if (cmd) {
      if (!isOwner(ev.actor, facts.actorPermission, policy)) return none('command_actor_not_authorized', state);
      if (cmd === 'retry') {
        // Recuperación explícita; conserva reseñas tratadas y consume una ronda normal.
        if (!state || ![STATUS.STOPPED, STATUS.BLOCKED].includes(state.status)) return none('retry_requires_stopped_or_blocked', state);
        if (state.pr !== facts.pr.number || state.head !== facts.pr.headSha) return none('retry_head_mismatch', state);
        if (!Number.isInteger(ev.commentId)) return none('retry_requires_comment_id', state);
        const retryId = `retry-command:${ev.commentId}`;
        if (state.handled.includes(retryId)) return none('retry_already_handled', state);
        if (state.rounds < 1 || state.rounds >= state.maxRounds) return none('retry_round_limit', state);
        const prior = (facts.auditor?.reviews ?? []).filter((r) => isAuditor(r, policy)
          && r.commitId === facts.pr.headSha && r.findingCount > 0 && state.handled.includes(`review:${r.id}`));
        if (!prior.length) return none('retry_requires_handled_findings', state);
        const items = prior.flatMap((r) => r.findings ?? []).slice(0, policy.limits.maxFindings)
          .map((f) => ({ path: String(f.path ?? '').slice(0, 300), line: Number.isInteger(f.line) ? f.line : null, text: String(f.text ?? '').slice(0, policy.limits.maxFindingChars) }));
        if (!items.length) return none('retry_requires_findings_payload', state);
        const round = state.rounds + 1;
        return { state: { ...withHandled(state, [retryId], policy), status: STATUS.CORRECTING, rounds: round, reason: `owner retry round ${round}` }, action: { type: 'run_claude', round, head: facts.pr.headSha, findings: items } };
      }
      if (cmd === 'stop') {
        const s = state ?? newState(facts, policy);
        return { state: { ...s, status: STATUS.STOPPED, reason: 'stopped by owner' }, action: { type: 'notify', kind: 'stopped' } };
      }
      if (!state) return { state: newState(facts, policy), action: { type: 'notify', kind: 'enabled' } };
      if (state.status === STATUS.STOPPED) return { state: { ...state, status: STATUS.AWAITING_REVIEW, head: facts.pr.headSha, reason: 're-enabled by owner' }, action: { type: 'notify', kind: 'enabled' } };
      if (state.status === STATUS.AWAITING_REVIEW && state.head !== facts.pr.headSha) return { state: { ...state, head: facts.pr.headSha, reason: 'head re-baselined by owner' }, action: { type: 'notify', kind: 'rebaselined' } };
      return none('already_enabled_or_terminal', state);
    }
  }

  // 2. El resto solo cuenta si el PR está habilitado y esperando revisión
  if (!state) return none('pr_not_enabled', null);
  if (state.status === STATUS.STOPPED) return none('stopped', state);
  if (TERMINAL.has(state.status)) return none('terminal_state', state);
  if (state.status === STATUS.CORRECTING) return none('correction_in_progress', state);
  if (state.pr !== facts.pr.number) return none('state_for_other_pr', state);
  if (state.head !== facts.pr.headSha) return none('head_differs_from_controller_state', state);

  // 3. Señales del auditor: autor real + SHA == HEAD actual + no tratada
  const signals = [];
  const ignored = [];
  for (const r of facts.auditor?.reviews ?? []) {
    const id = `review:${r.id}`;
    if (!isAuditor(r, policy)) { ignored.push([id, 'not_auditor']); continue; }
    if (r.commitId !== facts.pr.headSha) { ignored.push([id, 'stale_sha']); continue; }
    if (state.handled.includes(id)) { ignored.push([id, 'duplicate']); continue; }
    signals.push({ id, kind: r.findingCount > 0 ? 'findings' : 'review_empty', findings: r.findings ?? [] });
  }
  for (const c of facts.auditor?.receipts ?? []) {
    const id = `receipt:${c.id}`;
    if (!isAuditor(c, policy) || c.appId !== policy.auditor.appId) { ignored.push([id, 'not_auditor']); continue; }
    const m = /\*\*Reviewed commit:\*\*\s*`([0-9a-f]{7,40})`/.exec(c.body ?? '');
    if (!m || !facts.pr.headSha.startsWith(m[1])) { ignored.push([id, 'stale_or_unparsed_sha']); continue; }
    if (state.handled.includes(id)) { ignored.push([id, 'duplicate']); continue; }
    signals.push({ id, kind: /Didn't find any major issues/i.test(c.body) ? 'clean' : 'receipt_other' });
  }
  const findings = signals.filter((x) => x.kind === 'findings');
  const clean = signals.filter((x) => x.kind === 'clean');
  if (findings.length) {
    const ids = signals.map((x) => x.id);
    if (state.rounds >= state.maxRounds) {
      return { state: { ...withHandled(state, ids, policy), status: STATUS.BLOCKED, reason: 'rounds_exhausted_with_findings' }, action: { type: 'blocked', reason: 'rounds_exhausted_with_findings' } };
    }
    const items = findings.flatMap((x) => x.findings).slice(0, policy.limits.maxFindings)
      .map((f) => ({ path: String(f.path ?? '').slice(0, 300), line: Number.isInteger(f.line) ? f.line : null, text: String(f.text ?? '').slice(0, policy.limits.maxFindingChars) }));
    const round = state.rounds + 1;
    return { state: { ...withHandled(state, ids, policy), status: STATUS.CORRECTING, rounds: round, reason: `correction round ${round}` }, action: { type: 'run_claude', round, head: facts.pr.headSha, findings: items } };
  }
  if (clean.length) {
    // handled solo deduplica ejecuciones; no acredita que el hallazgo se corrigiera.
    // Un recibo limpio del mismo SHA no puede borrar una reseña con hallazgos,
    // incluso si aquella ronda falló antes de generar un parche. Fallar cerrado.
    const conflicts = (facts.auditor?.reviews ?? []).some((r) =>
      isAuditor(r, policy) && r.commitId === facts.pr.headSha && r.findingCount > 0);
    if (conflicts) {
      return { state: { ...withHandled(state, signals.map((x) => x.id), policy), status: STATUS.BLOCKED, reason: 'clean_receipt_conflicts_with_findings' }, action: { type: 'blocked', reason: 'clean_receipt_conflicts_with_findings' } };
    }
    return { state: { ...withHandled(state, signals.map((x) => x.id), policy), status: STATUS.OWNER_REVIEW, reason: 'no findings on current head' }, action: { type: 'notify', kind: 'owner_review' } };
  }
  return none(signals.length ? 'signal_without_verdict' : (ignored.length ? `ignored:${ignored.map((i) => i[1]).join(',')}` : 'no_signal'), state);
}

/** Resultado del job de Claude + publicador. outcome: pushed | failure | timeout | no_changes | rejected_patch | stale */
export function decideAfterClaude(state, result, policy) {
  if (!state || state.status !== STATUS.CORRECTING || result.round !== state.rounds) return none('stale_result', state);
  if (result.outcome === 'pushed' && SHA.test(result.newHead ?? '') && result.newHead !== state.head) {
    return { state: { ...state, status: STATUS.AWAITING_REVIEW, head: result.newHead, reason: `awaiting review of round ${state.rounds}` }, action: { type: 'request_review', head: result.newHead } };
  }
  const reason = result.outcome === 'pushed' ? 'invalid_new_head' : String(result.outcome ?? 'unknown_error');
  return { state: { ...state, status: STATUS.BLOCKED, reason }, action: { type: 'blocked', reason } };
}

/** El publicador pregunta justo antes de empujar: parada o interruptor global lo impiden aunque Claude ya haya corrido. */
/** La última orden del Owner (por id de comentario, identidad exacta de la política) es `stop`: se ve aunque su ejecución siga en cola. */
export function ownerStopped(facts, policy) {
  const cmds = (facts.ownerCommands ?? []).filter((c) => c && Number.isInteger(c.id) && (c.cmd === 'stop' || c.cmd === 'enable' || c.cmd === 'retry'))
    .filter((c) => c.author && c.author.type === 'User' && policy.owners.some((o) => o.id === c.author.id && o.login === c.author.login && o.type === c.author.type));
  if (!cmds.length) return false;
  return cmds.reduce((a, b) => (b.id > a.id ? b : a)).cmd === 'stop';
}
export function mayPublish(state, facts, policy, round) {
  if (precheck(facts, policy)) return false;
  if (facts.switch?.enabled !== true) return false;
  if (ownerStopped(facts, policy)) return false;
  return !!state && typeof state === 'object' && state.status === STATUS.CORRECTING && state.rounds === round && state.head === facts.pr.headSha;
}

// ── Validación del parche que produce el modelo (se aplica por código de confianza, sin modelo con token de escritura) ──
// Analizador ESTRICTO: recorre el parche con las mismas reglas de longitud de hunk que git y rechaza cualquier línea que
// no sea una cabecera conocida o contenido de un hunk. Así no hay "basura" que git ignore ni nombres de ruta que git
// interprete de otra forma (entrecomillados con escapes C, espacios, no ASCII): solo rutas de caracteres seguros, y la
// ruta de `diff --git`, la de `---` y la de `+++` tienen que coincidir. La ruta aprobada es la que git aplicará.
const SAFE_PATH = /^[A-Za-z0-9._@+\-][A-Za-z0-9._@+\-/]*$/;
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;
export function validatePatch(patch, policy) {
  if (typeof patch !== 'string' || !patch.trim()) return { ok: false, reason: 'empty_patch' };
  if (Buffer.byteLength(patch) > policy.limits.maxPatchBytes) return { ok: false, reason: 'patch_too_large' };
  if (/^GIT binary patch|^Binary files /m.test(patch)) return { ok: false, reason: 'binary_patch' };
  if (patch.includes('\0') || patch.includes('\r')) return { ok: false, reason: 'unparsable_patch' };
  const lines = patch.split('\n'); if (lines[lines.length - 1] === '') lines.pop();
  const files = []; let cur = null; let i = 0;
  const bad = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  const closeFile = () => {
    if (!cur) return null;
    if (!cur.hunks) return 'no_changes_in_file';
    if (cur.minus === undefined || cur.plus === undefined) return 'missing_file_headers';
    const aOk = cur.created ? cur.minus === '/dev/null' : cur.minus === `a/${cur.a}`; const bOk = cur.deleted ? cur.plus === '/dev/null' : cur.plus === `b/${cur.b}`;
    if (!aOk || !bOk || cur.a !== cur.b) return 'header_path_mismatch';
    files.push(cur.a); cur = null; return null;
  };
  while (i < lines.length) {
    const l = lines[i]; let m;
    if ((m = /^diff --git a\/(\S+) b\/(\S+)$/.exec(l))) {
      const err = closeFile(); if (err) return bad(err);
      cur = { a: m[1], b: m[2], hunks: 0 }; i++; continue;
    }
    if (!cur) return bad('unparsable_patch', { line: i + 1 }); // nada antes del primer `diff --git` (git ignora la basura inicial)
    if (/^(rename|copy|similarity|dissimilarity) /.test(l)) return bad('rename_or_copy');
    if (/^(old|new) mode /.test(l)) return bad('symlink_or_exec_bit');
    if ((m = /^new file mode (\d+)$/.exec(l))) { if (m[1] !== '100644') return bad('symlink_or_exec_bit'); cur.created = true; i++; continue; }
    if ((m = /^deleted file mode (\d+)$/.exec(l))) { if (m[1] !== '100644') return bad('symlink_or_exec_bit'); cur.deleted = true; i++; continue; }
    if (/^index [0-9a-f]{7,64}\.\.[0-9a-f]{7,64}(?: 100644)?$/.test(l)) { i++; continue; }
    if (l.startsWith('--- ')) { if (cur.minus !== undefined || cur.hunks) return bad('unparsable_patch', { line: i + 1 }); cur.minus = l.slice(4); i++; continue; }
    if (l.startsWith('+++ ')) { if (cur.plus !== undefined || cur.hunks || cur.minus === undefined) return bad('unparsable_patch', { line: i + 1 }); cur.plus = l.slice(4); i++; continue; }
    if ((m = HUNK.exec(l))) {
      if (cur.minus === undefined || cur.plus === undefined) return bad('missing_file_headers');
      let oldLeft = m[2] === undefined ? 1 : Number(m[2]); let newLeft = m[4] === undefined ? 1 : Number(m[4]); i++;
      while (oldLeft > 0 || newLeft > 0) {
        const c = lines[i]; if (c === undefined || c.length === 0) return bad('malformed_hunk', { line: i + 1 });
        const t = c[0];
        if (t === ' ') { oldLeft--; newLeft--; } else if (t === '-') oldLeft--; else if (t === '+') newLeft--; else return bad('malformed_hunk', { line: i + 1 });
        if (oldLeft < 0 || newLeft < 0) return bad('malformed_hunk', { line: i + 1 });
        i++;
      }
      if (lines[i] === '\\ No newline at end of file') i++;
      cur.hunks++; continue;
    }
    return bad('unparsable_patch', { line: i + 1 }); // cualquier otra línea fuera de un hunk: rechazo (no se confía en lo que git ignore)
  }
  const err = closeFile(); if (err) return bad(err);
  if (!files.length) return bad('no_paths');
  const c = checkPaths(files, policy);
  return c.ok ? { ok: true, paths: c.paths } : bad(c.reason, { path: c.path });
}

/** Comprobación de rutas (segura + denegadas + permitidas). También se usa sobre las rutas que git MODIFICÓ de verdad. */
export function checkPaths(files, policy) {
  const paths = new Set(files);
  if (!paths.size) return { ok: false, reason: 'no_paths' };
  for (const p of paths) {
    if (!SAFE_PATH.test(p) || p.split('/').some((x) => x === '..' || x === '.' || x === '') || p.length > 300) return { ok: false, reason: 'unsafe_path', path: p };
    if (policy.denyPaths.some((d) => p === d || p.startsWith(d))) return { ok: false, reason: 'denied_path', path: p };
    if (!policy.allowPaths.some((a) => p.startsWith(a))) return { ok: false, reason: 'path_outside_allowlist', path: p };
  }
  return { ok: true, paths: [...paths].sort() };
}
