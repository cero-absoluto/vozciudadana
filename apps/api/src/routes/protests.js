import { supabase } from '../services/supabase.js';

const VALID_SCOPES    = ['national', 'regional', 'global'];
const VALID_REGIONS   = ['region', 'provincia', 'ciudad', 'distrito', 'institucion'];
const VALID_RISK      = ['low', 'med', 'high', 'critical'];
const COUNTRY_RE      = /^[A-Z]{2}$/;

/** @param {import('fastify').FastifyInstance} app */
export default async function protestRoutes(app) {
  // GET /api/protests — list active protests (optionally filter by scope/country)
  app.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          scope:   { type: 'string', enum: VALID_SCOPES },
          country: { type: 'string', minLength: 2, maxLength: 2 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { scope, country } = req.query;

    let query = supabase
      .from('protests')
      .select('*')
      .gt('ends_at', new Date().toISOString())
      .order('heat', { ascending: false })
      .limit(100);

    if (scope)   query = query.eq('scope', scope);
    if (country) query = query.eq('country', country.toUpperCase());

    const { data, error } = await query;
    if (error) throw error;
    return data;
  });

  // GET /api/protests/:id
  app.get('/:id', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { data, error } = await supabase
      .from('protests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) return reply.notFound('Protest not found');
    return data;
  });

  // POST /api/protests — create a new protest
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['title', 'country_name', 'scope', 'duration_h'],
        properties: {
          title:        { type: 'string', minLength: 1, maxLength: 255 },
          description:  { type: 'string', maxLength: 5000 },
          demands:      { type: 'string', maxLength: 2000 },
          country:      { type: 'string', minLength: 2, maxLength: 2, nullable: true },
          country_name: { type: 'string', minLength: 1, maxLength: 120 },
          scope:        { type: 'string', enum: VALID_SCOPES },
          region:       { anyOf: [{ type: 'string', enum: VALID_REGIONS }, { type: 'null' }] },
          focal_point:  { type: 'string', maxLength: 500, nullable: true },
          category:     { type: 'string', maxLength: 120, nullable: true },
          duration_h:   { type: 'number', minimum: 0.5, maximum: 720 },
          starts_at:    { type: 'string', format: 'date-time', nullable: true },
          risk_level:   { type: 'string', enum: VALID_RISK },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { title, description, demands, country, country_name, scope, region,
            focal_point, category, duration_h, starts_at, risk_level } = req.body;

    const ends_at = new Date(
      new Date(starts_at ?? Date.now()).getTime() + duration_h * 3_600_000
    ).toISOString();

    const { data, error } = await supabase
      .from('protests')
      .insert({ title, description, demands,
                country: country ? country.toUpperCase() : null,
                country_name, scope, region: region ?? null,
                focal_point: focal_point ?? null,
                category: category ?? null,
                risk_level: risk_level ?? 'low',
                starts_at: starts_at ?? new Date().toISOString(),
                ends_at })
      .select()
      .single();

    if (error) throw error;
    return reply.code(201).send(data);
  });

  // POST /api/protests/:id/join — anonymous adhesion
  app.post('/:id/join', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['phone_hash', 'device_id', 'recaptcha_token'],
        properties: {
          phone_hash:      { type: 'string', minLength: 64, maxLength: 64 },
          doc_hash:        { type: 'string', minLength: 64, maxLength: 64, nullable: true },
          device_id:       { type: 'string', minLength: 8, maxLength: 128 },
          recaptcha_token: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { phone_hash, doc_hash, device_id, recaptcha_token } = req.body;

    await verifyRecaptcha(recaptcha_token, 'join_protest', reply);

    // Fetch protest metadata and idempotency check in parallel
    const [{ data: protest, error: protestErr }, { data: existing }] = await Promise.all([
      supabase.from('protests').select('scope, country').eq('id', req.params.id).maybeSingle(),
      supabase.from('adhesions').select('id').eq('protest_id', req.params.id).eq('device_id', device_id).maybeSingle(),
    ]);

    if (protestErr || !protest) return reply.notFound('Protest not found');
    if (existing) return reply.conflict('Device already joined this protest');

    // National protests: device country must match protest country
    if (protest.scope === 'national' && protest.country) {
      const { data: dev } = await supabase
        .from('devices')
        .select('country_code')
        .eq('id', device_id)
        .maybeSingle();

      if (!dev?.country_code || dev.country_code !== protest.country) {
        return reply.status(403).send({ code: 'NATIONAL_ONLY', error: 'protests country does not match device country' });
      }
    }

   const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
let ciudad = null, region = null, pais = null;
try {
  const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country&lang=es`);
  const geo = await geoRes.json();
  ciudad = geo.city || null;
  region = geo.regionName || null;
  pais = geo.country || null;
} catch { /* silencioso */ }
    const idioma = req.headers['accept-language']?.split(',')[0] || null;
    const { data, error } = await supabase
      .from('adhesions')
      .insert({ protest_id: req.params.id, phone_hash, doc_hash: doc_hash ?? null, device_id, ciudad, region, pais,idioma})
      .select()
      .single();

    if (error) throw error;

    const { error: rpcErr } = await supabase.rpc('increment_protest_count', { protest_id: req.params.id });
    await supabase.rpc('update_cities_count', { protest_id: req.params.id });
    if (rpcErr) req.log.error({ rpcErr }, 'increment_protest_count failed');

    return reply.code(201).send({ receipt: data.id });
  });

  // POST /api/protests/:id/viral — record a share
  app.post('/:id/viral', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { error } = await supabase.rpc('increment_viral_count', { protest_id: req.params.id });
    if (error) req.log.error({ error }, 'increment_viral_count failed');
    return { ok: true };
  });
  // GET /api/protests/:id/informe — datos para el informe público
app.get('/:id/informe', {
  schema: {
    params: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
    },
  },
}, async (req, reply) => {
  const { data: protest, error } = await supabase
    .from('protests')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return reply.notFound('Convocatoria no encontrada');

  const { data: adhesions } = await supabase
    .from('adhesions')
    .select('ciudad, region, pais, idioma, created_at')
    .eq('protest_id', req.params.id);

  const ciudades = [...new Set(adhesions.map(a => a.ciudad).filter(Boolean))];
  const paises = [...new Set(adhesions.map(a => a.pais).filter(Boolean))];
  const idiomas = [...new Set(adhesions.map(a => a.idioma).filter(Boolean))];
  // Distribución por región
const distribucion_regiones = adhesions.reduce((acc, a) => {
  if (a.region) acc[a.region] = (acc[a.region] || 0) + 1;
  return acc;
}, {});

  return {
    protest,
    total_adhesiones: protest.count,
    ciudades_distintas: ciudades.length,
    paises_distintos: paises.length,
    idiomas_distintos: idiomas.length,
    distribucion_paises: paises,
    distribucion_ciudades: ciudades,
    distribucion_regiones,
    primera_adhesion: adhesions[0]?.created_at || null,
    ultima_adhesion: adhesions[adhesions.length - 1]?.created_at || null,
  };
});
}

/**
 * Verify a reCAPTCHA v3 token server-side.
 * Throws a 400 error if the token is missing or the score is too low.
 * @param {string} token
 * @param {string} expectedAction
 * @param {import('fastify').FastifyReply} reply
 */
async function verifyRecaptcha(token, expectedAction, reply) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return; // Skip in dev when secret is not configured

  const res = await fetch(
    `https://www.google.com/recaptcha/api/siteverify?secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    { method: 'POST' }
  );
  const json = await res.json();

  if (!json.success || json.score < 0.5) {
    reply.badRequest('reCAPTCHA verification failed');
    throw new Error('recaptcha');
  }
}
