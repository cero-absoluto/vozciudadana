/**
 * GET /api/geocode?lat=...&lon=...
 *
 * Privacy proxy for Nominatim reverse geocoding.
 *
 * PROBLEM SOLVED: The frontend was calling Nominatim directly from the browser,
 * which exposed the user's real IP address to OpenStreetMap's infrastructure.
 * This contradicts the platform's privacy model — we protect phone numbers and
 * GPS coordinates, but were inadvertently leaking IP via geocoding.
 *
 * SOLUTION: All Nominatim calls now go through this endpoint. The backend
 * calls Nominatim using Railway's server IP, never the user's IP.
 * Only city, region and country are returned — coordinates are never stored.
 *
 * Rate limited aggressively: one geocode per 5 seconds per IP to prevent
 * using this as a general-purpose geocoding proxy.
 */
export default async function geocodeRoutes(app) {
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
