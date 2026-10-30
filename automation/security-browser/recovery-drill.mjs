// Verify and rehearse restoration of a known PUBLIC static artifact in a private temp directory.
// Does not publish, stop a service, access a database, or read arbitrary backup files.
import{readFileSync,lstatSync,mkdtempSync,copyFileSync,mkdirSync,writeFileSync,rmSync,readdirSync}from'node:fs';
import{resolve,dirname,join}from'node:path';
import{tmpdir}from'node:os';
import{createHash}from'node:crypto';
const source=process.argv[2];if(!source)throw Error('A local export of the recorded public Pages commit is required');
const manifest=JSON.parse(readFileSync(new URL('./rollback-baseline.json',import.meta.url),'utf8'));
const digest=data=>createHash('sha256').update(data).digest('hex');
function validate(root){
 const failures=[],expected=new Set(manifest.files.map(f=>f.path));
 function walk(dir,prefix=''){for(const entry of readdirSync(dir,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isSymbolicLink()){failures.push(name);continue;}if(entry.isDirectory())walk(join(dir,entry.name),name+'/');else if(!entry.isFile()||!expected.has(name))failures.push(name);}}
 walk(root);if(failures.length)return failures;
 for(const f of manifest.files){const path=resolve(root,f.path);if(!path.startsWith(resolve(root)+'/'))throw Error('Unsafe artifact path');try{if(!lstatSync(path).isFile()||digest(readFileSync(path))!==f.sha256)failures.push(f.path);}catch{failures.push(f.path);}}
 return failures;
}
if(validate(source).length)throw Error('Source is not the recorded known-good static artifact');
const target=mkdtempSync(join(tmpdir(),'vp-recovery-drill-'));
try{
 for(const f of manifest.files){const path=join(target,f.path);mkdirSync(dirname(path),{recursive:true});copyFileSync(join(source,f.path),path);}
 if(validate(target).length)throw Error('Initial artifact copy failed');
 writeFileSync(join(target,'index.html'),'Synthetic failed deployment; no production operation.');
 writeFileSync(join(target,'unexpected.js'),'Synthetic unexpected artifact');
 if(!validate(target).includes('unexpected.js'))throw Error('Unexpected artifact was not detected');
 rmSync(join(target,'unexpected.js'));
 if(!validate(target).includes('index.html'))throw Error('Failed artifact was not detected');
 copyFileSync(join(source,'index.html'),join(target,'index.html'));
 if(validate(target).length)throw Error('Restored artifact failed verification');
 console.log(JSON.stringify({status:'PASS',baseline_commit:manifest.commit,public_files_verified:manifest.files.length,corruption_detected:true,restored_artifact_matches:true,production_touched:false,database_touched:false,limits:'Local static-artifact integrity recovery. Not a live failover, RPO/RTO, browser recovery or current database restore certification.'}));
}finally{rmSync(target,{recursive:true,force:true});}
