// Regenerate the standalone API lock from already reviewed root resolutions, offline.
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=new URL('../../',import.meta.url);
const api=JSON.parse(readFileSync(new URL('apps/api/package.json',root),'utf8'));
const lock=JSON.parse(readFileSync(new URL('package-lock.json',root),'utf8'));
const known=new Set(Object.entries(lock.packages).filter(([p])=>p).map(([,v])=>JSON.stringify([v.version,v.resolved,v.integrity])));
lock.name=api.name;lock.version=api.version;lock.packages['']={...api};
for(const [p,v] of Object.entries(lock.packages))if(p.startsWith('apps/')||v.link)delete lock.packages[p];
const dir=mkdtempSync(join(tmpdir(),'vp-api-lock-'));
try{
 writeFileSync(join(dir,'package.json'),JSON.stringify(api,null,2)+'\n');
 writeFileSync(join(dir,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
 const r=spawnSync('npm',['install','--package-lock-only','--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd:dir,encoding:'utf8'});
 if(r.status!==0)throw new Error('Offline derivation failed; populate the reviewed npm cache first.');
 const result=JSON.parse(readFileSync(join(dir,'package-lock.json'),'utf8'));
 for(const [p,v]of Object.entries(result.packages))if(p&&!known.has(JSON.stringify([v.version,v.resolved,v.integrity])))throw new Error('API resolution differs from reviewed root: '+p);
 writeFileSync(new URL('apps/api/package-lock.json',root),JSON.stringify(result,null,2)+'\n');
 console.log('Derived API lock with '+(Object.keys(result.packages).length-1)+' reviewed entries.');
}finally{rmSync(dir,{recursive:true,force:true});}
