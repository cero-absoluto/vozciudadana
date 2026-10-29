import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {checkWorkflow,checkPrWorkflow,checkLock,checkApiLock,checkNpmConfig,inspect} from '../automation/security-supply-chain/check.mjs';
const require=createRequire(new URL('../automation/preflight/tools/package.json',import.meta.url));
const {parse}=require('yaml');
const workflow=()=>parse(readFileSync(new URL('../.github/workflows/deploy.yml',import.meta.url),'utf8'));
test('reviewed publication boundary and registry lock pass',()=>assert.deepEqual(inspect().failures,[]));
for(const [name,mutate] of [
 ['global write token',w=>w.permissions={contents:'write'}],
 ['build write token',w=>w.jobs.build.permissions.contents='write'],
 ['secret in build',w=>w.jobs.build.env={TOKEN:'${{ secrets.GITHUB_TOKEN }}'}],
 ['persistent checkout credentials',w=>w.jobs.build.steps[0].with['persist-credentials']=true],
 ['mutable action tag',w=>w.jobs.build.steps[0].uses='actions/checkout@v6'],
 ['unlocked install',w=>w.jobs.build.steps.find(s=>s.run?.startsWith('npm ci ')).run='npm install'],
 ['branch publication',w=>delete w.jobs.deploy.if],
 ['cross-run artifact name',w=>w.jobs.deploy.steps[0].with={'name':'web-dist','path':'web-dist'}],
 ['code execution with write token',w=>w.jobs.deploy.steps.push({run:'npm install'})],
 ['lockfile trigger omission',w=>w.on.push.paths=w.on.push.paths.filter(x=>x!=='package-lock.json')],
 ['privileged PR trigger',w=>w.on.pull_request_target={}],
 ['external publication target',w=>w.jobs.deploy.steps[1].with.external_repository='example/other'],
 ['alternate publication token',w=>w.jobs.deploy.steps[1].with.personal_token='${{ secrets.OTHER_TOKEN }}'],
 ['workflow registry override',w=>w.env={NPM_CONFIG_REGISTRY:'https://example.invalid'}],
 ['workflow Node preload',w=>w.env={NODE_OPTIONS:'--import ./extra.js'}],
 ['workflow shell defaults',w=>w.defaults={run:{shell:'custom-shell'}}],
 ['extra build step after upload',w=>w.jobs.build.steps.push({run:'node extra.js'})],
 ['artifact merging drift',w=>w.jobs.deploy.steps[0].with['merge-multiple']=false],
])test('rejects '+name,()=>{const w=workflow();mutate(w);assert.ok(checkWorkflow(w).length);});
for(const p of [{version:'1',resolved:'https://example.invalid/pkg.tgz',integrity:'sha512-YQ=='},{version:'1',resolved:'https://registry.npmjs.org/pkg.tgz'},{link:true,resolved:'../outside'}])test('rejects unreviewed dependency identity '+JSON.stringify(p),()=>assert.ok(checkLock({lockfileVersion:3,packages:{'node_modules/example':p}}).length));
for(const [name,mutate]of[
 ['builder mismatch',o=>o.railway.build.builder='NIXPACKS'],
 ['standalone version drift',o=>o.api.packages['node_modules/resend'].version='0.0.1'],
 ['API manifest drift',o=>o.manifest.dependencies.resend='0.0.1'],
])test('rejects API '+name,()=>{
 const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
 const o={root:read('package-lock.json'),api:read('apps/api/package-lock.json'),manifest:read('apps/api/package.json'),railway:read('apps/api/railway.json')};mutate(o);assert.ok(checkApiLock(o.root,o.api,o.manifest,o.railway).length);
});
test('rejects a repository npm registry override',()=>{
 const dir=mkdtempSync(join(tmpdir(),'vp-npm-policy-'));
 try{const root=pathToFileURL(dir+'/');assert.deepEqual(checkNpmConfig(root),[]);mkdirSync(join(dir,'apps/api'),{recursive:true});writeFileSync(join(dir,'apps/api/.npmrc'),'registry=https://example.invalid\n');assert.equal(checkNpmConfig(root).length,1);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('API-only policy inputs trigger a main-branch check, and all PRs get a read-only check',()=>{
 const w=workflow(),paths=w.on.push.paths;
 for(const p of ['apps/api/package.json','apps/api/package-lock.json','apps/api/railway.json','automation/security-database/native/package-lock.json','automation/security-network-push/native/package-lock.json','automation/security-quotas/native/package-lock.json','.npmrc','apps/api/.npmrc'])assert.ok(paths.includes(p),p);
 const pr=parse(readFileSync(new URL('../.github/workflows/dependency-policy.yml',import.meta.url),'utf8'));
 assert.deepEqual(pr.on,{pull_request:{branches:['main']}});assert.deepEqual(checkPrWorkflow(pr),[]);
 pr.jobs['dependency-policy'].permissions.contents='write';assert.ok(checkPrWorkflow(pr).length);
});
