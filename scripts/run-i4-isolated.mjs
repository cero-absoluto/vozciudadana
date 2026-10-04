import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {fundingParentFixtureSQL,fundingRlsMigration,fundingAuthMigration} from '../tests/helpers/funding-fixture.mjs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import {createIsolatedFundingService,createPaymentSimulator} from '../apps/api/src/funding/isolatedService.js';
import {isolatedFundingRoutes} from '../apps/api/src/funding/routes.js';
if(process.env.I4_RUN_ISOLATED!=='1'||process.env.NODE_ENV==='production')throw new Error('Explicit isolated mode required');
const db=new PGlite();
await db.exec(fundingParentFixtureSQL);
await db.exec(`INSERT INTO public.protests(id,starts_at,ends_at,saldo_euros,hash_integridad) VALUES('40000000-0000-0000-0000-000000000001',now()-interval '1 day',now()+interval '1 day',0,'synthetic');`);
await db.exec(await readFile(new URL('../supabase/migrations/20261003200832_funding_private_core.sql',import.meta.url),'utf8'));
await db.exec(await readFile(fundingRlsMigration,'utf8'));
 await db.exec(await readFile(fundingAuthMigration,'utf8'));
await db.exec(`INSERT INTO funding_private.accounts(id,kind,event_id) VALUES('event:40000000-0000-0000-0000-000000000001','event','40000000-0000-0000-0000-000000000001')`);
const app=Fastify({logger:false});
await app.register(cors,{origin:['http://127.0.0.1:5174','http://localhost:5174'],allowedHeaders:['Content-Type','X-Funding-Session','X-Simulator-Auth']});
await app.register(rateLimit,{max:30,timeWindow:'1 minute'});
await db.exec('SET ROLE funding_runtime');
const service=createIsolatedFundingService({database:db,secret:randomBytes(32).toString('hex'),timeZone:'Europe/Amsterdam',mode:'isolated',
 simulator:createPaymentSimulator({otpCode:'123456',webhookSecret:randomBytes(32).toString('hex')})});
await app.register(isolatedFundingRoutes,{prefix:'/api/funding',service});
await app.listen({host:'127.0.0.1',port:4104});
console.log('Isolated simulator: http://127.0.0.1:4104 — no SMS, providers or real funds. Test OTP: 123456.');
async function stop(){await app.close();await db.close();process.exit(0);}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
