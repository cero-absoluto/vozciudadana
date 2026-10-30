// H7 — elegibilidad nacional con país DERIVADO en el servidor. Sin red, sin Supabase, sin Twilio, sin SMS, sin producción.
// Datos sintéticos. Ejecutar: node --experimental-test-module-mocks --test tests/national-country-derived.mjs
// Recorre el código real de routes/users.js, routes/protests.js y lib/adhesionService.js con la base y Twilio simulados.
// No prueba: Twilio real, la base real (la migración se prueba aparte en tests/devices-numbering-migration.mjs), el cliente web.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.PHONE_HASH_SECRET = 'test-phone-secret';
process.env.NULLIFIER_SECRET = 'test-nullifier-secret';
process.env.PARTICIPATION_TOKEN_SECRET = 'test-token-secret';
process.env.DEVICE_SECRET_PEPPER = 'test-pepper';
process.env.SUPABASE_URL = 'http://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
delete process.env.RECAPTCHA_SECRET;
delete process.env.NODE_ENV;

const P = (n) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const PROTESTS = {
  [P(1)]: { id: P(1), scope: 'national', country: 'ES' },
  [P(2)]: { id: P(2), scope: 'national', country: 'CA' },
  [P(3)]: { id: P(3), scope: 'national', country: 'UY' },
  [P(4)]: { id: P(4), scope: 'global', country: null },
  [P(5)]: { id: P(5), scope: 'local', country: 'ES', convocatoria_osm_id: 1, convocatoria_ciudad_nombre: 'X' },
  [P(6)]: { id: P(6), scope: 'regional', country: 'ES', convocatoria_osm_id: 2, convocatoria_ciudad_nombre: 'Y' },
  [P(7)]: { id: P(7), scope: 'national', country: 'US' },
  [P(8)]: { id: P(8), scope: 'national', country: 'IT' },
  [P(9)]: { id: P(9), scope: 'national', country: 'GB' },
};
const NAT_ES = P(1), NAT_CA = P(2), NAT_UY = P(3), GLOBAL = P(4), LOCAL = P(5), REGIONAL = P(6), NAT_US = P(7), NAT_IT = P(8), NAT_GB = P(9);

const PH = { ES: '+34600000001', FR: '+33600000002', FR2: '+33600000003', CA: '+14165550123', US: '+12015550123', UY: '+59899123456', NONE: '+99912345678',
  // plan compartido, rango que los metadatos asignan a UN territorio
  GB: '+447400123456', JE: '+447797712345', VA: '+3906698212345',
  // plan compartido, rango validado por varios territorios (R-N2 lo deja sin resolver)
  IT_MOBILE: '+393123456789', TOLLFREE: '+18002345678', NO_MOBILE: '+4791234567' };
const OTP = '123456';
const hashPhone = (p) => createHmac('sha256', process.env.PHONE_HASH_SECRET).update(p).digest('hex');

const db = { devices: new Map(), adhesions: [] };
const calls = { verifyOtp: 0, sendOtp: 0, adhesionReads: 0, otpLog: 0 };
const protestFor = (id) => (PROTESTS[id] ? { saldo_euros: null, convocatoria_osm_id: null, convocatoria_ciudad_nombre: null, ...PROTESTS[id] } : null);

function exec(st) {
  const { table, op, filters, payload } = st;
  let data = null; let error = null;
  if (table === 'adhesions' && op === 'select') calls.adhesionReads++;
  if (table === 'otp_requests' && op === 'insert') calls.otpLog++;
  if (table === 'devices') {
    const find = () => [...db.devices.values()].find(d => Object.entries(filters).every(([k, v]) => d[k] === v)) ?? null;
    if (op === 'insert') { if(db.devices.has(payload.id) || [...db.devices.values()].some(d=>d.phone_hash===payload.phone_hash)) return Promise.resolve({data:null,error:{code:'23505'}}); db.devices.set(payload.id, { ...(db.devices.get(payload.id) ?? {}), ...payload }); data = db.devices.get(payload.id); }
    else if (op === 'update') { const row = find(); if (row) Object.assign(row, payload); }
    else if (op === 'select') data = find();
  } else if (table === 'protests' && op === 'select') data = protestFor(filters.id);
  return Promise.resolve({ data, error });
}
const from = (table) => {
  const st = { table, op: 'select', filters: {}, payload: null };
  const b = {
    select: () => b, is: () => b, order: () => b, limit: () => b,
    upsert: (p) => { st.op = 'upsert'; st.payload = p; return b; },
    update: (p) => { st.op = 'update'; st.payload = p; return b; },
    insert: (p) => { st.op = 'insert'; st.payload = p; return b; },
    eq: (k, v) => { st.filters[k] = v; return b; },
    maybeSingle: () => exec(st), single: () => exec(st),
    then: (res, rej) => exec(st).then(res, rej),
  };
  return b;
};
const rpc = async (name, args) => {
  if(name==='reserve_sms_otp'){calls.otpLog++;return {data:{allowed:true,request_id:'11111111-1111-4111-8111-111111111111'},error:null};}
  if (name === 'get_otp_cooldown') return { data: 0, error: null };
  if (name === 'check_otp_rate_limit') return { data: { allowed: true }, error: null };
  if (name === 'create_verified_adhesion') { db.adhesions.push(args); return { data: { id: 'adh-1', created_at: '2026-01-01T00:00:00Z', ciudad: null, region: null, pais: null, adhesion_osm_id: null }, error: null }; }
  return { data: null, error: null };
};
mock.module('../apps/api/src/services/supabase.js', { namedExports: { supabase: { from, rpc:(...args)=>Object.assign(rpc(...args),{abortSignal(){return this;}}) } } });
mock.module('../apps/api/src/services/twilio.js', { namedExports: {
  sendOtp: async () => { calls.sendOtp++; },
  verifyOtp: async (_p, code) => { calls.verifyOtp++; return code === OTP; },
} });
globalThis.fetch = async () => { throw new Error('no network in tests'); };

const { generateDeviceSecret } = await import('../apps/api/src/lib/participationToken.js');
const { default: Fastify } = await import('fastify');
const sensible = (await import('@fastify/sensible')).default;
const { default: userRoutes } = await import('../apps/api/src/routes/users.js');
const { default: protestRoutes } = await import('../apps/api/src/routes/protests.js');
const app = Fastify();
await app.register(sensible);
await app.register(userRoutes, { prefix: '/api/users' });
await app.register(protestRoutes, { prefix: '/api/protests' });
await app.ready();

const verify = (phone, deviceId, declared) => app.inject({ method: 'POST', url: '/api/users/verify-otp',
  payload: { phone, otp: OTP, device_id: deviceId, ...(declared ? { country_code: declared } : {}) } });
const join = (protestId, token) => app.inject({ method: 'POST', url: `/api/protests/${protestId}/join`,
  payload: { participation_token: token, recaptcha_token: 'dev' } });
const reauth = (deviceId, secret) => app.inject({ method: 'POST', url: `/api/users/device/${deviceId}/reauth`, payload: { device_secret: secret } });
const body = (r) => r.json();
function legacyDevice(id, phone, declared) { // verificado ANTES de la derivación: sin procedencia
  const { secret, hash } = generateDeviceSecret();
  db.devices.set(id, { id, phone_hash: hashPhone(phone), verified_at: '2026-01-01T00:00:00Z', country_code: declared, device_secret_hash: hash });
  return secret;
}

test.beforeEach(() => { db.devices.clear(); db.adhesions.length = 0; calls.verifyOtp = 0; calls.sendOtp = 0; calls.adhesionReads = 0; calls.otpLog = 0; });

test('1. número ES entra en la nacional de España aunque declare otro país o ninguno (la declaración no concede ni quita)', async () => {
  for (const [i, declared] of ['FR', null, 'ES'].entries()) {
    db.adhesions.length = 0;
    const v = body(await verify(PH.ES, `device-es-000${i}`, declared));
    const row = db.devices.get(`device-es-000${i}`);
    assert.equal(row.numbering_country, 'ES');
    assert.equal(row.numbering_resolution, 'resolved_unshared');
    assert.match(row.numbering_meta_version, /^libphonenumber-js@1\.12\.10\/max;R-N2$/);
    const r = await join(NAT_ES, v.participation_token);
    assert.equal(r.statusCode, 201, `declarado=${declared}`);
    assert.equal(db.adhesions.length, 1);
    db.devices.clear();
  }
});

test('2. H7 cerrado: número FR que DECLARA ES (y FR que declara FR) es rechazado NATIONAL_ONLY; no se crea adhesión', async () => {
  for (const declared of ['ES', 'FR']) {
    const v = body(await verify(PH.FR, `device-fr-${declared}`, declared));
    const r = await join(NAT_ES, v.participation_token);
    assert.equal(r.statusCode, 403);
    assert.equal(body(r).code, 'NATIONAL_ONLY');
    db.devices.clear();
  }
  assert.equal(db.adhesions.length, 0);
});

test('3. la fuente es la numeración, no la tabla country_codes: número UY (fuera de la tabla) entra en una nacional de UY', async () => {
  const v = body(await verify(PH.UY, 'device-uy-0001', 'ES'));
  assert.equal(db.devices.get('device-uy-0001').numbering_country, 'UY');
  assert.equal((await join(NAT_UY, v.participation_token)).statusCode, 201);
});

test('4. plan compartido, número IDENTIFICABLE: se resuelve con el número completo y se compara con la convocatoria (la declaración no cuenta)', async () => {
  // [número, declarado, convocatoria, estado esperado, código esperado]
  const cases = [
    [PH.CA, 'US', NAT_CA, 201], [PH.CA, 'CA', NAT_CA, 201], [PH.US, 'CA', NAT_US, 201], [PH.US, 'US', NAT_US, 201],
    [PH.GB, 'IT', NAT_GB, 201], [PH.VA, 'IT', NAT_GB, 403, 'NATIONAL_ONLY'],   // VA no es IT ni GB: se compara el país resuelto
    [PH.CA, 'US', NAT_US, 403, 'NATIONAL_ONLY'], [PH.US, 'CA', NAT_CA, 403, 'NATIONAL_ONLY'], // +1 de otro país: derivado ≠ convocatoria
    [PH.JE, 'GB', NAT_GB, 403, 'NATIONAL_ONLY'],                                // Jersey resuelto a JE, no a GB
  ];
  for (const [phone, declared, protest, status, code] of cases) {
    const id = `device-${phone.slice(1)}-${protest.slice(-1)}`;
    const v = body(await verify(phone, id, declared));
    assert.equal(db.devices.get(id).numbering_resolution, 'resolved_shared_unique', phone);
    assert.ok(db.devices.get(id).numbering_country, phone);
    const r = await join(protest, v.participation_token);
    assert.equal(r.statusCode, status, `${phone} declara ${declared} en ${PROTESTS[protest].country}`);
    if (code) assert.equal(body(r).code, code);
    db.devices.clear();
  }
});

test('4b. plan compartido, rango ambiguo: no se registra adhesión nacional, con código propio y sin atribuir otro país, declare lo que declare', async () => {
  for (const [phone, protest, declared] of [[PH.IT_MOBILE, NAT_IT, 'IT'], [PH.IT_MOBILE, NAT_IT, 'VA'], [PH.IT_MOBILE, NAT_ES, 'ES'], [PH.TOLLFREE, NAT_US, 'US'], [PH.TOLLFREE, NAT_CA, 'CA'], [PH.NO_MOBILE, NAT_ES, 'ES']]) {
    const v = body(await verify(phone, `device-${phone.slice(1)}-${declared}`, declared));
    const row = db.devices.get(`device-${phone.slice(1)}-${declared}`);
    assert.equal(row.numbering_resolution, 'shared_calling_code');
    assert.equal(row.numbering_country, null, 'no se atribuye país derivado');
    const r = await join(protest, v.participation_token);
    assert.equal(r.statusCode, 403);
    assert.equal(body(r).code, 'NATIONAL_COUNTRY_SHARED_CODE');
    assert.notEqual(body(r).code, 'NATIONAL_ONLY', 'no se afirma que sea de otro país');
    assert.match(body(r).error, /does not mean the number belongs to another country/);
    db.devices.clear();
  }
  assert.equal(db.adhesions.length, 0);
});

test('5. rango ambiguo de plan compartido y número sin resolver son resultados DISTINTOS (no se equiparan)', async () => {
  const a = body(await verify(PH.IT_MOBILE, 'device-shared-1', 'IT'));
  const b = body(await verify(PH.NONE, 'device-none-0001', 'ES'));
  assert.equal(db.devices.get('device-shared-1').numbering_resolution, 'shared_calling_code');
  assert.equal(db.devices.get('device-none-0001').numbering_resolution, 'no_result');
  const ra = await join(NAT_ES, a.participation_token);
  const rb = await join(NAT_ES, b.participation_token);
  assert.equal(body(ra).code, 'NATIONAL_COUNTRY_SHARED_CODE');
  assert.equal(body(rb).code, 'NATIONAL_COUNTRY_UNRESOLVED');
  assert.match(body(rb).error, /does not mean the number belongs to another country/);
});

test('6. global, local y regional no cambian: FR, rango ambiguo y sin resolver siguen pudiendo adherirse', async () => {
  for (const phone of [PH.FR, PH.IT_MOBILE, PH.TOLLFREE, PH.NONE]) {
    const v = body(await verify(phone, `device-${phone.slice(1)}`, 'ES'));
    for (const protest of [GLOBAL, LOCAL, REGIONAL]) {
      const r = await join(protest, v.participation_token);
      assert.equal(r.statusCode, 201, `${phone} en ${PROTESTS[protest].scope}`);
    }
    db.devices.clear();
  }
});

test('6b. FR→ES sigue bloqueado y el cliente no decide: número FR declarando ES, IT, GB o VA nunca entra en una nacional ajena', async () => {
  for (const declared of ['ES', 'IT', 'GB', 'VA', 'FR']) {
    const v = body(await verify(PH.FR, `device-fr-d-${declared}`, declared));
    for (const protest of [NAT_ES, NAT_IT, NAT_GB]) assert.equal(body(await join(protest, v.participation_token)).code, 'NATIONAL_ONLY', `declara ${declared}`);
    db.devices.clear();
  }
  assert.equal(db.adhesions.length, 0);
});

test('6c. aviso ANTES del SMS (request-otp): país no establecido en convocatoria nacional => 403 sin SMS, sin registro y sin consultar participación', async () => {
  const req = (phone, protest) => app.inject({ method: 'POST', url: '/api/users/request-otp',
    payload: { phone, recaptcha_token: 'dev', device_id: 'device-presms-1', ...(protest ? { protest_id: protest } : {}) } });
  for (const [phone, protest, code] of [[PH.IT_MOBILE, NAT_IT, 'NATIONAL_COUNTRY_SHARED_CODE'], [PH.TOLLFREE, NAT_US, 'NATIONAL_COUNTRY_SHARED_CODE'], [PH.NONE, NAT_ES, 'NATIONAL_COUNTRY_UNRESOLVED']]) {
    const r = await req(phone, protest);
    assert.equal(r.statusCode, 403); assert.equal(body(r).code, code);
    assert.match(body(r).error, /does not mean the number belongs to another country/);
  }
  assert.equal(calls.sendOtp, 0, 'ningún SMS'); assert.equal(calls.otpLog, 0, 'nada registrado'); assert.equal(calls.adhesionReads, 0, 'no consulta participación: no revela nada de ella');
  // siguen enviándose: resuelto (incluso plan compartido), distinto país (decide /join), global, sin convocatoria, convocatoria desconocida
  for (const [phone, protest] of [[PH.ES, NAT_ES], [PH.CA, NAT_CA], [PH.GB, NAT_GB], [PH.FR, NAT_ES], [PH.IT_MOBILE, GLOBAL], [PH.NONE, LOCAL], [PH.IT_MOBILE, null], [PH.IT_MOBILE, P(99)]]) {
    const before = calls.sendOtp;
    const r = await req(phone, protest);
    assert.equal(r.statusCode, protest===P(99)?404:200, `${phone} ${protest}`);
    if(protest!==P(99)) assert.equal(body(r).sent,true);
    assert.equal(calls.sendOtp, before + (protest===P(99)?0:1));
  }
});

test('7. dispositivo existente (legado, sin procedencia): entra por reauth, pero la nacional exige nueva verificación; global no', async () => {
  const secret = legacyDevice('device-legacy-1', PH.ES, 'ES');
  const ra = body(await reauth('device-legacy-1', secret));
  assert.equal(ra.authenticated, true);
  const natural = await join(NAT_ES, ra.participation_token);
  assert.equal(natural.statusCode, 403);
  assert.equal(body(natural).code, 'NATIONAL_REVERIFICATION_REQUIRED');
  assert.equal((await join(GLOBAL, ra.participation_token)).statusCode, 201, 'el legado sigue funcionando fuera de lo nacional');
  assert.equal(calls.verifyOtp, 0, 'la reautenticación no usa OTP');
});

test('8. nueva verificación del MISMO número otorga procedencia a la fila existente (mismo device_id, la declaración no la pisa)', async () => {
  legacyDevice('device-legacy-2', PH.ES, 'FR'); // el legado declaró FR para un número español
  const v = body(await verify(PH.ES, 'device-other-browser-1', 'FR'));
  assert.equal(v.device_id, 'device-legacy-2', 'se reutiliza la fila existente');
  const row = db.devices.get('device-legacy-2');
  assert.equal(row.numbering_country, 'ES');
  assert.equal(row.country_code, 'FR', 'el valor declarado queda como dato informativo, sin tocar');
  assert.equal((await join(NAT_ES, v.participation_token)).statusCode, 201);
});

test('9. legado FR que declaró ES: tras reverificar se rechaza (derivado FR)', async () => {
  legacyDevice('device-legacy-3', PH.FR, 'ES');
  const v = body(await verify(PH.FR, 'device-other-browser-2', 'ES'));
  assert.equal(db.devices.get('device-legacy-3').numbering_country, 'FR');
  const r = await join(NAT_ES, v.participation_token);
  assert.equal(r.statusCode, 403);
  assert.equal(body(r).code, 'NATIONAL_ONLY');
});

test('10. reautenticación de un dispositivo CON procedencia: entra en la nacional sin nuevo OTP', async () => {
  const v = body(await verify(PH.ES, 'device-prov-0001', 'ES'));
  assert.ok(v.device_secret);
  const otpAfterVerify = calls.verifyOtp;
  const ra = body(await reauth('device-prov-0001', v.device_secret));
  assert.equal((await join(NAT_ES, ra.participation_token)).statusCode, 201);
  assert.equal(calls.verifyOtp, otpAfterVerify, 'sin OTP en la reautenticación');
});

test('11. mismo device_id con otro número: nueva identidad sin sobrescribir la anterior', async () => {
  await verify(PH.FR, 'device-same-0001', 'FR');
  assert.equal(db.devices.get('device-same-0001').numbering_country, 'FR');
  const v2 = body(await verify(PH.ES, 'device-same-0001', 'FR')); // otro número, mismo device_id
  assert.equal(db.devices.get('device-same-0001').numbering_country, 'FR');
  assert.notEqual(v2.device_id,'device-same-0001');
  const row = db.devices.get(v2.device_id);
  assert.equal(row.numbering_country, 'ES');
  assert.equal((await join(NAT_ES, v2.participation_token)).statusCode, 201);
});

test('12. otros métodos no se tocan: el método institucional no pasa por esta comprobación nacional', async () => {
  const { createVerifiedAdhesion } = await import('../apps/api/src/lib/adhesionService.js');
  await assert.doesNotReject(createVerifiedAdhesion({
    protestId: NAT_ES,
    identity: { subjectHash: 'e'.repeat(64), method: 'institutional_email_otp', deviceId: null, numbering: null, institutionalDomain: null },
    location: {}, documentHash: null, institutionalMembership: null,
  }));
});
test('IDV institutional email is required even without a census', async () => {
  const id=P(20);PROTESTS[id]={id,scope:'local',country:'ES',dominio_email:'university.invalid',requiere_censo:false};
  const v=body(await verify(PH.ES,'device-idv-institution'));
  const before=db.adhesions.length;
  const response=await join(id,v.participation_token);
  assert.equal(response.statusCode,403);assert.equal(body(response).code,'INSTITUTIONAL_VERIFICATION_REQUIRED');assert.equal(db.adhesions.length,before);
});
test('IDV high and critical risk ignore supplied GPS before any provider call', async () => {
 const {createVerifiedAdhesion}=await import('../apps/api/src/lib/adhesionService.js');
 for (const risk of ['high','critical']) {
  const id=P(risk==='high'?21:22);PROTESTS[id]={id,scope:'local',country:'ES',risk_level:risk};
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unexpected network');};
  await createVerifiedAdhesion({protestId:id,identity:{subjectHash:'a'.repeat(64),method:'phone_otp'},location:{latitude:43,longitude:-3}});
  assert.equal(calls,0);assert.equal(db.adhesions.at(-1).p_gps_confirmed,false);assert.equal(db.adhesions.at(-1).p_senales,'sim');
 }
});

test('IDV-01 institutional request-otp rejects before SMS, quota reservation and participation lookup',async()=>{
 const id=P(23);PROTESTS[id]={id,scope:'local',dominio_email:'synthetic.invalid',requiere_censo:false};
 const r=await app.inject({method:'POST',url:'/api/users/request-otp',payload:{phone:PH.ES,device_id:'device-idv-request',protest_id:id,recaptcha_token:'dev'}});
 assert.equal(r.statusCode,403);assert.equal(r.json().code,'INSTITUTIONAL_VERIFICATION_REQUIRED');
 assert.equal(calls.sendOtp,0);assert.equal(calls.otpLog,0);assert.equal(calls.adhesionReads,0);
});
test('IDV-02 join succeeds without issuing a GPS reinforcement token at high or critical risk',async()=>{
 for(const risk of ['high','critical']){
  const id=P(risk==='high'?24:25);PROTESTS[id]={id,scope:'local',country:'ES',risk_level:risk};
  const v=body(await verify(PH.ES,'device-idv-'+risk));const response=await join(id,v.participation_token);
  assert.equal(response.statusCode,201);assert.equal(response.json().gps_update_token,null);
 }
});

test('IDV-04 actual admission persists only the geographic signals obtained',async()=>{
 const {createVerifiedAdhesion}=await import('../apps/api/src/lib/adhesionService.js');
 const originalFetch=globalThis.fetch;
 try {
  for(const scenario of ['gps','ip','none']) {
   let fetched=0;
   globalThis.fetch=async url=>{fetched++;return scenario==='none'?{ok:false,json:async()=>({country_code:'ES'})}:String(url).includes('nominatim')?{ok:true,json:async()=>({osm_id:123,address:{city:'Synthetic',country_code:'es'}})}:{ok:true,json:async()=>({city:'Synthetic IP',country_code:'ES'})};};
   await createVerifiedAdhesion({protestId:GLOBAL,identity:{subjectHash:'b'.repeat(64),method:'phone_otp'},location:{...(scenario==='gps'?{latitude:40,longitude:-3}:{}),ip:'8.8.8.8'}});
   const row=db.adhesions.at(-1);assert.equal(row.p_senales,scenario==='gps'?'gps,sim':scenario==='ip'?'sim,ip':'sim');assert.equal(row.p_fiabilidad,scenario==='gps'?92:scenario==='ip'?85:75);assert.equal(fetched,1);
  }
 }finally{globalThis.fetch=originalFetch;}
});
