# Phase B: 403 diagnosis and minimal evidence correction

## Observed
Run 39386622818 on bc817abe319bd00deb91f19ba64f95948323971c:
precheck succeeded; send returned HTTP 403, sent=false, not_created.
The runner showed Contents:read, Issues:write, PullRequests:read.
PR #43 had no comments at inspection. No request reached Codex.
The two workflows were removed and #43 closed without merge. Owner reported removing PHASEB_PR and the synthetic branch.

## What cannot be recovered
The original POST response message, documentation_url and diagnostic headers were discarded by send()/makeFetchApi(). Historical workflow artifacts contain the same reduced record; another GET cannot recover that response. A 403 alone does not establish its cause.

Official endpoint reference lists Issues:write OR Pull requests:write:
https://docs.github.com/en/rest/issues/comments?apiVersion=2022-11-28#create-an-issue-comment
Official troubleshooting recommends X-Accepted-GitHub-Permissions to inspect accepted permission combinations:
https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#resource-not-accessible
Existing Issues:write means a permission increase is not established by the reference alone. Rate limiting or integration restrictions are hypotheses, not diagnoses. No assertion that a specific scope will fix the historical failure.

## Minimal correction
Only the phase B API adapter and failed-POST report change:
- Record bounded message and docs.github.com documentation URL (drop query/fragment).
- Record only response request-id, accepted permissions, rate-limit remaining and retry-after.
- Reject known secret values/token patterns through existing assertNoSecrets; redact those fields.
- Do not dump raw request/response headers, response body, nested errors or credentials.
- Keep one POST attempt, failure/unknown states, no retries and existing permissions unchanged.

## Direct verification
Node 24.19.0, offline API doubles only:
3 new error-evidence tests + PB1-PB7: 10/10 passed.
No full suite, Actions, real POST, Codex inference or model credentials used for this correction.
No installed workflow, candidate permission change, application change, merge or deployment.
This corrects missing diagnostics; it does not claim to fix the underlying 403.
A live retest and any permissions change require separate Owner authorization.
