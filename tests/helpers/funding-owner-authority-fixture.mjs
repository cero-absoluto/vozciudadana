import {randomUUID} from 'node:crypto';
import {ownerOperationDigest} from '../../apps/api/src/funding/ownerAuthority.js';
export const authorityMigration=new URL('../../supabase/migrations/20261004183459_funding_owner_authority_contract.sql',import.meta.url);
// Trusted adapter fixture with opaque handles; caller cannot make claims by supplying metadata.
export function ownerIdentityFixture(principal=randomUUID()){
 const identities=new Map(),confirmations=new Map();
 function credential(overrides={}){const id=randomUUID();identities.set(id,{issuer:'synthetic_owner_issuer',audience:'funding_owner_review',subject:'fixture-owner',epoch:1,sessionId:randomUUID(),stepUp:true,expiresAt:Date.now()+600000,...overrides});return id;}
 function confirm(kind,input,challengeId,epoch=1){const id=randomUUID();confirmations.set(id,{digest:ownerOperationDigest(kind,input),challengeId,principal,epoch});return id;}
 return {principal,credential,confirm,adapter:{kind:'synthetic_verified_identity',verify:async value=>identities.get(value),verifyConfirmation:async(value,binding)=>JSON.stringify(confirmations.get(value))===JSON.stringify(binding)}};
}
