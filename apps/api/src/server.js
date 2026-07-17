import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import protestRoutes    from './routes/protests.js';
import institucionalRoutes from './routes/institucional.js';
import gruposRoutes from './routes/groups.js';
import userRoutes       from './routes/users.js';
import countryCodeRoutes from './routes/countryCodes.js';
import publicRoutes     from './routes/public.js';
import pushRoutes       from './routes/push.js';
import sourceRoutes     from './routes/source.js';
import kofiWebhookRoutes from './routes/webhooks.js';
import geocodeRoutes    from './routes/geocode.js';
import reportsRoutes    from './routes/reports.js';

// ── Fail-fast on missing identity-hashing secrets in production ─────────────
// Identity hashing (phone, institutional email) and nullifiers depend on these
// server-side secrets. Without them the code would fall back to plain SHA-256 /
// a 'dev-secret', which is dictionary-attackable and correlatable. In production
// that silent downgrade is unacceptable, so the server refuses to start.
if (process.env.NODE_ENV === 'production') {
  const missing = ['PHONE_HASH_SECRET', 'NULLIFIER_SECRET'].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`[SECURITY] Refusing to start: missing required secret(s) in production: ${missing.join(', ')}. ` +
      `Identity hashes would silently downgrade to plain SHA-256 / dev-secret.`);
    process.exit(1);
  }
}

const app = Fastify({
  logger: true,
  bodyLimit: 65_536, // 64 KB max request body
});

await app.register(helmet);
await app.register(cors, {
  origin: (origin, cb) => {
    // Public endpoints used by the embeddable widget — allow any origin
    cb(null, true);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
});
await app.register(sensible);
await app.register(rateLimit, {
  global: true,
  max: 120,
  timeWindow: '1 minute',
});

// Centralized error handler — log internals, return a safe message to clients
app.setErrorHandler((err, req, reply) => {
  req.log.error({ err, url: req.url }, 'request error');
  const status = err.statusCode ?? 500;
  // Pass through validation errors (400) and known HTTP errors unchanged
  if (status < 500) return reply.status(status).send({ error: err.message });
  reply.status(500).send({ error: 'Internal server error' });
});

app.register(protestRoutes,     { prefix: '/api/protests' });
app.register(institucionalRoutes, { prefix: '/api/institucional' });
app.register(gruposRoutes, { prefix: '/api/grupos' });
app.register(userRoutes,        { prefix: '/api/users' });
app.register(countryCodeRoutes, { prefix: '/api/country-codes' });
app.register(publicRoutes,      { prefix: '/api/public' });
app.register(pushRoutes,        { prefix: '/api/push' });
app.register(sourceRoutes,      { prefix: '/api/source' });
app.register(kofiWebhookRoutes, { prefix: '/api/webhooks' });
app.register(geocodeRoutes,     { prefix: '/api/geocode' });
import { ipinfoRoutes } from './routes/geocode.js';
app.register(ipinfoRoutes,      { prefix: '/api/ipinfo' });

// No prefix: reports.voiceprotest.org is a second custom domain pointed at
// this same Railway service. Every route inside gates itself on the Host
// header (see routes/reports.js), so requests to api.voiceprotest.org for
// any of these same paths still fall through to a normal 404, unchanged.
app.register(reportsRoutes);

app.get('/health', async () => ({ status: 'ok' }));

const port = Number(process.env.PORT) || 3000;
await app.listen({ port, host: '0.0.0.0' });

