# Dependency and publication boundary checks

S15 candidate, based on public commit 00625c7d836cec6b2c336b938970e8da0c4fec69. Preparation does not deploy or change Railway settings.

The root lockfile is the reviewed npm workspace source. A standalone apps/api/package-lock.json is derived offline from those reviewed resolutions, so an isolated /apps/api build also has a lock. The policy checks its manifest and registry identities against the root lock; regeneration is explicit via `node automation/security-supply-chain/derive-api-lock.mjs`. Targeted security updates upgrade jsPDF to 4.2.1, Vue I18n to 11.4.16, Vite to its maintained 6.4.5 line and Resend to 6.35.0, together with affected compatible transitive dependencies. Vue stays on 3.5; Fastify and Twilio direct versions remain unchanged. The diff includes platform-specific esbuild binaries and removes the old email-renderer dependency tree. See audit-summary.json for every version change and the six lockfile scan summaries. No npm audit fix or wholesale latest-major update was used.

Node 24 is selected in the root and API manifests and web build. Patch releases within Node 24 remain selectable: this pins the supported release line, not the OS image or exact runtime bytes. The static checker and canonical policy are editable in the same repository: they are regression checks, not an authorization boundary or a replacement for protected review. Registry integrity hashes do not establish maintainer provenance and a zero-advisory scan does not establish absence of vulnerabilities.

## Local validation

```
npm ci --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund --prefix automation/preflight/tools
node automation/security-supply-chain/check.mjs
node --experimental-test-module-mocks --test tests/*.test.mjs
node --experimental-test-module-mocks --test tests/national-country-derived.mjs tests/otp-precheck.mjs
npm run build
npm audit --json
```

The policy checker uses the existing isolated YAML parser and checks the actual web workflow and registry identities in the six locks. It also rejects repository npm configuration overrides and compares the complete parsed workflow against a reviewed canonical policy. Mutation tests reject unpinned actions, mutable artifact selection, global/build write tokens, secret propagation into the build, lifecycle/unlocked installation, and branch publication. It is not an advisory scanner or a live Actions test. Separate native fixture lockfiles and the parser lock were audited without installing or executing them. A standalone API-only copy, containing no parent workspace files, passed offline npm ci with 148 packages and zero advisory findings.

A separate read-only `Dependency publication policy / dependency-policy` job runs on every pull request to main. Main-branch checks also cover API-only manifests/configuration, all six locks and forbidden npm configuration paths. It is not configured as a required branch status by this change: repository administration/branch-protection permissions are not available, and Railway checkSuites is currently false. It detects regressions; it does not prevent direct merges/deployments by an authorized writer.

The web workflow builds at the exact triggering commit with read-only permissions and no persistent checkout credentials. Package lifecycle scripts are disabled. Hidden files inside the static output are explicitly included; current public/dist content has none. Only the static output is transferred by immutable artifact id to a separate job with write permission; that job performs no application checkout, install or execution. Deployment is restricted to main, including manual invocations, and serialized. All referenced actions are pinned to commit SHAs. A compromise of the trusted publication action, repository administrator or static output can still affect the published site. Workflow preparation does not certify a run in GitHub Actions.

## Railway follow-up at approved publication

Observed service configuration uses Railpack and watches only /apps/api/**. The proposed account change is to retain that watch path and add /package.json and /package-lock.json. Set only the nonsecret RAILPACK_NODE_NPM_INSTALL value to `npm ci --ignore-scripts --no-audit --no-fund`. Railpack documents npm install as its default; the current production install command/runtime was not inferred from runtime logs. apps/api/railway.json is aligned to RAILPACK; the old NIXPACKS declaration is removed. The colocated API lock eliminates dependence on a parent build context. Both install roots were tested locally. The selected lock and Node 24 selection must be observed in the resulting build before declaring the API deployment verified. No change is made during preparation. No root directory, start command, live builder, replica, network boundary or database change is proposed. The publication sequence is: update only watchPatterns; set only that nonsecret installation variable with skipDeploys=true; then merge the approved candidate and verify its deployments. No account change is made during preparation.

Official references, checked 2026-10-29:
- https://github.com/parallax/jsPDF/releases/tag/v4.2.1
- https://github.com/intlify/vue-i18n/releases
- https://github.com/vitejs/vite/releases/tag/v6.4.5
- https://github.com/resend/resend-node#request-options
- https://nodejs.org/en/about/previous-releases
- https://railpack.com/config/recommendations
- https://docs.railway.com/builds/build-configuration

Remaining outside this block: exact tool/OS image provenance, credential rotation, repository administration/branch protections not exposed by the connector, full runtime image/OS vulnerability scanning, native PostgreSQL maintenance and production provider/browser rehearsals. No secret values or user rows are required for these checks.

## Adjacent institutional corrections from private review

New institutional verifications use the next strictly future 31 August at 00:00 UTC (for example, 29 October 2026 yields 31 August 2027). No historical memberships are rewritten. Institutional email/OTP/IP hashes continue using configured keys unchanged; missing keys fail closed unless NODE_ENV is explicitly development or test. Production already checks required keys at boot. These local fixes do not certify all other development fallbacks or rotate keys.

Two private static reviews covered earlier candidate commits. Final trigger/date/fallback follow-ups were validated locally; no third independent review was executed. Provider delivery uncertainty, retry idempotency, and global quota/recovery design remain separate pending items. Failed delivery is not blindly refunded or challenge-released, because a provider may have accepted a request despite a lost response.
