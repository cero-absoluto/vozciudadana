// Only source-controlled exact messages may cross the central error boundary.
const PUBLIC_MESSAGES = new Set([
  'Convocatoria no encontrada','Esta convocatoria no tiene verificación institucional','Invalid URL format.',
  'Protest not found','GPS coordinates out of range','Protest is still active — integrity data available after closure',
  'Código incorrecto o caducado','Demasiados intentos. Solicita un nuevo código.',
  'This email has already registered institutional membership for this convocatoria.',
  'INSTITUTIONAL_DOMAIN_INVALID','CENSUS_DOMAIN_REQUIRED','INSTITUTIONAL_DOMAIN_MISMATCH',
  'CENSUS_AUTH_REQUIRED','CENSUS_UNAVAILABLE','OTP_RATE_LIMITED','CENSUS_MEMBERSHIP_REQUIRED','CENSUS_VERIFICATION_FAILED',
  'CREATOR_PROOF_REQUIRED','CENSUS_EXISTS','FOUNDER_ADHESION_REQUIRED','CENSUS_NOT_FOUND','CENSUS_CLOSED',
  'MEMBER_REQUIRED','INVITE_INVALID','VOUCH_LIMIT','INVITE_LIMIT','CANDIDATE_INVALID',
]);
const STATUS_MESSAGES={400:'Bad request',401:'Unauthorized',403:'Forbidden',404:'Not found',409:'Conflict',410:'Gone',413:'Payload too large',415:'Unsupported media type',429:'Too many requests'};
export function safeErrorResponse(error) {
  const status=Number.isInteger(error?.statusCode) && error.statusCode>=400 && error.statusCode<=599?error.statusCode:500;
  const message=status>=500?'Internal server error':PUBLIC_MESSAGES.has(error?.message)?error.message:STATUS_MESSAGES[status]||'Request failed';
  return {status,body:{error:message}};
}
export function registerSafeErrorHandler(app) {
  app.setNotFoundHandler((request,reply)=>reply.header('Cache-Control','no-store').code(404).send({error:'Not found'}));
  app.setErrorHandler((error,request,reply)=>{
    const {status,body}=safeErrorResponse(error);
    request.log[status>=500?'error':'warn']({code:'request_error',statusCode:status});
    return reply.header('Cache-Control','no-store').code(status).send(body);
  });
}
