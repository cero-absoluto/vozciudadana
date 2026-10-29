import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const require=createRequire(new URL('../preflight/tools/package.json',import.meta.url));
const {parse}=require('yaml');
const workflowPolicy=JSON.parse(readFileSync(new URL('./web-workflow-policy.json',import.meta.url),'utf8'));
const prWorkflowPolicy=JSON.parse(readFileSync(new URL('./pr-workflow-policy.json',import.meta.url),'utf8'));

// This checks the publication boundary, not whether dependencies are vulnerability-free.
export function checkWorkflow(w){
 const failures=[];const check=(ok,message)=>{if(!ok)failures.push(message);};
 check(isDeepStrictEqual(w,workflowPolicy),'workflow structure differs from reviewed policy (events, env, defaults, steps, inputs or order)');
 check(w && Object.keys(w.permissions??{unexpected:true}).length===0,'workflow permissions must be empty');
 check(JSON.stringify(Object.keys(w.jobs??{}).sort())==='["build","deploy"]','only reviewed jobs are allowed');
 const b=w.jobs?.build??{},d=w.jobs?.deploy??{},bs=b.steps??[],ds=d.steps??[];
 check(JSON.stringify(b.permissions)==='{"contents":"read"}','build must have read-only contents');
 check(JSON.stringify(d.permissions)==='{"contents":"write"}','deploy write permission must remain scoped');
 check(d.needs==='build'&&d.if==="github.ref == 'refs/heads/main'",'deploy must depend on build and main');
 check(w.concurrency?.['cancel-in-progress']===false&&w.concurrency?.group==='deploy-web-pages','publication must be serialized');
 check(w.on?.push?.paths?.includes('package-lock.json'),'lockfile changes must trigger publication');
 for(const j of Object.values(w.jobs??{})){
  check(Number.isInteger(j['timeout-minutes'])&&j['timeout-minutes']>0&&j['timeout-minutes']<=15,'job timeout required');
  for(const s of j.steps??[])if(s.uses)check(/^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[a-f0-9]{40}$/.test(s.uses),'all actions must be pinned to commit SHA');
 }
 const checkout=bs.find(s=>s.uses?.startsWith('actions/checkout@'));
 check(checkout?.with?.['persist-credentials']===false&&checkout?.with?.ref==='${{ github.sha }}','build checkout must use exact SHA without persistent credentials');
 check(bs.some(s=>s.run==='npm ci --ignore-scripts --no-audit --no-fund'),'build must use locked install without lifecycle scripts');
 check(!JSON.stringify(b).includes('secrets.'),'no secrets may enter the build job');
 check(bs.find(s=>s.uses?.startsWith('actions/setup-node@'))?.with?.['node-version']===24,'build requires supported Node 24');
 const upload=bs.find(s=>s.uses?.startsWith('actions/upload-artifact@'));
 check(upload?.id==='bundle'&&upload?.with?.path==='apps/web/dist'&&upload?.with?.['if-no-files-found']==='error','only static output is uploaded');
 check(b.outputs?.artifact_id==='${{ steps.bundle.outputs.artifact-id }}','build must expose immutable artifact id');
 check(ds.length===2&&ds.every(s=>s.uses&&!s.run),'write job must contain only two reviewed actions');
 const download=ds[0],publish=ds[1];
 check(download?.uses==='actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333'&&download?.with?.['artifact-ids']==='${{ needs.build.outputs.artifact_id }}'&&download?.with?.path==='web-dist','deploy must download this build artifact by id');
 check(publish?.uses==='peaceiris/actions-gh-pages@4f9cc6602d3f66b9c108549d475ec49e8ef4d45e'&&publish?.with?.publish_dir==='web-dist'&&publish?.with?.github_token==='${{ secrets.GITHUB_TOKEN }}','publish must use reviewed action and static directory');
 return failures;
}
export function checkLock(lock){
 const failures=[];
 if(lock.lockfileVersion!==3)failures.push('reviewed npm lockfile version 3 required');
 for(const [path,p] of Object.entries(lock.packages??{})){
  if(!path.startsWith('node_modules/')&&!path.includes('/node_modules/'))continue;
  if(p.link){if(!['apps/api','apps/web'].includes(p.resolved))failures.push('unexpected local package link: '+path);continue;}
  if(!p.version||!p.resolved?.startsWith('https://registry.npmjs.org/')||!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(p.integrity??''))failures.push('missing registry identity or SHA-512: '+path);
 }
 return failures;
}
export function checkApiLock(root,api,manifest,railway){
 const failures=[...checkLock(api)];
 if(railway.build?.builder!=='RAILPACK')failures.push('API config must match reviewed Railpack builder');
 if(!isDeepStrictEqual(api.packages?.['']?.dependencies,manifest.dependencies)||!isDeepStrictEqual(root.packages?.['apps/api']?.dependencies,manifest.dependencies))failures.push('API lock and root workspace must match API manifest');
 const identity=(p,v)=>JSON.stringify([p.split('node_modules/').at(-1),v.version,v.resolved,v.integrity]);
 const known=new Set(Object.entries(root.packages??{}).filter(([p,v])=>p&&!v.link).map(([p,v])=>identity(p,v)));
 for(const [p,v]of Object.entries(api.packages??{}))if(p&&!known.has(identity(p,v)))failures.push('API resolution absent from reviewed root lock: '+p);
 return failures;
}
export function checkNpmConfig(root){
 return ['.npmrc','apps/api/.npmrc','apps/web/.npmrc','automation/preflight/tools/.npmrc'].filter(p=>existsSync(new URL(p,root))).map(p=>'unreviewed npm configuration: '+p);
}
export function checkPrWorkflow(w){return isDeepStrictEqual(w,prWorkflowPolicy)?[]:['PR check differs from reviewed read-only policy'];}
export function inspect(root=new URL('../../',import.meta.url)){
 const read=p=>readFileSync(new URL(p,root),'utf8');
 const lock=JSON.parse(read('package-lock.json'));
 const fixtureLocks=['automation/preflight/tools/package-lock.json','automation/security-database/native/package-lock.json','automation/security-network-push/native/package-lock.json','automation/security-quotas/native/package-lock.json'];
 return {metadata_only:true,limitations:'Static policy and lock integrity checks; not an advisory scan, provenance proof, or deployment verification.',failures:[...checkWorkflow(parse(read('.github/workflows/deploy.yml'))),...checkPrWorkflow(parse(read('.github/workflows/dependency-policy.yml'))),...checkNpmConfig(root),...checkLock(lock),...fixtureLocks.flatMap(p=>checkLock(JSON.parse(read(p))).map(f=>p+': '+f)),...checkApiLock(lock,JSON.parse(read('apps/api/package-lock.json')),JSON.parse(read('apps/api/package.json')),JSON.parse(read('apps/api/railway.json')))]};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report=inspect();console.log(JSON.stringify(report,null,2));if(report.failures.length)process.exitCode=1;
}
