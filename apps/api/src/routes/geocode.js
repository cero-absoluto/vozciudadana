/**
 * GET /api/geocode?lat=...&lon=...
 *
 * Privacy proxy for Nominatim reverse geocoding.
 * [existing endpoint - unchanged]
 */
export default async function geocodeRoutes(app) {
  // ── Municipality search — for CreateScreen local scope ──────────────────
  // Searches Nominatim for municipalities matching a text query.
  // Returns a list of results with osm_id (for reliable comparison) and
  // human-readable names. Admin level 8 = municipality in all EU countries.
  app.get('/search', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q:     { type: 'string', minLength: 2, maxLength: 100 },
          level: { type: 'string', default: '8' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { q, level } = req.query;
    try {
      const url = `https://nominatim.openstreetmap.org/search` +
        `?q=${encodeURIComponent(q)}` +
        `&format=json` +
        `&addressdetails=1` +
        `&limit=8` +
        `&featuretype=settlement`;

      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'es,en;q=0.8',
          'User-Agent': 'VoiceProtest/1.0 (voiceprotest.org)',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return reply.status(502).send({ error: 'Search service unavailable' });

      const data = await res.json();

      // Filter to municipalities and towns, extract osm_id for reliable matching
      const results = data
        .filter(r => ['city', 'town', 'village', 'municipality'].includes(r.type) ||
                     r.addresstype === 'municipality')
        .map(r => ({
          osm_id:       parseInt(r.osm_id),
          osm_type:     r.osm_type,
          name:         r.address?.city || r.address?.town || r.address?.village || r.name,
          display_name: r.display_name,
          country_code: r.address?.country_code?.toUpperCase() || null,
          country:      r.address?.country || null,
        }))
        .filter(r => r.osm_id && r.name);

      return { results };
    } catch {
      return reply.status(502).send({ error: 'Search service unavailable' });
    }
  });
  app.get('/', {
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
    schema: {
      querystring: {
        type: 'object',
        required: ['lat', 'lon'],
        properties: {
          lat: { type: 'number', minimum: -90,  maximum: 90  },
          lon: { type: 'number', minimum: -180, maximum: 180 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { lat, lon } = req.query;

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'es,en;q=0.8',
          'User-Agent': 'VoiceProtest/1.0 (voiceprotest.org)',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        return reply.status(502).send({ error: 'Geocoding service unavailable' });
      }

      const geo = await res.json();

      // Return only city/region/country — never echo back coordinates
      // or any other data from the Nominatim response.
      return {
        city:    geo.address?.city || geo.address?.town || geo.address?.village || null,
        region:  geo.address?.state || null,
        country: geo.address?.country || null,
        country_code: geo.address?.country_code?.toUpperCase() || null,
      };
    } catch {
      // Nominatim timeout or network error — return empty, don't expose details
      return reply.status(502).send({ error: 'Geocoding service unavailable' });
    }
  });
}
