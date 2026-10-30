import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CONTROL_FILES,bundleDigest,verifyApproval} from '../automation/coordination/verify-approval.mjs';
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-approval-'));for(const file of CONTROL_FILES){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),'synthetic '+file);}return root;}
const approval=root=>({version:1,status:'approved',owner_id:280877387,bundle_sha256:bundleDigest(root),evidence:{pilot_status:'success',pilot_url:'https://github.com/cero-absoluto/voiceprotest-private-review/actions/runs/123'}});
test('unrelated main documentation updates preserve approval',()=>{const root=fixture();try{const a=approval(root);fs.writeFileSync(path.join(root,'README.md'),'documentation');assert.equal(verifyApproval(root,a).ok,true);}finally{fs.rmSync(root,{recursive:true,force:true});}});
test('every control file modification invalidates approval',()=>{for(const file of CONTROL_FILES){const root=fixture();try{const a=approval(root);fs.appendFileSync(path.join(root,file),'changed');assert.equal(verifyApproval(root,a).ok,false,file);}finally{fs.rmSync(root,{recursive:true,force:true});}}});
test('missing, pending, stale or foreign approval never authorizes',()=>{const root=fixture();try{const a=approval(root);for(const bad of [null,{}, {...a,status:'pending'},{...a,owner_id:1},{...a,bundle_sha256:'a'.repeat(64)},{...a,evidence:{pilot_status:'failure',pilot_url:a.evidence.pilot_url}},{...a,evidence:{pilot_status:'success',pilot_url:'https://example.invalid/run/123'}}])assert.equal(verifyApproval(root,bad).ok,false);}finally{fs.rmSync(root,{recursive:true,force:true});}});
test('symlink substitution and missing control files fail closed',()=>{for(const mode of ['symlink','missing']){const root=fixture();try{const a=approval(root),file=path.join(root,CONTROL_FILES[0]);fs.unlinkSync(file);if(mode==='symlink')fs.symlinkSync(path.join(root,CONTROL_FILES[1]),file);assert.throws(()=>verifyApproval(root,a));}finally{fs.rmSync(root,{recursive:true,force:true});}}});

test('trusted preflight rejects a synthetic symlink before artifact collection',async()=>{
  const {spawnSync}=await import('node:child_process');
  const workflow=fs.readFileSync(new URL('../.github/workflows/agent-handoff.yml',import.meta.url),'utf8');
  const block=workflow.split("python3 -I - <<'PYTHON'\n")[1].split('          PYTHON')[0].split('\n').map(line=>line.replace(/^          /,'')).join('\n');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-links-'));
  try{
    fs.writeFileSync(path.join(root,'regular.txt'),'synthetic');
    assert.equal(spawnSync('python3',['-I','-c',block],{cwd:root}).status,0);
    fs.symlinkSync(path.join(root,'regular.txt'),path.join(root,'source-link'));
    assert.notEqual(spawnSync('python3',['-I','-c',block],{cwd:root}).status,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('preflight imports cannot be shadowed by a PR pathlib module',async()=>{
 const {spawnSync}=await import('node:child_process');
 const workflow=fs.readFileSync(new URL('../.github/workflows/agent-handoff.yml',import.meta.url),'utf8');
 const block=workflow.split("python3 -I - <<'PYTHON'\n")[1].split('          PYTHON')[0].split('\n').map(line=>line.replace(/^          /,'')).join('\n');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-python-'));
 try{
  fs.writeFileSync(path.join(root,'pathlib.py'),"open('untrusted-module-ran','w').write('synthetic')\nraise RuntimeError('PR module executed')\n");
  assert.notEqual(spawnSync('python3',['-c','from pathlib import Path'],{cwd:root}).status,0);
  assert.ok(fs.existsSync(path.join(root,'untrusted-module-ran')),'negative control demonstrates import injection');
  fs.unlinkSync(path.join(root,'untrusted-module-ran'));
  assert.equal(spawnSync('python3',['-I','-c',block],{cwd:root}).status,0);
  assert.equal(fs.existsSync(path.join(root,'untrusted-module-ran')),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
