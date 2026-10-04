import {createHash} from 'node:crypto';
export const keyPurposes=['annual','event','rate','session','otp','provider','review'];
export const legacyFundingVersion={id:'v1',provenance:'synthetic_v1_known',secrets:Object.fromEntries(keyPurposes.map(p=>[p,'f'.repeat(32)]))};
export const splitFundingVersion={id:'v2',provenance:'synthetic_split',secrets:Object.fromEntries(keyPurposes.map(p=>[p,('fixture-v2-'+p).padEnd(32,'x')]))};
export async function registerFundingVersion(database,version){if(version.id==='v1')await database.query("INSERT INTO funding_private.continuity_enrollment VALUES(true,true,'synthetic_closed_fixture','d0000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING");for(const purpose of keyPurposes)await database.query('INSERT INTO funding_private.key_versions VALUES($1,$2,$3,$4)',[purpose,version.id,version.provenance,createHash('sha256').update(version.secrets[purpose]).digest('hex')]);}
export const fixtureRetentionPolicySQL="INSERT INTO funding_auth_private.retention_policy VALUES('session',1,true,0),('challenge',1,true,0),('rate',1,true,0)";
