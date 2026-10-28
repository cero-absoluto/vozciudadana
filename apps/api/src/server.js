import {privacyFastifyOptions,registerPrivacyRequestLogging} from './lib/privacyLogging.js';
import {registerSafeErrorHandler} from './lib/safeErrors.js';
import 'dotenv/config';
import Fastify from 'fastify';
import {registerHealthRoutes} from './routes/health.js';
import {registerRequestQuotas} from './lib/requestQuotas.js';
import { clientIpPolicyFromEnv } from './lib/clientIpPolicy.js';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';

import { registerCensusRetention } from './lib/censusRetention.js';
import { supabase } from './services/supabase.js';

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
  const missing = ['PHONE_HASH_SECRET', 'NULLIFIER_SECRET', 'RECAPTCHA_SECRET',
    'PARTICIPATION_TOKEN_SECRET', 'DEVICE_SECRET_PEPPER', 'EMAIL_OTP_SECRET'].filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`[SECURITY] Refusing to start: missing required secret(s) in production: ${missing.join(', ')}. ` +
      `Identity hashes, reCAPTCHA and participation tokens would silently downgrade or be disabled.`);
    process.exit(1);
  }
}

const clientIpPolicy = clientIpPolicyFromEnv();
const app = Fastify({
  ...privacyFastifyOptions(),
  trustProxy: clientIpPolicy.trustProxy,
  bodyLimit: 65_536, // 64 KB max request body
});

clientIpPolicy.install(app);

await app.register(helmet);
// ── CORS (VP-SEC-006 fix, 23 July 2026) ─────────────────────────────────────
// This used to accept any origin for the entire API, though the comment
// here claimed it was only for the embeddable widget. In fact only one
// endpoint is ever called from a third-party origin — GET
// /api/protests/:id/informe, fetched directly by widget.js when embedded on
// someone else's page — every other route only needs to answer
// voiceprotest.org itself. That one route now opts back into "any origin"
// explicitly, at the route level (see routes/protests.js); everything else
// uses this restrictive default. Open CORS alone was not exploitable without
// cookies or other ambient credentials, but combined with the device_id
// endpoints (VP-SEC-002) it meant any origin could read a response once it
// had a device_id — this closes that path regardless of the device_id fix.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://voiceprotest.org,https://www.voiceprotest.org')
  .split(',').map(o => o.trim()).filter(Boolean);

await app.register(cors, {
  origin: (origin, cb) => {
    // No Origin header at all (server-to-server, curl, same-origin) — allow.
    if (!origin) return cb(null, true);
    cb(null, ALLOWED_ORIGINS.includes(origin));
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
});
await app.register(sensible);
await registerRequestQuotas(app,{supabase});

registerPrivacyRequestLogging(app);
registerSafeErrorHandler(app);

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

registerCensusRetention(app, supabase);

registerHealthRoutes(app);

const port = Number(process.env.PORT) || 3000;
await app.listen({ port, host: '0.0.0.0' });



