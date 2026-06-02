import { supabase } from '../services/supabase.js';

export default async function publicRoutes(app) {

  // GET /api/public/stats — global platform statistics
  app.get('/stats', async (req, reply) => {
    const now = new Date().toISOString();

    const [
      { count: total_protests },
      { count: active_protests },
      { count: closed_protests },
      { data: adhesions },
      { data: countries },
    ] = await Promise.all([
      supabase.from('protests').select('*', { count: 'exact', head: true }),
      supabase.from('protests').select('*', { count: 'exact', head: true }).gte('ends_at', now),
      supabase.from('protests').select('*', { count: 'exact', head: true }).lt('ends_at', now),
      supabase.from('protests').select('count, scope, country_name'),
      supabase.from('protests').select('country_name').gte('ends_at', now),
    ]);

    const total_adhesions = (adhesions || []).reduce((s, p) => s + (p.count || 0), 0);
    const by_scope = (adhesions || []).reduce((acc, p) => {
      acc[p.scope] = (acc[p.scope] || 0) + 1;
      return acc;
    }, {});
    const active_countries = [...new Set((countries || []).map(p => p.country_name).filter(Boolean))];

    return {
      generated_at: new Date().toISOString(),
      platform: 'Voice Protest',
      version: '1.0',
      source: 'https://github.com/cero-absoluto/vozciudadana',
      license: 'AGPL 3.0',
      data: {
        total_protests:    total_protests || 0,
        active_protests:   active_protests || 0,
        closed_protests:   closed_protests || 0,
        total_adhesions,
        active_countries:  active_countries.length,
        active_countries_list: active_countries.sort(),
        by_scope,
      },
    };
  });

  // GET /api/public/protests — all protests with aggregated data
  app.get('/protests', async (req, reply) => {
    const { scope, country, status = 'active' } = req.query;
    const now = new Date().toISOString();

    let query = supabase
      .from('protests')
      .select('id, title, description, scope, country, country_name, region, count, cities_count, starts_at, ends_at, focal_point, category, tipo_abuso, donaciones_total')
      .order('starts_at', { ascending: false })
      .limit(500);

    if (status === 'active')  query = query.gte('ends_at', now);
    if (status === 'closed')  query = query.lt('ends_at', now);
    if (scope)                query = query.eq('scope', scope);
    if (country)              query = query.eq('country', country.toUpperCase());

    const { data, error } = await query;
    if (error) throw error;

    return {
      generated_at: new Date().toISOString(),
      total: (data || []).length,
      filters: { status, scope: scope || null, country: country || null },
      protests: (data || []).map(p => ({
        id:              p.id,
        title:           p.title,
        description:     p.description,
        scope:           p.scope,
        country:         p.country,
        country_name:    p.country_name,
        region:          p.region,
        focal_point:     p.focal_point,
        category:        p.category,
        abuse_type:      p.tipo_abuso,
        adhesions:       p.count || 0,
        cities:          p.cities_count || 0,
        starts_at:       p.starts_at,
        ends_at:         p.ends_at,
        status:          new Date(p.ends_at) > new Date() ? 'active' : 'closed',
        funding_total:   p.donaciones_total || 0,
      })),
    };
  });

  // GET /api/public/protests/:id — full data for a single protest
  app.get('/protests/:id', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { data: p, error } = await supabase
      .from('protests')
      .select('id, title, description, demands, scope, country, country_name, region, count, cities_count, starts_at, ends_at, focal_point, category, tipo_abuso, hash_integridad, saldo_euros, donaciones_count, donaciones_total, ultima_donacion')
      .eq('id', req.params.id)
      .single();

    if (error || !p) return reply.notFound('Protest not found');

    // Get adhesions breakdown from informe endpoint data
    const { data: adhesions } = await supabase
      .from('adhesions')
      .select('fiabilidad, ciudad, region, pais, created_at')
      .eq('protest_id', req.params.id);

    const total = (adhesions || []).length;
    const cities = [...new Set((adhesions || []).map(a => a.ciudad).filter(Boolean))];
    const regions = (adhesions || []).reduce((acc, a) => {
      if (a.region) acc[a.region] = (acc[a.region] || 0) + 1;
      return acc;
    }, {});

    const reliability = (adhesions || []).reduce((acc, a) => {
      const f = a.fiabilidad || 0;
      if (f >= 85)      acc.high++;
      else if (f >= 75) acc.medium++;
      else if (f >= 60) acc.base++;
      else              acc.unclassified++;
      return acc;
    }, { high: 0, medium: 0, base: 0, unclassified: 0 });

    return {
      generated_at:  new Date().toISOString(),
      id:            p.id,
      title:         p.title,
      description:   p.description,
      demands:       p.demands,
      scope:         p.scope,
      country:       p.country,
      country_name:  p.country_name,
      region:        p.region,
      focal_point:   p.focal_point,
      category:      p.category,
      abuse_type:    p.tipo_abuso,
      starts_at:     p.starts_at,
      ends_at:       p.ends_at,
      status:        new Date(p.ends_at) > new Date() ? 'active' : 'closed',
      integrity_hash: p.hash_integridad || null,
      stats: {
        total_adhesions: total,
        cities:          cities.length,
        top_cities:      cities.slice(0, 20),
        by_region:       regions,
        reliability,
        funding: {
          total_donations:  p.donaciones_count || 0,
          total_funded:     p.donaciones_total || 0,
          last_donation:    p.ultima_donacion || null,
        },
      },
      embed_code: `<script src="https://cero-absoluto.github.io/vozciudadana/widget.js?id=${p.id}"></script>`,
      report_url: `https://cero-absoluto.github.io/vozciudadana/#/informe/${p.id}`,
    };
  });

}
