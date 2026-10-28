import {createHash,timingSafeEqual} from 'node:crypto';
// Bounded inputs and equal-length digest comparison; not a claim that the entire HTTP path is constant-time.
export function credentialMatches(provided,expected) {
  if(typeof provided!=='string'||typeof expected!=='string'||provided.length===0||expected.length===0||provided.length>4096||expected.length>4096)return false;
  return timingSafeEqual(createHash('sha256').update(provided,'utf8').digest(),createHash('sha256').update(expected,'utf8').digest());
}
