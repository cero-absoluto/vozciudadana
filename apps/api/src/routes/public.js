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
      .eq('protest_id', req.params.id)
      .is('deleted_at', null);

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
      integrity_hash:           p.hash_integridad || null,
      integrity_version:        p.integrity_version || 1,
      integrity_calculated_at:  p.integrity_calculated_at || null,
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
      embed_code: `<script src="https://voiceprotest.org/widget.js?id=${p.id}"></script>`,
      report_url: `https://voiceprotest.org/#/informe/${p.id}`,
    };
  });

  // GET /api/public/protests/:id/integrity-data
  // Returns all data needed for independent public verification of the integrity hash.
  // public_commitments = SHA256(protest_id + nullifier) — unique per adhesion and protest.
  // Does not reveal phone numbers or allow cross-protest correlation.
  app.get('/protests/:id/integrity-data', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req, reply) => {
    const { data: p, error } = await supabase
      .from('protests')
      .select('id, title, demands, scope, country, count, cities_count, starts_at, ends_at, hash_integridad, integrity_version, integrity_calculated_at')
      .eq('id', req.params.id)
      .single();

    if (error || !p) return reply.notFound('Protest not found');
    if (new Date(p.ends_at) > new Date()) return reply.badRequest('Protest is still active — integrity data available after closure');

    // Try integrity_records first (permanent, survives 90-day deletion)
    const { data: record } = await supabase
      .from('integrity_records')
      .select('*')
      .eq('protest_id', req.params.id)
      .maybeSingle();

    // Fall back to live adhesions if record not yet created
    const { data: adhesions } = record ? { data: null } : await supabase
      .from('adhesions')
      .select('public_commitment, ciudad, region, pais, fiabilidad, created_at')
      .eq('protest_id', req.params.id)
      .is('deleted_at', null)
      .not('public_commitment', 'is', null)
      .order('public_commitment');

    // Use integrity_record if available (permanent snapshot)
    if (record) {
      return {
        integrity_version:        record.integrity_version,
        protest_id:               p.id,
        title:                    p.title,
        demands:                  p.demands,
        scope:                    p.scope,
        country:                  p.country,
        total_adhesions:          record.total_adhesions,
        cities_count:             p.cities_count,
        closed_at:                p.ends_at,
        integrity_hash:           record.integrity_hash,
        integrity_calculated_at:  record.calculated_at,
        first_adhesion:           record.first_adhesion || '',
        last_adhesion:            record.last_adhesion  || '',
        public_commitments:       record.public_commitments || [],
        city_distribution:        record.city_distribution  || {},
        reliability_breakdown:    record.reliability_breakdown || {},
        data_source:              'integrity_record',
        verification_instructions: {
          algorithm: 'SHA256',
          input_format: 'protest_id|title|demands|scope|country|count|cities_count|reliability|cities|first_adhesion|last_adhesion|sorted_commitments_joined_with_|',
          note: 'Sort public_commitments alphabetically before joining.',
        },
      };
    }

    const commitments = (adhesions || []).map(a => a.public_commitment);

    // Build city and reliability distributions
    const cityMap = {};
    const relMap = {};
    let firstAdhesion = null;
    let lastAdhesion  = null;

    for (const a of (adhesions || [])) {
      if (a.ciudad) cityMap[a.ciudad] = (cityMap[a.ciudad] || 0) + 1;
      if (a.fiabilidad) relMap[a.fiabilidad] = (relMap[a.fiabilidad] || 0) + 1;
      if (a.created_at) {
        if (!firstAdhesion || a.created_at < firstAdhesion) firstAdhesion = a.created_at;
        if (!lastAdhesion  || a.created_at > lastAdhesion)  lastAdhesion  = a.created_at;
      }
    }

    return {
      integrity_version:        p.integrity_version || 1,
      protest_id:               p.id,
      title:                    p.title,
      demands:                  p.demands,
      scope:                    p.scope,
      country:                  p.country,
      total_adhesions:          p.count,
      cities_count:             p.cities_count,
      closed_at:                p.ends_at,
      integrity_hash:           p.hash_integridad,
      integrity_calculated_at:  p.integrity_calculated_at,
      first_adhesion:           firstAdhesion || '',
      last_adhesion:            lastAdhesion  || '',
      public_commitments:       commitments,
      city_distribution:        cityMap,
      reliability_breakdown:    relMap,
      verification_instructions: {
        algorithm: 'SHA256',
        input_format: 'protest_id|title|demands|scope|country|count|cities_count|reliability|cities|first_adhesion|last_adhesion|sorted_commitments_joined_with_|',
        note: 'Sort public_commitments alphabetically before joining. Timestamps must match exactly as stored in PostgreSQL.',
      },
    };
  });

}
