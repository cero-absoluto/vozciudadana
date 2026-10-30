// Trusted default-branch preflight. No PR code, network, model or credentials.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const CONTROL_FILES = Object.freeze([
  '.github/workflows/agent-handoff.yml',
  'automation/coordination/controller.mjs',
  'automation/coordination/gather.mjs',
  'automation/coordination/github.mjs',
  'automation/coordination/policy.json',
  'automation/coordination/publish.mjs',
  'automation/coordination/request-review.mjs',
  'automation/coordination/verify-approval.mjs',
]);
export function bundleDigest(root) {
  const hash=crypto.createHash('sha256');
  for(const name of CONTROL_FILES){
    const file=path.join(root,name);
    if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw Error('non_regular_control_file');
    const bytes=fs.readFileSync(file);
    hash.update(name+'\0'+bytes.length+'\0');hash.update(bytes);
  }
  return hash.digest('hex');
}
export function verifyApproval(root, approval) {
  if(approval?.version!==1 || approval?.status!=='approved' ||
     !/^[0-9a-f]{64}$/.test(approval.bundle_sha256||'') ||
     approval.owner_id!==280877387 ||
     approval.evidence?.pilot_status!=='success' ||
     !/^https:\/\/github\.com\/cero-absoluto\/voiceprotest-private-review\/actions\/runs\/\d+$/.test(approval.evidence?.pilot_url||'')) {
    return {ok:false,reason:'approval_missing_or_invalid'};
  }
  const actual=bundleDigest(root);
  return {ok:actual===approval.bundle_sha256,reason:actual===approval.bundle_sha256?'approved':'control_bundle_changed',bundle_sha256:actual};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));let result;
  try{const approval=JSON.parse(fs.readFileSync(path.join(root,'automation/coordination/sandbox-approval.json'),'utf8'));result=verifyApproval(root,approval);}
  catch{result={ok:false,reason:'approval_unavailable'};}
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
