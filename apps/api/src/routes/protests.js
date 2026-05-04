import { supabase } from '../services/supabase.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function protestRoutes(app) {
  // GET /api/protests — list active protests (optionally filter by scope/country)
  app.get('/', async (req, reply) => {
    const { scope, country } = req.query;

    let query = supabase
      .from('protests')
      .select('*')
      .gt('ends_at', new Date().toISOString())
      .order('heat', { ascending: false });

    if (scope)   query = query.eq('scope', scope);
    if (country) query = query.eq('country', country);

    const { data, error } = await query;
    if (error) return reply.internalServerError(error.message);
    return data;
  });

  // GET /api/protests/:id
  app.get('/:id', async (req, reply) => {
    const { data, error } = await supabase
      .from('protests')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) return reply.notFound('Protest not found');
    return data;
  });

  // POST /api/protests — create a new protest
  app.post('/', async (req, reply) => {
    const { title, description, demands, country, country_name, scope, region,
            focal_point, category, duration_h, starts_at, risk_level } = req.body;

    const ends_at = new Date(
      new Date(starts_at || Date.now()).getTime() + duration_h * 3_600_000
    ).toISOString();

    const { data, error } = await supabase
      .from('protests')
      .insert({ title, description, demands, country, country_name, scope,
                region, focal_point, category, risk_level, starts_at, ends_at })
      .select()
      .single();

    if (error) return reply.internalServerError(error.message);
    return reply.code(201).send(data);
  });

  // POST /api/protests/:id/join — anonymous adhesion
  app.post('/:id/join', async (req, reply) => {
    const { phone_hash, doc_hash, device_id, recaptcha_token } = req.body;

    // Idempotency: one device per protest
    const { data: existing } = await supabase
      .from('adhesions')
      .select('id')
      .eq('protest_id', req.params.id)
      .eq('device_id', device_id)
      .maybeSingle();

    if (existing) return reply.conflict('Device already joined this protest');

    const { data, error } = await supabase
      .from('adhesions')
      .insert({ protest_id: req.params.id, phone_hash, doc_hash, device_id })
      .select()
      .single();

    if (error) return reply.internalServerError(error.message);

    // Increment counter (handled by DB trigger in production)
    await supabase.rpc('increment_protest_count', { protest_id: req.params.id });

    return reply.code(201).send({ receipt: data.id });
  });

  // POST /api/protests/:id/viral — record a share
  app.post('/:id/viral', async (req, reply) => {
    await supabase.rpc('increment_viral_count', { protest_id: req.params.id });
    return { ok: true };
  });
}
