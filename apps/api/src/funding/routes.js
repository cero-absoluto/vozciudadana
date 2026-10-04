// Dependency-injected routes. Production server does not register this plugin.
export async function isolatedFundingRoutes(app, { service }) {
  const invoke = fn => async (req,reply) => {
    try { return await fn(req); }
    catch(err) { return reply.code(err.statusCode || 503).send({error:err.code || 'funding_operation_failed'}); }
  };
  const session = req => req.headers['x-funding-session'];
  const object = properties => ({ type:'object',properties,additionalProperties:false });
  app.post('/otp/start', {schema:{body:object({phone:{type:'string',maxLength:16},eventId:{type:['string','null'],format:'uuid'}})}},invoke(req=>service.start(req.body)));
  app.post('/otp/verify', {schema:{body:object({challengeId:{type:'string',format:'uuid'},code:{type:'string',pattern:'^\\d{6}$'}})}},invoke(req=>service.verify(req.body)));
  app.post('/intents', {schema:{body:object({kind:{enum:['event','general']},amountCents:{type:'integer',minimum:1,maximum:100000},currency:{const:'EUR'}})}},invoke(req=>service.intent(session(req),req.body)));
  app.get('/limits',invoke(req=>service.limits(session(req))));
  app.get('/public-summary',invoke(()=>service.summary()));
  app.post('/simulator/webhook', {schema:{body:object({eventRef:{type:'string',minLength:1,maxLength:128},intentId:{type:'string',format:'uuid'},amountCents:{type:'integer',minimum:1},currency:{type:'string',maxLength:3}})}},invoke(req=>service.webhook(req.body,req.headers['x-simulator-auth'])));
}
