import { supabase } from '../services/supabase.js';

/** In-memory cache — loaded once on the first request and reused forever.
 *  Country codes are static reference data; they only change via migrations. */
let cache = null;

/** @param {import('fastify').FastifyInstance} app */
export default async function countryCodeRoutes(app) {
  // GET /api/country-codes
  app.get('/', async (_req, reply) => {
    if (!cache) {
      const { data, error } = await supabase
        .from('country_codes')
        .select('iso2, dial_code, flag, name')
        .order('name', { ascending: true });

      if (error) throw error;
      cache = data;
    }

    reply.header('Cache-Control', 'public, max-age=86400');
    return cache;
  });
}
