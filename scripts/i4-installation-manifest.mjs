import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const files=[
 'apps/api/src/funding/durableRouteStore.js','apps/api/src/funding/privateLookupVault.js',
 'apps/api/src/funding/participationRouteRehearsal.js','apps/api/src/funding/blockedTwilioAdapter.js','apps/api/src/funding/smsIntegrationCandidate.js',
 'apps/api/src/funding/sql/durable-route-candidate.sql',
 'supabase/migrations/20261005114925_funding_participation_scope_rehearsal.sql',
 'apps/web/src/screens/FundingScreen.vue',...['es','en','fr','zh'].map(l=>`apps/web/src/locales/${l}.json`),
 'scripts/i4-installation-preflight.sql','scripts/i4-installation-manifest.mjs','apps/api/src/funding/DURABLE_INSTALLATION_REVIEW.md','tests/funding-participation-routes.test.mjs','tests/funding-multisession.test.mjs'
];
const hashes=await Promise.all(files.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim();
console.log(JSON.stringify({kind:'pre_installation_review',sourceCommit,dirty,files:hashes,
 installationAllowed:false,activationAllowed:false,provider:'blocked_synthetic_twilio',
 paymentChannel:'legacy_kofi_personal_paypal',enrolledProductionScopes:[],
 databaseChange:'disposable_draft_only_not_production_migration',
 prerequisites:['current production metadata reviewed','production-compatible DDL reviewed',
  'native PostgreSQL17 current-candidate tests','backup restoration rehearsal','independent Owner installation gate',
  'qualified provider/cost evidence and operational secrets','independent Owner activation gate'],
 stops:['metadata drift','missing provider evidence','unqualified opening funds','legacy writer on new scope',
  'ambiguous send or commit','pending costs before settlement','final hash change'],
 rollback:'candidate disabled; retain journals; no financial down migration'
},null,2));
