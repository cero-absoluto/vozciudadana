// Solo código de la rama por defecto. Sin checkout del PR, shell, artefactos ni modelos.
// El PAT se usa únicamente para identificar al Owner y publicar la petición de revisión.
import { fileURLToPath } from 'node:url';
import { collectFacts, loadPolicy } from './gather.mjs';
import { ownerStopped, pickState, precheck, STATUS } from './controller.mjs';
import { makeApi } from './github.mjs';

export async function requestReview({ api, ownerApi, policy, repository, number, head, switchEnabled }) {
  if (!Number.isSafeInteger(number) || number < 1 || !/^[0-9a-f]{40}$/.test(head ?? '')) throw new Error('invalid_review_target');
  const check = async () => {
    const facts = await collectFacts({ api, policy, repository, event: { issue: { number, pull_request: {} } }, switchEnabled, force: true });
    const { state } = pickState(facts.stateComments, policy);
    if (precheck(facts, policy) || facts.switch.enabled !== true || ownerStopped(facts, policy)
      || !state || state === 'corrupt' || state.status !== STATUS.AWAITING_REVIEW
      || state.pr !== number || state.head !== head || facts.pr.headSha !== head) throw new Error('review_not_current_or_not_enabled');
  };
  await check();
  const owner = await ownerApi.request('GET', '/user');
  if (!policy.owners.some((o) => o.id === owner.id && o.login === owner.login && o.type === owner.type)) throw new Error('review_token_is_not_owner');
  const marker = `<!-- handoff-review-request:v1 pr:${number} head:${head} -->`;
  const comments = await api.paginate(`/repos/${repository}/issues/${number}/comments`);
  const prior = comments.find((c) => c.user?.id === owner.id && c.user?.login === owner.login && c.user?.type === owner.type && String(c.body ?? '').includes(marker));
  if (prior) return { outcome: 'already_requested', url: prior.html_url };
  // Revalidar tras identificar la cuenta y deduplicar: un stop o push intermedio cancela la petición.
  await check();
  const result = await ownerApi.request('POST', `/repos/${repository}/issues/${number}/comments`, { body: `@codex review\n\nRevisión automática del parche publicado por el relevo. HEAD esperado: \`${head}\`.\n${marker}` });
  return { outcome: 'requested', head, url: result.html_url };
}

export async function main(env = process.env) {
  if (!env.CODEX_REVIEW_GITHUB_TOKEN) throw new Error('missing_CODEX_REVIEW_GITHUB_TOKEN');
  return requestReview({ api: makeApi({ token: env.GITHUB_TOKEN }), ownerApi: makeApi({ token: env.CODEX_REVIEW_GITHUB_TOKEN }), policy: loadPolicy(), repository: env.GITHUB_REPOSITORY, number: Number(env.PR_NUMBER), head: env.EXPECTED_HEAD, switchEnabled: env.AGENT_HANDOFF_ENABLED });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(`request-review: ${e.message}`); process.exit(1); });
