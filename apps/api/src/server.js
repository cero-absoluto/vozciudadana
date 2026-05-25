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

const app = Fastify({
  logger: true,
  bodyLimit: 65_536, // 64 KB max request body
});

await app.register(helmet);
await app.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
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

app.get('/health', async () => ({ status: 'ok' }));

const port = Number(process.env.PORT) || 3000;
await app.listen({ port, host: '0.0.0.0' });
