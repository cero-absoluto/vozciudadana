import {randomUUID} from 'node:crypto';
import Fastify from 'fastify';

// No free-form messages, request/response objects, error objects or user identifiers.
const EVENTS = new Set(`recaptcha_rejected recaptcha_unavailable http_response request_error gps_token_failed gps_token_issued gps_geocode_completed gps_update_failed gps_update_completed viral_increment_failed indexnow_accepted indexnow_failed kofi_unconfigured kofi_over_limit kofi_target_unresolved kofi_target_missing otp_provider_max_attempts otp_network_rate_limited CENSUS_OTP_RETENTION_FAILED`.split(' '));
const METHODS = new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const GROUPS = new Set(['health','auth','participation','groups','funding','public','other']);
export function safeLogRecord(record) {
  const result={code:EVENTS.has(record?.code)?record.code:'application_event'};
  if(Number.isInteger(record?.statusCode) && record.statusCode>=100 && record.statusCode<=599)result.statusCode=record.statusCode;
  if(METHODS.has(record?.method))result.method=record.method;
  if(GROUPS.has(record?.routeGroup))result.routeGroup=record.routeGroup;
  return result;
}
export function privacyLoggerOptions(stream) {
  return {
    level:'info',base:null,...(stream?{stream}:{}),
    hooks:{
      logMethod(args,method){method.call(this,safeLogRecord(args[0]));},
      // Pino child bindings bypass the parent bindings formatter; enforce the contract at the final write too.
      streamWrite(line){
        try {const record=JSON.parse(line);const safe={level:[10,20,30,40,50,60].includes(record.level)?record.level:30,time:Number.isFinite(record.time)?record.time:Date.now(),...safeLogRecord(record)};
          if(typeof record.reqId==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.reqId))safe.reqId=record.reqId;
          return JSON.stringify(safe)+'\n';
        } catch {return JSON.stringify({level:50,time:Date.now(),code:'application_event'})+'\n';}
      },
    },
    formatters:{bindings(bindings){return typeof bindings.reqId==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bindings.reqId)?{reqId:bindings.reqId}:{};}},
  };
}
export function privacyFastifyOptions(stream) {
  return {logger:privacyLoggerOptions(stream),logController:new Fastify.LogController({disableRequestLogging:true}),requestIdHeader:false,genReqId:()=>randomUUID()};
}
function routeGroup(request) {
  const route=request.routeOptions?.url;
  if(typeof route!=='string')return 'other';
  if(route==='/health'||route==='/ready')return 'health';
  if(route.startsWith('/api/users')||route.startsWith('/api/institucional'))return 'auth';
  if((route.startsWith('/api/groups')||route.startsWith('/api/grupos')))return 'groups';
  if(route.startsWith('/api/webhooks'))return 'funding';
  if(route.startsWith('/api/protests') && /\/(join|adhesion)$/.test(route))return 'participation';
  if(route.startsWith('/api/public')||route.startsWith('/api/protests'))return 'public';
  return 'other';
}
export function registerPrivacyRequestLogging(app) {
  app.addHook('onResponse',async(request,reply)=>{
    request.log.info({code:'http_response',method:request.method,statusCode:reply.statusCode,routeGroup:routeGroup(request)});
  });
}
