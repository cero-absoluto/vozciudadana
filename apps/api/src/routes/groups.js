import { randomBytes, createHash } from 'node:crypto';
import { supabase } from '../services/supabase.js';
import { verifyCensusSession } from '../lib/censusSession.js';

const uuid = { type: 'string', format: 'uuid' };
const object = (properties, required=[]) => ({type:'object', properties, required, additionalProperties:false});
const params = object({id:uuid},['id']);
const groupSelect='id,name,protest_id,max_vouches_per_member';
const check = result => {if(result.error) throw result.error; return result.data;};
function session(req, protestId, required=true) {
  const header=req.headers.authorization;
  const token=typeof header==='string' && header.startsWith('Bearer ') ? header.slice(7) : null;
  const identity=verifyCensusSession(token,protestId);
  if ((!identity && required) || (header && !identity)) throw Object.assign(new Error('CENSUS_AUTH_REQUIRED'),{statusCode:401});
  return identity;
}
function safeError(error) {
  const code=String(error.message||'');
  const known=['CENSUS_UNAVAILABLE','CREATOR_PROOF_REQUIRED','CENSUS_EXISTS','FOUNDER_ADHESION_REQUIRED','CENSUS_NOT_FOUND','CENSUS_CLOSED','MEMBER_REQUIRED','INVITE_INVALID','VOUCH_LIMIT','INVITE_LIMIT','CANDIDATE_INVALID'];
  if(known.includes(code)) return Object.assign(new Error(code),{statusCode:code==='CENSUS_EXISTS'?409:403});
  return error;
}
async function group(id) {
  const data=check(await supabase.from('groups').select(groupSelect).eq('id',id).maybeSingle());
  if(!data) throw Object.assign(new Error('CENSUS_NOT_FOUND'),{statusCode:404});
  return data;
}
async function action(g,identity,type,extra={}) {
  const result=await supabase.rpc('census_group_action',{p_group_id:g.id,p_actor_hash:identity.emailHash,p_action:type,...extra});
  if(result.error) throw safeError(result.error);
  return result.data;
}
export default async function gruposRoutes(app) {
  app.post('/crear',{schema:{body:object({protest_id:uuid,name:{type:'string',minLength:1,maxLength:120},creator_key:{type:'string',pattern:'^[0-9a-f]{64}$'}},['protest_id','name','creator_key'])}},async(req,reply)=>{
    const identity=session(req,req.body.protest_id);
    const result=await supabase.rpc('found_census_group',{p_protest_id:req.body.protest_id,p_actor_hash:identity.emailHash,p_creator_key_hash:createHash('sha256').update(req.body.creator_key).digest('hex'),p_name:req.body.name});
    if(result.error)throw safeError(result.error);
    reply.header('Cache-Control','no-store');return reply.code(201).send(result.data);
  });
  app.post('/:id/solicitar',{schema:{params,body:object({invite_token:{type:'string',pattern:'^[0-9a-f]{64}$'}},['invite_token'])}},async(req,reply)=>{
    const g=await group(req.params.id),identity=session(req,g.protest_id);
    reply.header('Cache-Control','no-store');return action(g,identity,'request',{p_invite_token:req.body.invite_token,p_email_hint:identity.emailHint??null});
  });
  app.post('/:id/vouch',{schema:{params,body:object({candidate_id:uuid},['candidate_id'])}},async(req,reply)=>{
    const g=await group(req.params.id),identity=session(req,g.protest_id);
    reply.header('Cache-Control','no-store');return action(g,identity,'vouch',{p_candidate_id:req.body.candidate_id});
  });
  app.post('/:id/invite',{schema:{params,body:object({})}},async(req,reply)=>{
    const g=await group(req.params.id),identity=session(req,g.protest_id);
    const data=await action(g,identity,'invite',{p_invite_token:randomBytes(32).toString('hex')});
    reply.header('Cache-Control','no-store');return {token:data.token,url:`${process.env.FRONTEND_URL||'https://voiceprotest.org'}/#/invite/${data.token}`};
  });
  app.get('/:id/estado',{schema:{params,querystring:object({})}},async(req,reply)=>{
    const g=await group(req.params.id),identity=session(req,g.protest_id,false);
    const counts=await supabase.from('group_members').select('id',{count:'exact',head:true}).eq('group_id',g.id).not('accredited_at','is',null);
    if(counts.error)throw counts.error;
    const response={group:{id:g.id,name:g.name,protest_id:g.protest_id},acreditados:counts.count||0,pendientes:0,objetivo:30,mis_vouches_restantes:0,mis_invitaciones_restantes:0,mi_estado:{acreditado:false,es_genesis:false,vouches_dados:0},solicitudes:[],requires_auth:!identity};
    reply.header('Cache-Control','no-store');
    if(!identity)return response;
    const me=check(await supabase.from('group_members').select('id,is_genesis,vouches_given,vouches_received,invites_sent,accredited_at').eq('group_id',g.id).eq('email_hash',identity.emailHash).maybeSingle());
    if(!me)return response;
    response.mi_estado={acreditado:!!me.accredited_at,es_genesis:!!me.is_genesis,vouches_dados:me.vouches_given||0,vouches_recibidos:me.vouches_received||0};
    if(!me.accredited_at)return response;
    response.mis_invitaciones_restantes=Math.max(0,(me.is_genesis?20:10)-(me.invites_sent||0));
    response.mis_vouches_restantes=Math.max(0,g.max_vouches_per_member-(me.vouches_given||0));
    const pending=check(await supabase.from('vouch_requests').select('candidate_hash,candidate_email,requested_at').eq('group_id',g.id).eq('status','pending'))||[];
    if(pending.length){
      const hashes=pending.map(s=>s.candidate_hash);
      const candidates=check(await supabase.from('group_members').select('id,email_hash,vouches_received,accredited_at').eq('group_id',g.id).in('email_hash',hashes))||[];
      const votes=check(await supabase.from('vouches').select('candidate_hash').eq('group_id',g.id).eq('voucher_hash',identity.emailHash).in('candidate_hash',hashes))||[];
      const byHash=new Map(candidates.map(c=>[c.email_hash,c])),mine=new Set(votes.map(v=>v.candidate_hash));
      for(const s of pending){
        const candidate=byHash.get(s.candidate_hash);
        if(!candidate||candidate.accredited_at)continue;
        response.solicitudes.push({id:candidate.id,candidate_id:candidate.id,candidate_email:s.candidate_email||null,requested_at:s.requested_at,vouches_recibidos:candidate.vouches_received||0,ya_avalado:mine.has(s.candidate_hash)});
      }
    }
    response.pendientes=response.solicitudes.length;
    return response;
  });
  app.get('/invite/:token',{schema:{params:object({token:{type:'string',pattern:'^[0-9a-f]{64}$'}},['token'])}},async(req,reply)=>{
    const invite=check(await supabase.from('invite_links').select('group_id,used_at,expires_at').eq('token',req.params.token).maybeSingle());
    if(!invite||invite.used_at||!invite.expires_at||!Number.isFinite(Date.parse(invite.expires_at))||Date.parse(invite.expires_at)<=Date.now())return reply.code(410).send({error:'INVITE_INVALID'});
    const g=await group(invite.group_id);
    const p=check(await supabase.from('protests').select('convocatoria_institucion,convocatoria_region,ends_at').eq('id',g.protest_id).single());
    if(Date.parse(p.ends_at)<=Date.now())return reply.code(410).send({error:'INVITE_INVALID'});
    reply.header('Cache-Control','no-store');return {valid:true,group_id:g.id,protest_id:g.protest_id,institucion:p.convocatoria_institucion||'',region:p.convocatoria_region||''};
  });
  app.get('/convocatoria/:protestId',{schema:{params:object({protestId:uuid},['protestId'])}},async(req,reply)=>{
    const g=check(await supabase.from('groups').select('id,name').eq('protest_id',req.params.protestId).maybeSingle());
    if(!g)return reply.notFound('CENSUS_NOT_FOUND');return {group_id:g.id,name:g.name};
  });
}
